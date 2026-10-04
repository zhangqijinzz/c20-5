import type { PointerPositionMm, SvgViewport } from '../canvasTypes'
import { chooseTickStep } from '../tickSteps'

interface RulersProps {
  widthMm: number
  heightMm: number
  viewport: SvgViewport
  pointer: PointerPositionMm | null
}

/**
 * 屏幕空间标尺：刻度为毫米，主刻度带数字，拖动设备时显示跟随光标的游标。
 */
export function Rulers({ widthMm, heightMm, viewport, pointer }: RulersProps) {
  const horizontalTicks = buildTicks(widthMm, viewport.pxPerMmX, viewport.originX, viewport.widthPx)
  const verticalTicks = buildTicks(heightMm, viewport.pxPerMmY, viewport.originY, viewport.heightPx)

  const cursorTrackX = pointer ? pointer.x * viewport.pxPerMmX : null
  const cursorTrackY = pointer ? pointer.y * viewport.pxPerMmY : null

  return (
    <>
      <div className="ruler ruler-horizontal" aria-hidden="true">
        <div className="ruler-corner" />
        <div className="ruler-track" style={{ left: viewport.originX, width: Math.max(0, viewport.widthPx - viewport.originX) }}>
          {horizontalTicks.map((tick) => (
            <span
              key={tick.mm}
              className={`ruler-tick ${tick.major ? 'is-major' : ''}`}
              style={{ left: tick.px }}
            >
              {tick.major && <em>{tick.mm}</em>}
            </span>
          ))}
          {cursorTrackX !== null && <span className="ruler-cursor" style={{ left: cursorTrackX }} />}
        </div>
      </div>
      <div className="ruler ruler-vertical" aria-hidden="true">
        {verticalTicks.map((tick) => (
          <span
            key={tick.mm}
            className={`ruler-tick ${tick.major ? 'is-major' : ''}`}
            style={{ top: viewport.originY + tick.px }}
          >
            {tick.major && <em>{tick.mm}</em>}
          </span>
        ))}
        {cursorTrackY !== null && <span className="ruler-cursor" style={{ top: viewport.originY + cursorTrackY }} />}
      </div>
    </>
  )
}

interface Tick { mm: number; px: number; major: boolean }

function buildTicks(lengthMm: number, pxPerMm: number, originPx: number, svgLengthPx: number): Tick[] {
  if (pxPerMm <= 0) return []
  const minorStep = chooseTickStep(pxPerMm, 9)
  const majorStep = minorStep * 5
  const startMm = Math.max(0, Math.floor(-originPx / pxPerMm / minorStep) * minorStep)
  const endMm = Math.min(lengthMm, (svgLengthPx - originPx) / pxPerMm)
  const ticks: Tick[] = []
  for (let mm = startMm; mm <= endMm + 0.001; mm += minorStep) {
    ticks.push({ mm, px: mm * pxPerMm, major: Math.abs(mm / majorStep - Math.round(mm / majorStep)) < 0.001 })
  }
  return ticks
}
