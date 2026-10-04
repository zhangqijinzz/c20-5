import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CANVAS_SETTINGS,
  DragSnapping,
  clampNudgeStep,
  clampSnapThreshold,
  normalizeCanvasSettings,
} from '../snapping'
import type { DeskItem } from '../../../shared/models'

function item(id: string, x: number, y: number, widthMm = 100, heightMm = 100, rotation = 0): DeskItem {
  return { id, type: 'speaker', widthMm, heightMm, x, y, rotation }
}

const DESK_W = 1000
const DESK_H = 600

describe('DragSnapping', () => {
  it('snaps the dragged item to desk edges and center lines within the threshold', () => {
    // y 中心 280，距桌面中线 300 有 20，超出阈值，所以只有左缘吸附
    const dragged = item('drag', 8, 230, 100, 100)
    const snapping = new DragSnapping(DESK_W, DESK_H, dragged, [], true, 10)
    const result = snapping.update(8, 230)
    expect(result.x).toBe(0)
    expect(result.deltaX).toBe(-8)
    expect(result.guides).toHaveLength(1)
    expect(result.guides[0]).toMatchObject({ axis: 'x', coordinate: 0, scope: 'desk', label: '0 mm' })
  })

  it('snaps both axes independently for diagonal movement', () => {
    const dragged = item('drag', 8, 6, 100, 100)
    const snapping = new DragSnapping(DESK_W, DESK_H, dragged, [], true, 10)
    const result = snapping.update(8, 6)
    expect(result.x).toBe(0)
    expect(result.y).toBe(0)
    expect(result.guides).toHaveLength(2)
    expect(result.guides.map((guide) => guide.axis).sort()).toEqual(['x', 'y'])
  })

  it('aligns edges and centers with other items and reports the perpendicular gap', () => {
    const dragged = item('drag', 254, 100, 100, 100)
    // other 右缘 252，拖动项左缘 254，差 2mm 被拉回；垂直方向两者间距 50（250 - 200）
    const other = item('other', 152, 250, 100, 100)
    const snapping = new DragSnapping(DESK_W, DESK_H, dragged, [other], true, 10)
    const result = snapping.update(254, 100)
    expect(result.x).toBe(252)
    expect(result.guides[0]).toMatchObject({ axis: 'x', coordinate: 252, label: '50 mm' })
    // 徽标放在两台设备之间的空档中点 (225)，x 与参考线一致 (252)
    expect(result.guides[0].badgeX).toBe(252)
    expect(result.guides[0].badgeY).toBe(225)

    // 同一次拖动里继续向左，滞回锁定保持在 other 右缘
    const pulled = snapping.update(252, 100)
    expect(pulled.x).toBe(252)
  })

  it('prefers desk references over item references at equal distance', () => {
    // 拖动项中心 y = 292（距桌面中线 300 为 8）；
    // 另一台设备中心 y = 284（与拖动项中心也恰好差 8）
    const dragged = item('drag', 400, 242, 100, 100)
    const other = item('other', 700, 234, 100, 100)
    const snapping = new DragSnapping(DESK_W, DESK_H, dragged, [other], true, 10)
    const result = snapping.update(400, 242)
    const verticalGuide = result.guides.find((guide) => guide.axis === 'y')
    expect(verticalGuide?.scope).toBe('desk')
    expect(verticalGuide?.coordinate).toBe(300)
  })

  it('keeps a locked reference inside the release band even when another reference becomes closer', () => {
    const dragged = item('drag', 8, 100, 100, 100)
    const snapping = new DragSnapping(DESK_W, DESK_H, dragged, [], true, 10)
    // 先锁住桌面左缘
    expect(snapping.update(8, 100).x).toBe(0)
    // 指针移到左缘与中线之间，但锚点仍在释放带 16mm 内：锁定保持
    const moved = snapping.update(14, 100)
    expect(moved.x).toBe(0)
    expect(moved.guides[0].coordinate).toBe(0)
    // 远离后才释放
    expect(snapping.update(30, 100).guides).toHaveLength(0)
  })

  it('returns stable results for repeated updates at the same raw position (no flicker)', () => {
    const dragged = item('drag', 8, 100, 100, 100)
    const other = item('other', 0, 260, 100, 100)
    const snapping = new DragSnapping(DESK_W, DESK_H, dragged, [other], true, 10)
    const first = snapping.update(8, 100)
    const second = snapping.update(8, 100)
    expect(second).toEqual(first)
  })

  it('uses rotated axis-aligned bounds when snapping', () => {
    const dragged = item('drag', 8, 200, 200, 100, 90)
    const snapping = new DragSnapping(DESK_W, DESK_H, dragged, [], true, 10)
    // 旋转 90° 后包围盒宽 100、高 200，中心 (108,250)；左缘 = 108-50 = 58，不在阈值内 → 不吸附
    const result = snapping.update(8, 200)
    expect(result.x).toBe(8)
    // 把中心 x 放到桌面中线 500 附近时应能吸附中线（旋转后中心仍为 x + width/2 = x+100）
    const centered = new DragSnapping(DESK_W, DESK_H, { ...dragged, x: 406 }, [], true, 10).update(406, 200)
    expect(centered.x).toBe(400)
  })

  it('shows 居中 label for desk center guides', () => {
    const dragged = item('drag', 446, 100, 100, 100)
    const snapping = new DragSnapping(DESK_W, DESK_H, dragged, [], true, 10)
    const result = snapping.update(446, 100)
    expect(result.guides[0].label).toBe('居中')
    expect(result.guides[0].coordinate).toBe(500)
  })

  it('does not snap when disabled and reports zero delta with no guides', () => {
    const dragged = item('drag', 2, 2, 100, 100)
    const snapping = new DragSnapping(DESK_W, DESK_H, dragged, [], false, 10)
    const result = snapping.update(2, 2)
    expect(result).toEqual({ x: 2, y: 2, deltaX: 0, deltaY: 0, guides: [] })
  })
})

describe('canvas settings normalization', () => {
  it('clamps threshold and nudge step to supported values', () => {
    expect(clampSnapThreshold(1)).toBe(4)
    expect(clampSnapThreshold(99)).toBe(40)
    expect(clampSnapThreshold(NaN)).toBe(DEFAULT_CANVAS_SETTINGS.snapThresholdMm)
    expect(clampNudgeStep(7)).toBe(10)
    expect(clampNudgeStep(5)).toBe(5)
  })

  it('falls back to defaults for malformed stored settings', () => {
    expect(normalizeCanvasSettings(null)).toEqual(DEFAULT_CANVAS_SETTINGS)
    expect(normalizeCanvasSettings({ snappingEnabled: false })).toMatchObject({ snappingEnabled: false, snapThresholdMm: 10 })
    expect(normalizeCanvasSettings({ rulersVisible: false })).toMatchObject({ rulersVisible: false })
  })
})
