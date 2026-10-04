import { useEffect, useState, type RefObject } from 'react'

export interface SvgViewport {
  /** 每毫米对应的屏幕像素（X / Y），letterbox 时两者可能不同 */
  pxPerMmX: number
  pxPerMmY: number
  /** 画布 0,0 点相对 SVG 边框的像素偏移（letterbox 留白） */
  originX: number
  originY: number
  /** SVG 元素自身的渲染尺寸 */
  widthPx: number
  heightPx: number
}

const FALLBACK_VIEWPORT: SvgViewport = { pxPerMmX: 1, pxPerMmY: 1, originX: 0, originY: 0, widthPx: 0, heightPx: 0 }

/**
 * 基于 getScreenCTM 反矩阵建立毫米坐标到屏幕像素的映射，
 * 自动兼容 preserveAspectRatio 造成的 letterbox 留白。
 */
export function useSvgViewport(svgRef: RefObject<SVGSVGElement | null>, viewBoxWidthMm: number, viewBoxHeightMm: number): SvgViewport {
  const [viewport, setViewport] = useState<SvgViewport>(FALLBACK_VIEWPORT)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const ctm = svg.getScreenCTM()
      const rect = svg.getBoundingClientRect()
      if (!ctm || rect.width === 0 || rect.height === 0) return
      // 仿射矩阵 a/d 为 x/y 方向缩放（px 每 user unit），e/f 为 (0,0) 的屏幕坐标
      setViewport({
        pxPerMmX: ctm.a,
        pxPerMmY: ctm.d,
        originX: ctm.e - rect.left,
        originY: ctm.f - rect.top,
        widthPx: rect.width,
        heightPx: rect.height,
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [svgRef, viewBoxWidthMm, viewBoxHeightMm])

  return viewport
}
