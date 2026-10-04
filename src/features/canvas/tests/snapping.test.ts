import { describe, expect, it } from 'vitest'
import { createItem } from '../../../shared/models'
import {
  computeSnap,
  DEFAULT_SNAP_SETTINGS,
  SNAP_ENGAGE_MM,
  SNAP_RELEASE_MM,
  STEP_OPTIONS,
} from '../snapping'
import { normalizeSnapSettings } from '../useSnapSettings'

const desk = { deskWidthMm: 1600, deskHeightMm: 800 }
const noActive = { x: null, y: null }
const settings = { ...DEFAULT_SNAP_SETTINGS, stepMm: 0 }

function itemAt(type: 'monitor' | 'keyboard' | 'speaker', x: number, y: number) {
  const item = createItem(type)
  return { ...item, x, y }
}

describe('computeSnap smart guides', () => {
  it('snaps the dragged left edge to the desk left edge', () => {
    const item = itemAt('monitor', 6, 100)
    const result = computeSnap({ item, rawX: 6, rawY: 100, others: [], ...desk, settings, activeKeys: noActive })
    expect(result.x).toBe(0)
    expect(result.y).toBe(100)
    expect(result.guides).toContainEqual(expect.objectContaining({ axis: 'x', position: 0, scope: 'desk' }))
    expect(result.activeKeys.x).toBe('desk:desk:x:min-min')
  })

  it('snaps to desk center lines on both axes', () => {
    const monitor = itemAt('monitor', 530, 295) // 540x210：中心 x=800, y=400
    const result = computeSnap({ item: monitor, rawX: 530, rawY: 295, others: [], ...desk, settings, activeKeys: noActive })
    expect(result.x).toBe(530)
    expect(result.y).toBe(295)
    expect(result.guides).toEqual(expect.arrayContaining([
      expect.objectContaining({ axis: 'x', position: 800, scope: 'desk' }),
      expect.objectContaining({ axis: 'y', position: 400, scope: 'desk' }),
    ]))
  })

  it('aligns edges with another device without emitting a zero gap tag', () => {
    const monitor = itemAt('monitor', 100, 100)
    const keyboard = itemAt('keyboard', 646, 130) // 左边缘距离 6 就到 640
    const result = computeSnap({ item: keyboard, rawX: 646, rawY: 130, others: [monitor], ...desk, settings, activeKeys: noActive })
    expect(result.x).toBe(640)
    const guide = result.guides.find((candidate) => candidate.axis === 'x' && candidate.scope === 'item')
    expect(guide).toMatchObject({ position: 640, targetId: monitor.id })
    // 贴合时间距为 0，不显示距离标签
    expect(result.gaps).toHaveLength(0)
  })

  it('reports the gap on the other axis when edges line up (e.g. top-aligned, 20 mm apart)', () => {
    const monitor = itemAt('monitor', 100, 100)
    const speaker = itemAt('speaker', 660, 100) // 顶边对齐，左边距显示器右边 20 mm
    const result = computeSnap({ item: speaker, rawX: 660, rawY: 100, others: [monitor], ...desk, settings, activeKeys: noActive })
    expect(result.y).toBe(100)
    expect(result.gaps).toEqual([
      expect.objectContaining({ axis: 'x', distanceMm: 20, from: 640, to: 660 }),
    ])
  })

  it('does not report a gap in purely diagonal directions (no projection overlap)', () => {
    const monitor = itemAt('monitor', 100, 100) // bottom = 310
    const speaker = itemAt('speaker', 635, 315) // left 距 640 为 5；top=315 与 310 不重叠
    const result = computeSnap({ item: speaker, rawX: 635, rawY: 315, others: [monitor], ...desk, settings, activeKeys: noActive })
    expect(result.x).toBe(640)
    expect(result.gaps.filter((gap) => gap.axis === 'x')).toHaveLength(0)
  })

  it('evaluates x and y independently during diagonal movement', () => {
    const monitor = itemAt('monitor', 100, 100)
    // x 方向差 4（可吸附），y 方向中线差 35（超出阈值不吸附）
    const keyboard = itemAt('keyboard', 644, 180)
    const result = computeSnap({ item: keyboard, rawX: 644, rawY: 180, others: [monitor], ...desk, settings, activeKeys: noActive })
    expect(result.x).toBe(640)
    expect(result.y).toBe(180)
    expect(result.guides.filter((guide) => guide.axis === 'x')).toHaveLength(1)
    expect(result.guides.filter((guide) => guide.axis === 'y')).toHaveLength(0)
  })

  it('prefers the closest device when several candidates crowd the same anchor', () => {
    // 被拖键盘右边缘在 305（x=-140）：距 B.right(300) 为 5，距 A.right(296) 为 9，应吸附 B
    const a = itemAt('speaker', 146, 100)   // right 296
    const b = itemAt('speaker', 150, 100)   // right 300
    const dragged = { ...itemAt('keyboard', -140, 100), heightMm: 150 }
    const result = computeSnap({ item: dragged, rawX: -140, rawY: 100, others: [a, b], ...desk, settings, activeKeys: noActive })
    expect(result.x).toBe(300 - dragged.widthMm)
    expect(result.activeKeys.x).toBe(`item:${b.id}:x:max-max`)
    expect(result.guides.filter((guide) => guide.axis === 'x')).toHaveLength(1)
  })

  it('breaks ties deterministically: desk edge before desk center', () => {
    // 宽 1560 的设备放在 x=10：左缘距桌面左缘 10，中心距桌面中心也是 10，
    // 两者位移并列，按优先级边应胜出（吸附到 x=0，而不是中线吸附到 x=20）
    const item = { ...itemAt('speaker', 10, 100), widthMm: 1560 }
    const result = computeSnap({ item, rawX: 10, rawY: 100, others: [], ...desk, settings, activeKeys: noActive })
    expect(result.x).toBe(0)
    expect(result.activeKeys.x).toBe('desk:desk:x:min-min')
  })

  it('keeps snapping with hysteresis until the wider release threshold', () => {
    const item = itemAt('monitor', 0, 100)
    const engaged = computeSnap({ item, rawX: 4, rawY: 100, others: [], ...desk, settings, activeKeys: noActive })
    expect(engaged.x).toBe(0)
    const key = engaged.activeKeys.x
    // 已咬入后，位移 13（大于咬入阈值、小于释放阈值）仍然吸附
    const held = computeSnap({ item, rawX: SNAP_ENGAGE_MM + 3, rawY: 100, others: [], ...desk, settings, activeKeys: { x: key, y: null } })
    expect(held.x).toBe(0)
    expect(held.activeKeys.x).toBe(key)
    // 超过释放阈值才脱离
    const released = computeSnap({ item, rawX: SNAP_RELEASE_MM + 1, rawY: 100, others: [], ...desk, settings, activeKeys: { x: key, y: null } })
    expect(released.activeKeys.x).toBeNull()
  })

  it('does not snap beyond the engage threshold when nothing is active', () => {
    const item = itemAt('monitor', SNAP_ENGAGE_MM + 1, 100)
    const result = computeSnap({ item, rawX: item.x, rawY: 100, others: [], ...desk, settings, activeKeys: noActive })
    expect(result.x).toBe(item.x)
    expect(result.activeKeys.x).toBeNull()
  })
})

