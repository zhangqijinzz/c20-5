import { describe, expect, it } from 'vitest'
import { chooseTickStep } from '../tickSteps'

describe('chooseTickStep', () => {
  it('picks a 1/2/5 series step whose on-screen spacing meets the minimum', () => {
    // 10 mm 步进时屏幕间距 5px，太小；20 mm 时 10px 满足
    expect(chooseTickStep(0.5, 9)).toBe(20)
    // 1 mm 就有 10px
    expect(chooseTickStep(10, 9)).toBe(1)
    // 缩放极小时退到较大的整十步进
    const step = chooseTickStep(0.002, 9)
    expect(step).toBeGreaterThanOrEqual(1000)
    expect(step * 0.002).toBeGreaterThanOrEqual(9 - 1e-9)
  })

  it('always returns a positive step even for invalid scale', () => {
    expect(chooseTickStep(0, 9)).toBe(100)
    expect(chooseTickStep(NaN, 9)).toBe(100)
  })
})
