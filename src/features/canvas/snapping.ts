import { getItemBounds } from '../../shared/layoutRules'
import type { DeskItem, ItemBounds } from '../../shared/models'

export interface CanvasSettings {
  /** 吸附总开关：关闭后只保留标尺与自由拖动 */
  snappingEnabled: boolean
  /** 距参考线多少毫米以内开始吸附（即“步进”灵敏度） */
  snapThresholdMm: number
  /** 方向键微调的步进（毫米） */
  nudgeStepMm: number
  /** 是否显示画布标尺 */
  rulersVisible: boolean
}

export const DEFAULT_CANVAS_SETTINGS: CanvasSettings = {
  snappingEnabled: true,
  snapThresholdMm: 10,
  nudgeStepMm: 10,
  rulersVisible: true,
}

export const SNAP_THRESHOLD_RANGE = { min: 4, max: 40, step: 2 }
export const NUDGE_STEP_OPTIONS = [1, 5, 10, 20, 50]

export function clampSnapThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CANVAS_SETTINGS.snapThresholdMm
  const { min, max } = SNAP_THRESHOLD_RANGE
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function clampNudgeStep(value: number): number {
  return NUDGE_STEP_OPTIONS.includes(value) ? value : DEFAULT_CANVAS_SETTINGS.nudgeStepMm
}

export function normalizeCanvasSettings(value: Partial<CanvasSettings> | null | undefined): CanvasSettings {
  if (!value) return { ...DEFAULT_CANVAS_SETTINGS }
  return {
    snappingEnabled: typeof value.snappingEnabled === 'boolean' ? value.snappingEnabled : DEFAULT_CANVAS_SETTINGS.snappingEnabled,
    snapThresholdMm: clampSnapThreshold(value.snapThresholdMm ?? DEFAULT_CANVAS_SETTINGS.snapThresholdMm),
    nudgeStepMm: clampNudgeStep(value.nudgeStepMm ?? DEFAULT_CANVAS_SETTINGS.nudgeStepMm),
    rulersVisible: typeof value.rulersVisible === 'boolean' ? value.rulersVisible : DEFAULT_CANVAS_SETTINGS.rulersVisible,
  }
}

export type SnapAxis = 'x' | 'y'
/** lead = 左 / 上边缘，trail = 右 / 下边缘 */
type AnchorKind = 'edge-lead' | 'center' | 'edge-trail'
type Scope = 'desk' | 'item'

export interface SnapGuide {
  axis: SnapAxis
  /** 提示线在该轴上的毫米坐标 */
  coordinate: number
  /** 实时间距文案 */
  label: string
  /** 间距徽标的中心点（毫米坐标） */
  badgeX: number
  badgeY: number
  scope: Scope
}

export interface SnapResult {
  x: number
  y: number
  deltaX: number
  deltaY: number
  guides: SnapGuide[]
}

interface Reference {
  axis: SnapAxis
  anchor: AnchorKind
  scope: Scope
  targetId: string
  coordinate: number
  bounds: ItemBounds | null
}

interface ChosenReference {
  reference: Reference
  /** 被拖动设备是哪一条锚点线被吸住（可能与参考线锚点不同，如左缘吸右缘） */
  anchor: AnchorKind
  /** 吸附时被拖动设备的锚点原值，用于判断滞回何时释放 */
  anchorPosition: number
}

const EPSILON = 0.5
/** 已锁定的参考线在超出阈值 1.6 倍后才释放，避免临界点来回跳 */
const RELEASE_FACTOR = 1.6

const ANCHOR_RANK: Record<AnchorKind, number> = { 'edge-lead': 0, 'edge-trail': 1, center: 2 }

