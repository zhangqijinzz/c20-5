import { getItemBounds } from '../../shared/layoutRules'
import type { DeskItem, ItemBounds } from '../../shared/models'

export type SnapAxis = 'x' | 'y'
export type AnchorKind = 'min' | 'center' | 'max'

/**
 * 吸附总开关同时控制「智能吸附」与「步进网格」；
 * 关闭后拖动位置完全跟随指针。
 */
export interface SnapSettings {
  enabled: boolean
  stepMm: number
}

export const DEFAULT_SNAP_SETTINGS: SnapSettings = { enabled: true, stepMm: 10 }
export const STEP_OPTIONS = [1, 5, 10, 25, 50]

/** 咬入 / 释放阈值（毫米）。释放更宽，形成迟滞，避免临界位置抖动。 */
export const SNAP_ENGAGE_MM = 10
export const SNAP_RELEASE_MM = 16

export interface GuideLine {
  axis: SnapAxis
  /** x 轴吸附时为竖线的 x，y 轴吸附时为横线的 y（毫米） */
  position: number
  from: number
  to: number
  scope: 'desk' | 'item'
  /** scope 为 item 时，对齐目标设备的 id */
  targetId: string | null
}

export interface GapMeasurement {
  axis: SnapAxis
  from: number
  to: number
  /** 标注线固定位置：x 轴间距标注在该 y，y 轴间距标注在该 x */
  at: number
  distanceMm: number
}

export interface SnapResult {
  x: number
  y: number
  guides: GuideLine[]
  gaps: GapMeasurement[]
  activeKeys: { x: string | null; y: string | null }
}

interface SnapCandidate {
  axis: SnapAxis
  /** 被拖设备自身参与对齐的锚点 */
  anchor: AnchorKind
  /** 对齐目标（桌面 / 其它设备）上参与对齐的锚点 */
  targetAnchor: AnchorKind
  scope: 'desk' | 'item'
  targetId: string | null
  /** 候选吸附线在该轴上的坐标（毫米） */
  coordinate: number
}

interface AxisSelection {
  delta: number
  candidate: SnapCandidate
  key: string
}

function anchorOf(bounds: ItemBounds, axis: SnapAxis, anchor: AnchorKind): number {
  if (axis === 'x') return anchor === 'min' ? bounds.left : anchor === 'max' ? bounds.right : (bounds.left + bounds.right) / 2
  return anchor === 'min' ? bounds.top : anchor === 'max' ? bounds.bottom : (bounds.top + bounds.bottom) / 2
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0)
}

const anchorPriority: Record<AnchorKind, number> = { min: 0, max: 0, center: 1 }
const scopePriority: Record<'desk' | 'item', number> = { desk: 0, item: 1 }

/** 只在位移绝对值并列时调用：true 表示 next 应胜出，保证裁决结果唯一。 */
function hasHigherPriority(next: SnapCandidate, current: SnapCandidate): boolean {
  if (anchorPriority[next.anchor] !== anchorPriority[current.anchor]) {
    return anchorPriority[next.anchor] < anchorPriority[current.anchor]
  }
  if (scopePriority[next.scope] !== scopePriority[current.scope]) {
    return scopePriority[next.scope] < scopePriority[current.scope]
  }
  // 仍然并列：取吸附坐标更靠近原点的
  return next.coordinate < current.coordinate
}

export function candidateKey(candidate: SnapCandidate): string {
  return `${candidate.scope}:${candidate.targetId ?? 'desk'}:${candidate.axis}:${candidate.anchor}-${candidate.targetAnchor}`
}

const ALL_ANCHORS: AnchorKind[] = ['min', 'center', 'max']

/**
 * 单轴选候选。
 *
 * 决策规则（保证确定性，解决「多设备挤在一起」与「对角线方向」的吸附优先级）：
 * 1. x / y 两个轴完全独立计算，斜向拖动时各自最多选中一个候选，互不干扰；
 * 2. 每个轴所有候选里取「需要的位移绝对值」最小的一个；
 * 3. 位移完全相同（并列）时按优先级裁决：桌面边 > 设备边 > 桌面中线 > 设备中线，
 *    仍然并列则取吸附坐标更靠近原点的，结果始终唯一；
 * 4. 迟滞：已吸附同一候选时用更宽的释放阈值，未吸附时用较窄的咬入阈值，
 *    消除临界位置上反复吸/放。
 *
 * 设备对齐共有 9 种锚点配对（我的 min/center/max × 对方的 min/center/max），
 * 例如「我的左边贴他的右边」(anchor=min, targetAnchor=max)。
 */
