import type { SvgViewport } from './useSvgViewport'
import type { SnapGuide } from './snapping'

export type { SvgViewport }
export type { SnapGuide }

export interface PointerPositionMm {
  x: number
  y: number
}

export interface DragLiveState {
  /** 指针给出的原始（未吸附）位置 */
  rawX: number
  rawY: number
  /** 应用吸附后的临时位置，仅用于渲染 */
  snappedX: number
  snappedY: number
  guides: SnapGuide[]
}