function buildReferences(axis: SnapAxis, deskWidthMm: number, deskHeightMm: number, others: DeskItem[]): Reference[] {
  const deskId = '__desk__'
  const references: Reference[] = axis === 'x'
    ? [
      { axis, anchor: 'edge-lead', scope: 'desk', targetId: deskId, coordinate: 0, bounds: null },
      { axis, anchor: 'center', scope: 'desk', targetId: deskId, coordinate: deskWidthMm / 2, bounds: null },
      { axis, anchor: 'edge-trail', scope: 'desk', targetId: deskId, coordinate: deskWidthMm, bounds: null },
    ]
    : [
      { axis, anchor: 'edge-lead', scope: 'desk', targetId: deskId, coordinate: 0, bounds: null },
      { axis, anchor: 'center', scope: 'desk', targetId: deskId, coordinate: deskHeightMm / 2, bounds: null },
      { axis, anchor: 'edge-trail', scope: 'desk', targetId: deskId, coordinate: deskHeightMm, bounds: null },
    ]

  others.forEach((item) => {
    const bounds = getItemBounds(item)
    if (axis === 'x') {
      references.push(
        { axis, anchor: 'edge-lead', scope: 'item', targetId: item.id, coordinate: bounds.left, bounds },
        { axis, anchor: 'center', scope: 'item', targetId: item.id, coordinate: bounds.left + bounds.width / 2, bounds },
        { axis, anchor: 'edge-trail', scope: 'item', targetId: item.id, coordinate: bounds.right, bounds },
      )
    } else {
      references.push(
        { axis, anchor: 'edge-lead', scope: 'item', targetId: item.id, coordinate: bounds.top, bounds },
        { axis, anchor: 'center', scope: 'item', targetId: item.id, coordinate: bounds.top + bounds.height / 2, bounds },
        { axis, anchor: 'edge-trail', scope: 'item', targetId: item.id, coordinate: bounds.bottom, bounds },
      )
    }
  })

  return references
}

function anchorPositions(axis: SnapAxis, bounds: ItemBounds): Record<AnchorKind, number> {
  return axis === 'x'
    ? { 'edge-lead': bounds.left, center: bounds.left + bounds.width / 2, 'edge-trail': bounds.right }
    : { 'edge-lead': bounds.top, center: bounds.top + bounds.height / 2, 'edge-trail': bounds.bottom }
}

/**
 * 吸附候选：被拖设备的任一条线都可吸向任意参考线（左缘→另一台右缘、中线→中线……）。
 *
 * 优先级（同一轴内，逐键比较，结果完全确定）：
 * 1. 已锁定的参考线在释放带（阈值 × 1.6）内始终保留 —— 防止临界点频繁切换；
 * 2. 距离最近者优先；
 * 3. 同距时桌面四边 / 中线优先于其它设备（全局参考更稳定，解决多设备挤一起时的抖动）；
 * 4. 再依次按参考线锚点(左/上缘 → 右/下缘 → 中线)、被拖锚点、目标 id 字典序兜底。
 * X / Y 两轴各自独立判定、独立锁定，所以对角线方向两个方向可以同时吸且互不干扰。
 */
export class DragSnapping {
  private readonly locks = new Map<SnapAxis, ChosenReference>()

  constructor(
    private readonly deskWidthMm: number,
    private readonly deskHeightMm: number,
    private readonly dragged: DeskItem,
    private readonly others: DeskItem[],
    private readonly enabled: boolean,
    private readonly thresholdMm: number,
  ) {}

  reset(): void {
    this.locks.clear()
  }

  update(rawX: number, rawY: number): SnapResult {
    const guides: SnapGuide[] = []
    if (!this.enabled) return { x: rawX, y: rawY, deltaX: 0, deltaY: 0, guides }

    const rawBounds = getItemBounds({ ...this.dragged, x: rawX, y: rawY })
    const chosen = new Map<SnapAxis, ChosenReference>()
    const deltas: Record<SnapAxis, number> = { x: 0, y: 0 }

    ;(['x', 'y'] as const).forEach((axis) => {
      const selection = this.pickForAxis(axis, rawBounds)
      if (!selection) {
        this.locks.delete(axis)
        return
      }
      this.locks.set(axis, selection)
      chosen.set(axis, selection)
      deltas[axis] = selection.reference.coordinate - selection.anchorPosition
    })

    const snappedX = rawX + deltas.x
    const snappedY = rawY + deltas.y
    const finalBounds = getItemBounds({ ...this.dragged, x: snappedX, y: snappedY })

    chosen.forEach((selection, axis) => {
      const guide = this.buildGuide(axis, selection, finalBounds)
      if (guide) guides.push(guide)
    })

    return { x: snappedX, y: snappedY, deltaX: deltas.x, deltaY: deltas.y, guides }
  }

