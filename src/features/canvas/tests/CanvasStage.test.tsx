// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasStage } from '../components/CanvasStage'
import { createPlan } from '../../../shared/models'

// jsdom 不实现 PointerEvent，用 MouseEvent 顶替（组件按事件名监听）
function pointerEvent(type: string, clientX: number, clientY: number): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY, cancelable: true })
  return event
}

function svgRect(width = 800, height = 400) {
  return { left: 34, top: 34, width, height, right: width + 34, bottom: height + 34, x: 34, y: 34, toJSON: () => ({}) }
}

describe('CanvasStage drag commit semantics', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    // 让 SVG 有可测量的尺寸；viewBox 1600x800 对应比例 0.5
    vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue(svgRect() as unknown as DOMRect)
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    container.remove()
  })

  it('does not commit while dragging; commits the snapped position exactly once on pointer up', async () => {
    const plan = createPlan('测试', false)
    // 两件 540 宽显示器：先放置，拖第二件靠近第一件右边缘
    plan.items = [
      { id: 'a', type: 'monitor', widthMm: 540, heightMm: 210, x: 100, y: 100, rotation: 0 },
      { id: 'b', type: 'monitor', widthMm: 540, heightMm: 210, x: 660, y: 100, rotation: 0 },
    ]
    const commits: Array<[string, number, number]> = []
    const root = createRoot(container)
    act(() => {
      root.render(
        <CanvasStage
          plan={plan}
          selectedItemId="b"
          analysis={{ overlapIds: [], outOfBoundsIds: [], coveragePercent: 0, status: 'clear' }}
          onSelect={() => undefined}
          onCommit={(id, x, y) => commits.push([id, x, y])}
        />,
      )
    })

    const items = container.querySelectorAll('g.desk-item')
    const dragged = items[1] as SVGGElement

    // 坐标换算：scale=0.5，内容居中无留白（800/1600 == 400/800）
    // 抓起时鼠标在 b 左上 (660,100) => 客户端 (34+330, 34+50)
    act(() => { dragged.dispatchEvent(pointerEvent('pointerdown', 34 + 330, 34 + 50)) })

    // 拖动：raw x=646（左缘距 a 右缘 640 为 6，应吸附到 640）
    // grabOffset 为 0，client = 34 + rawX * 0.5；来回移动几帧再回到吸附点
    for (const clientX of [34 + 322, 34 + 324, 34 + 323]) {
      act(() => { window.dispatchEvent(pointerEvent('pointermove', clientX, 34 + 50)) })
    }
    // 拖动过程中绝不提交
    expect(commits).toEqual([])

    act(() => { window.dispatchEvent(pointerEvent('pointerup', 34 + 323, 34 + 50)) })

    expect(commits).toHaveLength(1)
    expect(commits[0][0]).toBe('b')
    expect(commits[0][1]).toBe(640)
  })

  it('does not commit when released at the original position (a click without movement)', () => {
    const plan = createPlan('测试', false)
    plan.items = [{ id: 'a', type: 'speaker', widthMm: 150, heightMm: 150, x: 200, y: 200, rotation: 0 }]
    const commits: Array<[string, number, number]> = []
    const root = createRoot(container)
    act(() => {
      root.render(
        <CanvasStage
          plan={plan}
          selectedItemId="a"
          analysis={{ overlapIds: [], outOfBoundsIds: [], coveragePercent: 0, status: 'clear' }}
          onSelect={() => undefined}
          onCommit={(id, x, y) => commits.push([id, x, y])}
        />,
      )
    })
    const dragged = container.querySelector('g.desk-item') as SVGGElement
    act(() => { dragged.dispatchEvent(pointerEvent('pointerdown', 34 + 100, 34 + 100)) })
    act(() => { window.dispatchEvent(pointerEvent('pointerup', 34 + 100, 34 + 100)) })
    expect(commits).toEqual([])
  })
})