function selectOnAxis(params: {
  axis: SnapAxis
  rawBounds: ItemBounds
  deskWidthMm: number
  deskHeightMm: number
  others: DeskItem[]
  activeKey: string | null
}): AxisSelection | null {
  const { axis, rawBounds, deskWidthMm, deskHeightMm, others, activeKey } = params
  const size = axis === 'x' ? deskWidthMm : deskHeightMm

  const deskCandidates: SnapCandidate[] = ALL_ANCHORS.map((anchor) => ({
    axis,
    anchor,
    targetAnchor: anchor,
    scope: 'desk' as const,
    targetId: null,
    coordinate: anchor === 'min' ? 0 : anchor === 'max' ? size : size / 2,
  }))
  const otherCandidates: SnapCandidate[] = others.flatMap((other) => {
    const otherBounds = getItemBounds(other)
    // 9 种配对：自身三个锚点（min/center/max）各对目标三个锚点
    return ALL_ANCHORS.flatMap((anchor) => ALL_ANCHORS.map((targetAnchor) => ({
      axis,
      anchor,
      targetAnchor,
      scope: 'item' as const,
      targetId: other.id,
      coordinate: anchorOf(otherBounds, axis, targetAnchor),
    })))
  })

  let winner: (SnapCandidate & { delta: number }) | null = null
  for (const candidate of [...deskCandidates, ...otherCandidates]) {
    // 无论哪个锚点，位移都是「目标坐标 - 自身锚点坐标」，符号统一
    const delta = candidate.coordinate - anchorOf(rawBounds, axis, candidate.anchor)
    if (!winner) {
      winner = { ...candidate, delta }
      continue
    }
    const nextAbs = Math.abs(delta)
    const currentAbs = Math.abs(winner.delta)
    // 先比位移；并列时才走确定性的优先级裁决
    if (nextAbs < currentAbs || (nextAbs === currentAbs && hasHigherPriority(candidate, winner))) {
      winner = { ...candidate, delta }
    }
  }
  if (!winner) return null

  const threshold = activeKey === candidateKey(winner) ? SNAP_RELEASE_MM : SNAP_ENGAGE_MM
  if (Math.abs(winner.delta) > threshold) return null
  return { delta: winner.delta, candidate: winner, key: candidateKey(winner) }
}

/** 依据最终包围盒与候选，生成一条提示线（跨两台设备并向外延伸少许）。 */
function buildGuide(selection: AxisSelection, snappedBounds: ItemBounds, othersById: Map<string, ItemBounds>, deskWidthMm: number, deskHeightMm: number): GuideLine {
  const { candidate } = selection
  if (candidate.scope === 'desk') {
    return {
      axis: candidate.axis,
      position: candidate.coordinate,
      from: 0,
      to: candidate.axis === 'x' ? deskHeightMm : deskWidthMm,
      scope: 'desk',
      targetId: null,
    }
  }
  const targetBounds = othersById.get(candidate.targetId ?? '')
  if (!targetBounds) {
    return { axis: candidate.axis, position: candidate.coordinate, from: 0, to: candidate.axis === 'x' ? deskHeightMm : deskWidthMm, scope: 'item', targetId: candidate.targetId }
  }
  const extension = 24
  if (candidate.axis === 'x') {
    return {
      axis: 'x',
      position: candidate.coordinate,
      from: Math.max(0, Math.min(snappedBounds.top, targetBounds.top) - extension),
      to: Math.min(deskHeightMm, Math.max(snappedBounds.bottom, targetBounds.bottom) + extension),
      scope: 'item',
      targetId: candidate.targetId,
    }
  }
  return {
    axis: 'y',
    position: candidate.coordinate,
    from: Math.max(0, Math.min(snappedBounds.left, targetBounds.left) - extension),
    to: Math.min(deskWidthMm, Math.max(snappedBounds.right, targetBounds.right) + extension),
    scope: 'item',
    targetId: candidate.targetId,
  }
}

/**
 * 对齐后给出实时间距。
 * 间距来自「吸附轴上构成对齐的两个锚点」：
 * - 两条边对齐（min/max 配对）：
 *   - 我的边朝向目标内部 → 吸附轴方向的正面间距为 0（贴边），
 *     若另一轴投影重叠，则改标另一轴方向的间距（上下堆叠 / 左右并排）；
 *   - 两条边彼此远离 → 标注两条边之间的正面间距；
 * - 中线参与：没有明确的“边到边”语义，不标距离，只出提示线；
 * - 另一轴投影不重叠（纯对角方向）：不给距离，避免误导。
 */