describe('computeSnap step and master switch', () => {
  it('rounds free movement to the configured step when not smart-snapped', () => {
    const result = computeSnap({
      item: itemAt('monitor', 323, 187),
      rawX: 323,
      rawY: 187,
      others: [],
      ...desk,
      settings: { enabled: true, stepMm: 25 },
      activeKeys: noActive,
    })
    expect(result.x).toBe(325)
    expect(result.y).toBe(175)
  })

  it('prefers a smart snap over the step grid', () => {
    const result = computeSnap({
      item: itemAt('monitor', 6, 103),
      rawX: 6,
      rawY: 103,
      others: [],
      ...desk,
      settings: { enabled: true, stepMm: 25 },
      activeKeys: noActive,
    })
    expect(result.x).toBe(0)
    expect(result.y).toBe(100)
  })

  it('follows the pointer exactly and emits no guides when snapping is disabled', () => {
    const result = computeSnap({
      item: itemAt('monitor', 6, 103),
      rawX: 6,
      rawY: 103,
      others: [],
      ...desk,
      settings: { enabled: false, stepMm: 25 },
      activeKeys: noActive,
    })
    expect(result).toMatchObject({ x: 6, y: 103, guides: [], gaps: [] })
    expect(result.activeKeys).toEqual({ x: null, y: null })
  })
})

describe('normalizeSnapSettings', () => {
  it('falls back to safe defaults for damaged payloads', () => {
    expect(normalizeSnapSettings(null)).toEqual(DEFAULT_SNAP_SETTINGS)
    expect(normalizeSnapSettings('nope').stepMm).toBe(DEFAULT_SNAP_SETTINGS.stepMm)
    expect(normalizeSnapSettings({ enabled: false, stepMm: 7 })).toEqual({ enabled: false, stepMm: DEFAULT_SNAP_SETTINGS.stepMm })
    expect(normalizeSnapSettings({ enabled: true, stepMm: STEP_OPTIONS[1] }).stepMm).toBe(STEP_OPTIONS[1])
  })
})
