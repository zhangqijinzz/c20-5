export interface RulerTick {
  /** 毫米坐标 */
  position: number
  /** 刻度长度（像素） */
  size: number
  /** 主刻度的文字标注 */
  label?: string
}

/**
 * 根据画布在屏幕上的像素尺寸选择毫米刻度间隔。
 * 保证主刻度之间至少有约 48px，避免数字挤在一起。
 */
export function chooseRulerInterval(pixelSize: number, mmSize: number): { minor: number; major: number } {
  if (pixelSize <= 0 || mmSize <= 0) return { minor: 50, major: 100 }
  const pxPerMm = pixelSize / mmSize
  const candidates = [
    { minor: 10, major: 50 },
    { minor: 25, major: 100 },
    { minor: 50, major: 200 },
    { minor: 100, major: 500 },
    { minor: 200, major: 1000 },
  ]
  const picked = candidates.find(({ minor }) => minor * pxPerMm >= 8) ?? candidates[candidates.length - 1]
  // 主刻度间隔需要容纳三位数字，目标不小于 48px
  if (picked.major * pxPerMm >= 48) return picked
  return { minor: picked.minor, major: picked.major * 2 }
}

export function buildRulerTicks(mmSize: number, pixelSize: number): RulerTick[] {
  const { minor, major } = chooseRulerInterval(pixelSize, mmSize)
  const ticks: RulerTick[] = []
  for (let position = 0; position <= mmSize + 0.001; position += minor) {
    const rounded = Math.round(position * 100) / 100
    const isMajor = rounded % major === 0
    ticks.push({ position: rounded, size: isMajor ? 9 : 5, label: isMajor ? String(rounded) : undefined })
  }
  return ticks
}