function buildGap(selection: AxisSelection, snappedBounds: ItemBounds, othersById: Map<string, ItemBounds>): GapMeasurement | null {
  const { candidate } = selection
  if (candidate.scope === 'desk') return null
  if (candidate.anchor === 'center' || candidate.targetAnchor === 'center') return null
  const otherBounds = othersById.get(candidate.targetId ?? '')
  if (!otherBounds) return null

  const axis = candidate.axis
  const ownSide = candidate.anchor
  const targetSide = candidate.targetAnchor
  // ownSide 是被拖设备上朝向对齐线的边；targetSide 是目标设备上的边。
  // 两边方向相反（我右贴他左 / 我左贴他右）=> 设备在吸附轴上分开，标注正面间距；
  // 两边方向相同（我左贴他左等）=> 吸附轴方向重叠，应标注另一轴的间距。
  const separatedOnAxis = ownSide !== targetSide

  if (axis === 'x') {
    const at = (Math.max(snappedBounds.top, otherBounds.top) + Math.min(snappedBounds.bottom, otherBounds.bottom)) / 2
    if (separatedOnAxis) {
      if (ownSide === 'max') return { axis, from: snappedBounds.right, to: otherBounds.left, at, distanceMm: otherBounds.left - snappedBounds.right }
      return { axis, from: otherBounds.right, to: snappedBounds.left, at, distanceMm: snappedBounds.left - otherBounds.right }
    }
    if (overlap(snappedBounds.left, snappedBounds.right, otherBounds.left, otherBounds.right) <= 0) return null
    if (snappedBounds.bottom <= otherBounds.top) return { axis: 'y', from: snappedBounds.bottom, to: otherBounds.top, at: candidate.coordinate, distanceMm: otherBounds.top - snappedBounds.bottom }
    if (otherBounds.bottom <= snappedBounds.top) return { axis: 'y', from: otherBounds.bottom, to: snappedBounds.top, at: candidate.coordinate, distanceMm: snappedBounds.top - otherBounds.bottom }
    return null
  }

  const at = (Math.max(snappedBounds.left, otherBounds.left) + Math.min(snappedBounds.right, otherBounds.right)) / 2
  if (separatedOnAxis) {
    if (ownSide === 'max') return { axis, from: snappedBounds.bottom, to: otherBounds.top, at, distanceMm: otherBounds.top - snappedBounds.bottom }
    return { axis, from: otherBounds.bottom, to: snappedBounds.top, at, distanceMm: snappedBounds.top - otherBounds.bottom }
  }
  if (overlap(snappedBounds.top, snappedBounds.bottom, otherBounds.top, otherBounds.bottom) <= 0) return null
  if (snappedBounds.right <= otherBounds.left) return { axis: 'x', from: snappedBounds.right, to: otherBounds.left, at: candidate.coordinate, distanceMm: otherBounds.left - snappedBounds.right }
  if (otherBounds.right <= snappedBounds.left) return { axis: 'x', from: otherBounds.right, to: snappedBounds.left, at: candidate.coordinate, distanceMm: snappedBounds.left - otherBounds.right }
  return null
}

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step
}

export interface SnapInput {
  item: DeskItem
  rawX: number
  rawY: number
  others: DeskItem[]
  deskWidthMm: number
  deskHeightMm: number
  settings: SnapSettings
  /** 上一帧的吸附状态（两个轴），用于迟滞判断 */
  activeKeys: { x: string | null; y: string | null }
}

/**
 * 计算拖动中一帧的吸附结果。
 * 返回的坐标只用于画面展示，是否写回模型由调用方在松手时决定。
 */
export function computeSnap(input: SnapInput): SnapResult {
  const { item, rawX, rawY, others, deskWidthMm, deskHeightMm, settings, activeKeys } = input
  const rawBounds = getItemBounds({ ...item, x: rawX, y: rawY })

  if (!settings.enabled) {
    return { x: rawX, y: rawY, guides: [], gaps: [], activeKeys: { x: null, y: null } }
  }

  const xSelection = selectOnAxis({ axis: 'x', rawBounds, deskWidthMm, deskHeightMm, others, activeKey: activeKeys.x })
  const ySelection = selectOnAxis({ axis: 'y', rawBounds, deskWidthMm, deskHeightMm, others, activeKey: activeKeys.y })

  let x = rawX
  let y = rawY
  if (xSelection) x += xSelection.delta
  else if (settings.stepMm > 0) x = roundToStep(rawX, settings.stepMm)
  if (ySelection) y += ySelection.delta
  else if (settings.stepMm > 0) y = roundToStep(rawY, settings.stepMm)

  const selections = [xSelection, ySelection].filter((selection): selection is AxisSelection => selection !== null)
  const nextActiveKeys = { x: xSelection?.key ?? null, y: ySelection?.key ?? null }

  const snappedBounds = getItemBounds({ ...item, x, y })
  const othersById = new Map(others.map((other) => [other.id, getItemBounds(other)]))
  const guides = selections.map((selection) => buildGuide(selection, snappedBounds, othersById, deskWidthMm, deskHeightMm))
  const gaps = selections
    .map((selection) => buildGap(selection, snappedBounds, othersById))
    .filter((gap): gap is GapMeasurement => gap !== null && gap.distanceMm > 0.5)

  return { x, y, guides, gaps, activeKeys: nextActiveKeys }
}
