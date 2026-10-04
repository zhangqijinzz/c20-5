import { useMemo } from 'react'
import { buildRulerTicks } from '../ruler'

interface RulerProps {
  orientation: 'horizontal' | 'vertical'
  mmSize: number
  pxSize: number
  /** 指针在桌面坐标系中的位置（毫米），用于标尺上的红色游标 */
  cursorMm: number | null
}

/**
 * 画布边缘标尺。刻度按屏幕像素密度自动抽稀，保证数字不重叠。
 * 水平/垂直共用一个组件，差异仅在刻度线方向与文字旋转。
 */
export function Ruler({ orientation, mmSize, pxSize, cursorMm }: RulerProps) {
  const ticks = useMemo(() => buildRulerTicks(mmSize, pxSize), [mmSize, pxSize])
  const pxPerMm = pxSize / mmSize
  const isHorizontal = orientation === 'horizontal'

  return (
    <div
      className={`canvas-ruler ruler-${orientation}`}
      style={isHorizontal ? { width: pxSize } : { height: pxSize }}
      aria-hidden
    >
      {ticks.map((tick) => {
        const px = tick.position * pxPerMm
        const style = isHorizontal
          ? { left: px, height: tick.size }
          : { top: px, width: tick.size }
        return (
          <span className={`ruler-tick ${tick.label !== undefined ? 'is-major' : ''}`} style={style} key={tick.position}>
            {tick.label !== undefined && <span className="ruler-label">{tick.label}</span>}
          </span>
        )
      })}
      {cursorMm !== null && cursorMm >= 0 && cursorMm <= mmSize && (
        <span className="ruler-cursor" style={isHorizontal ? { left: cursorMm * pxPerMm } : { top: cursorMm * pxPerMm }} />
      )}
    </div>
  )
}
