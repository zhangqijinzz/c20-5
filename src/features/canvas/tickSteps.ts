/**
 * 在 1/2/5 × 10ⁿ 毫米序列里挑一个最小的、使屏幕像素间距不小于 minPixelSpacing 的步进。
 */
export function chooseTickStep(pxPerMm: number, minPixelSpacing: number): number {
  if (!Number.isFinite(pxPerMm) || pxPerMm <= 0) return 100
  const candidates: number[] = []
  for (let decade = 1; decade <= 1000; decade *= 10) {
    candidates.push(decade, decade * 2, decade * 5)
  }
  const fit = candidates.find((step) => step * pxPerMm >= minPixelSpacing)
  return fit ?? 1000
}