  private pickForAxis(axis: SnapAxis, rawBounds: ItemBounds): ChosenReference | null {
    const references = buildReferences(axis, this.deskWidthMm, this.deskHeightMm, this.others)
    const anchors = anchorPositions(axis, rawBounds)
    const releaseBand = this.thresholdMm * RELEASE_FACTOR

    const locked = this.locks.get(axis)
    if (locked) {
      const liveDistance = Math.abs(anchors[locked.anchor] - locked.reference.coordinate)
      if (liveDistance <= releaseBand) {
        return { reference: locked.reference, anchor: locked.anchor, anchorPosition: anchors[locked.anchor] }
      }
    }

    // 笛卡尔积：被拖设备的任一条线（左/中/右 或 上/中/下）都可以吸附到
    // 桌面与其它设备的任一条参考线，例如左缘吸到另一台设备的右缘
    const candidates = references.flatMap((reference) => (
      (Object.keys(anchors) as AnchorKind[]).map((anchor) => ({
        reference,
        anchor,
        distance: Math.abs(anchors[anchor] - reference.coordinate),
      }))
    ))
      .filter((candidate) => candidate.distance <= this.thresholdMm)
      .sort((first, second) => (
        first.distance - second.distance
        || (first.reference.scope === second.reference.scope ? 0 : first.reference.scope === 'desk' ? -1 : 1)
        || ANCHOR_RANK[first.reference.anchor] - ANCHOR_RANK[second.reference.anchor]
        || ANCHOR_RANK[first.anchor] - ANCHOR_RANK[second.anchor]
        || first.reference.targetId.localeCompare(second.reference.targetId)
      ))

    const best = candidates[0]
    return best ? { reference: best.reference, anchor: best.anchor, anchorPosition: anchors[best.anchor] } : null
  }

  private buildGuide(axis: SnapAxis, selection: ChosenReference, finalBounds: ItemBounds): SnapGuide | null {
    const { reference } = selection
    const coordinate = reference.coordinate

    if (reference.scope === 'desk') {
      const label = reference.anchor === 'center' ? '居中' : '0 mm'
      return axis === 'x'
        ? { axis, coordinate, label, badgeX: coordinate, badgeY: finalBounds.top + finalBounds.height / 2, scope: 'desk' }
        : { axis, coordinate, label, badgeX: finalBounds.left + finalBounds.width / 2, badgeY: coordinate, scope: 'desk' }
    }

    const refBounds = reference.bounds
    if (!refBounds) return null

    if (axis === 'x') {
      const { mid, gap } = perpendicularGap(finalBounds.bottom, finalBounds.top, refBounds.bottom, refBounds.top)
      return { axis, coordinate, label: `${Math.round(gap)} mm`, badgeX: coordinate, badgeY: mid, scope: 'item' }
    }
    const { mid, gap } = perpendicularGap(finalBounds.right, finalBounds.left, refBounds.right, refBounds.left)
    return { axis, coordinate, label: `${Math.round(gap)} mm`, badgeX: mid, badgeY: coordinate, scope: 'item' }
  }
}

/**
 * 计算垂直于提示线方向上两台设备的间距与空档中点（徽标放在空档中央）。
 * 投影方向重叠时间距为 0，中点取重叠区间中点。
 */
function perpendicularGap(
  draggedTrail: number,
  draggedLead: number,
  referenceTrail: number,
  referenceLead: number,
): { mid: number; gap: number } {
  if (draggedTrail <= referenceLead + EPSILON) {
    return { mid: (draggedTrail + referenceLead) / 2, gap: Math.max(0, referenceLead - draggedTrail) }
  }
  if (referenceTrail <= draggedLead + EPSILON) {
    return { mid: (referenceTrail + draggedLead) / 2, gap: Math.max(0, draggedLead - referenceTrail) }
  }
  return { mid: (Math.max(draggedLead, referenceLead) + Math.min(draggedTrail, referenceTrail)) / 2, gap: 0 }
}
