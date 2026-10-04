import { describe, expect, it } from 'vitest'
import { buildRulerTicks, chooseRulerInterval } from '../ruler'

describe('ruler ticks', () => {
  it('keeps minor ticks dense on a wide canvas', () => {
    // 1600mm 渲染成 1000px：每 mm 0.625px，10mm 刻度只有 6.25px，抽稀到 25mm
    expect(chooseRulerInterval(1000, 1600)).toEqual({ minor: 25, major: 100 })
    const ticks = buildRulerTicks(1600, 1000)
    expect(ticks[0]).toEqual({ position: 0, size: 9, label: '0' })
    expect(ticks.some((tick) => tick.label === '800')).toBe(true)
    expect(ticks[1].label).toBeUndefined()
  })

  it('switches to coarser ticks when the canvas is small', () => {
    // 600mm 渲染成 200px：每 mm .33px，10mm 刻度仅 3.3px，应自动抽稀
    const interval = chooseRulerInterval(200, 600)
    expect(interval.minor).toBeGreaterThanOrEqual(25)
  })

  it('always includes both ends of the desk', () => {
    const ticks = buildRulerTicks(800, 500)
    expect(ticks[0].position).toBe(0)
    expect(ticks[ticks.length - 1].position).toBe(800)
  })
})
