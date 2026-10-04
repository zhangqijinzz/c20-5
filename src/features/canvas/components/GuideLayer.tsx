import type { SvgViewport, SnapGuide } from '../canvasTypes'

interface GuideLayerProps {
  guides: SnapGuide[]
  deskWidthMm: number
  deskHeightMm: number
  viewport: SvgViewport
}

/**
 * 吸附提示线 + 实时间距徽标。HTML 覆盖层，按 SVG 的毫米映射定位，
 * 因此文字始终以屏幕分辨率清晰显示，不随画布缩放变形。
 */
export function GuideLayer({ guides, deskWidthMm, deskHeightMm, viewport }: GuideLayerProps) {
  if (guides.length === 0) return null
  const widthPx = deskWidthMm * viewport.pxPerMmX
  const heightPx = deskHeightMm * viewport.pxPerMmY

  const toX = (mm: number) => viewport.originX + mm * viewport.pxPerMmX
  const toY = (mm: number) => viewport.originY + mm * viewport.pxPerMmY

  return (
    <div className="snap-guide-layer" aria-hidden="true">
      {guides.map((guide, index) => {
        const key = `${guide.axis}-${guide.coordinate.toFixed(2)}-${index}`
        if (guide.axis === 'x') {
          return (
            <div key={key}>
              <span
                className={`snap-guide snap-guide-v scope-${guide.scope}`}
                style={{ left: toX(guide.coordinate), top: viewport.originY, height: heightPx }}
              />
              <span
                className={`snap-badge scope-${guide.scope}`}
                style={{ left: toX(guide.badgeX), top: toY(guide.badgeY) }}
              >
                {guide.label}
              </span>
            </div>
          )
        }
        return (
          <div key={key}>
            <span
              className={`snap-guide snap-guide-h scope-${guide.scope}`}
              style={{ top: toY(guide.coordinate), left: viewport.originX, width: widthPx }}
            />
            <span
              className={`snap-badge scope-${guide.scope}`}
              style={{ left: toX(guide.badgeX), top: toY(guide.badgeY) }}
            >
              {guide.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
