import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Magnet, Move, RotateCw, SlidersHorizontal } from 'lucide-react'
import type { DeskItem, LayoutAnalysis, WorkspacePlan } from '../../../shared/models'
import { getDeviceDefinition } from '../../../shared/models'
import { analyzeLayout, getItemBounds } from '../../../shared/layoutRules'
import { DragSnapping } from '../snapping'
import { useCanvasSettings } from '../useCanvasSettings'
import { useSvgViewport } from '../useSvgViewport'
import type { DragLiveState, PointerPositionMm } from '../canvasTypes'
import { Rulers } from './Rulers'
import { GuideLayer } from './GuideLayer'
import { SnapSettingsPopover } from './SnapSettingsPopover'

interface CanvasStageProps {
  plan: WorkspacePlan
  selectedItemId: string | null
  analysis: LayoutAnalysis
  onSelect: (id: string | null) => void
  onMove: (id: string, x: number, y: number) => void
  /** 预览弹层中只读：不响应拖动、微调与取消选择 */
  interactive?: boolean
}

interface DragState {
  id: string
  offsetX: number
  offsetY: number
  snapping: DragSnapping
}

export function CanvasStage({ plan, selectedItemId, analysis, onSelect, onMove, interactive = true }: CanvasStageProps) {
  const stageRef = useRef<SVGSVGElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const settingsPopoverRef = useRef<HTMLDivElement>(null)
  const { settings, update, setThresholdMm, setNudgeStepMm } = useCanvasSettings()
  const viewport = useSvgViewport(stageRef, plan.deskWidthMm, plan.deskHeightMm)

  /** 拖动中的指针状态：这里的数据只用于渲染，松手前绝不调用 onMove 写存储 */
  const [drag, setDrag] = useState<DragState | null>(null)
  const [live, setLive] = useState<DragLiveState | null>(null)
  const [pointer, setPointer] = useState<PointerPositionMm | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const interactiveRef = useRef(interactive)
  interactiveRef.current = interactive
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const movedRef = useRef(false)

  const scaleToMm = useCallback((clientX: number, clientY: number) => {
    const ctm = stageRef.current?.getScreenCTM()
    if (!ctm) return null
    // 用 SVG 自身的 CTM 反矩阵换算，兼容 letterbox，而不是简单按外框比例
    const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    return { x: point.x, y: point.y }
  }, [])

  // 拖动中的设备：位置取临时吸附结果，仅供渲染与实时检查
  const draggedItem = useMemo(() => {
    if (!drag || !live) return null
    const origin = plan.items.find((item) => item.id === drag.id)
    return origin ? { ...origin, x: live.snappedX, y: live.snappedY } : null
  }, [drag, live, plan.items])

  const livePlan = useMemo<WorkspacePlan>(() => {
    if (!draggedItem) return plan
    return { ...plan, items: plan.items.map((item) => item.id === draggedItem.id ? draggedItem : item) }
  }, [draggedItem, plan])

  const liveAnalysis = useMemo(() => analyzeLayout(livePlan), [livePlan])

  const finishDrag = useCallback((state: DragState, rawX: number, rawY: number) => {
    // 松手时复用拖动会话再算一次，保证“所见即所得”；吸附关闭时原样提交
    if (!settingsRef.current.snappingEnabled) return { x: rawX, y: rawY }
    const result = state.snapping.update(rawX, rawY)
    return { x: result.x, y: result.y }
  }, [])

  useEffect(() => {
    if (!drag) return
    movedRef.current = false
    const handleMove = (event: PointerEvent) => {
      const point = scaleToMm(event.clientX, event.clientY)
      if (!point) return
      const rawX = point.x - drag.offsetX
      const rawY = point.y - drag.offsetY
      const snapped = drag.snapping.update(rawX, rawY)
      movedRef.current = true
      setLive({ rawX, rawY, snappedX: snapped.x, snappedY: snapped.y, guides: snapped.guides })
      setPointer(point)
    }
    const handleUp = (event: PointerEvent) => {
      const point = scaleToMm(event.clientX, event.clientY)
      const current = drag
      const moved = movedRef.current
      setDrag(null)
      setLive(null)
      setPointer(null)
      if (!point || !interactiveRef.current) return
      const rawX = point.x - current.offsetX
      const rawY = point.y - current.offsetY
      // 纯点击（没有发生过 pointermove）不应用吸附，避免“点一下就被吸走”
      const finalPosition = moved ? finishDrag(current, rawX, rawY) : { x: rawX, y: rawY }
      const origin = plan.items.find((item) => item.id === current.id)
      // 只在松手时提交一次；位置几乎没变（含纯点击）不产生保存
      if (origin && (Math.abs(origin.x - finalPosition.x) > 0.5 || Math.abs(origin.y - finalPosition.y) > 0.5)) {
        onMove(current.id, Math.round(finalPosition.x * 10) / 10, Math.round(finalPosition.y * 10) / 10)
      }
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [drag, finishDrag, onMove, plan.items, scaleToMm])

  // Esc 取消拖动：丢弃全部临时位置，设备回到起点且不保存
  useEffect(() => {
    if (!drag) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        drag.snapping.reset()
        setDrag(null)
        setLive(null)
        setPointer(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [drag])

  // 方向键按设置步进微调（离散操作，直接提交）
  const nudgeItem = useCallback((event: KeyboardEvent) => {
    if (!interactive || !selectedItemId || drag) return
    const target = event.target as HTMLElement | null
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    }
    const delta = deltas[event.key]
    if (!delta) return
    const item = plan.items.find((candidate) => candidate.id === selectedItemId)
    if (!item) return
    event.preventDefault()
    const step = settingsRef.current.nudgeStepMm
    onMove(item.id, item.x + delta[0] * step, item.y + delta[1] * step)
  }, [interactive, selectedItemId, drag, plan.items, onMove])

  useEffect(() => {
    window.addEventListener('keydown', nudgeItem)
    return () => window.removeEventListener('keydown', nudgeItem)
  }, [nudgeItem])

  // 点击设置面板外关闭
  useEffect(() => {
    if (!settingsOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (settingsPopoverRef.current?.contains(target) || settingsButtonRef.current?.contains(target)) return
      setSettingsOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [settingsOpen])

  const startDrag = (event: ReactPointerEvent<SVGGElement>, item: DeskItem) => {
    if (!interactive) return
    event.stopPropagation()
    const point = scaleToMm(event.clientX, event.clientY)
    if (!point) return
    onSelect(item.id)
    // 吸附目标取按下瞬间的其它设备快照，整次拖动中保持引用稳定
    const others = plan.items.filter((candidate) => candidate.id !== item.id)
    const snapping = new DragSnapping(
      plan.deskWidthMm,
      plan.deskHeightMm,
      item,
      others,
      settingsRef.current.snappingEnabled,
      settingsRef.current.snapThresholdMm,
    )
    setDrag({ id: item.id, offsetX: point.x - item.x, offsetY: point.y - item.y, snapping })
  }

  const renderedAnalysis = live ? liveAnalysis : analysis
  const showRulers = settings.rulersVisible
  const movingId = draggedItem?.id ?? null

  return (
    <div className={`canvas-wrap ${showRulers ? 'with-rulers' : ''}`}>
      <div className="canvas-toolbar">
        <span className="canvas-toolbar-left">
          <Move size={14} /> 拖动设备调整位置
          {live && draggedItem && <em className="drag-readout">X {Math.round(draggedItem.x)} · Y {Math.round(draggedItem.y)} mm</em>}
        </span>
        <span className="canvas-toolbar-actions">
          <span className="toolbar-hint"><RotateCw size={14} /> 旋转请在右侧操作</span>
          <button
            ref={settingsButtonRef}
            type="button"
            className={`snap-settings-button ${settings.snappingEnabled ? 'is-on' : 'is-off'} ${settingsOpen ? 'is-open' : ''}`}
            aria-expanded={settingsOpen}
            aria-label="画布吸附与标尺设置"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Magnet size={14} />
            吸附 {settings.snappingEnabled ? '开' : '关'}
            <SlidersHorizontal size={11} />
          </button>
        </span>
      </div>
      {settingsOpen && (
        <SnapSettingsPopover
          ref={settingsPopoverRef}
          settings={settings}
          onToggleSnapping={(enabled) => update({ snappingEnabled: enabled })}
          onChangeThreshold={setThresholdMm}
          onChangeNudgeStep={setNudgeStepMm}
          onToggleRulers={(visible) => update({ rulersVisible: visible })}
        />
      )}
      <div className="canvas-screen">
        {showRulers && <Rulers widthMm={plan.deskWidthMm} heightMm={plan.deskHeightMm} viewport={viewport} pointer={drag ? pointer : null} />}
        <svg ref={stageRef} className="desk-canvas" viewBox={`0 0 ${plan.deskWidthMm} ${plan.deskHeightMm}`} role="img" aria-label={`桌面布局画布，${plan.deskWidthMm}乘${plan.deskHeightMm}毫米`} onPointerDown={() => interactive && onSelect(null)}>
          <defs>
            <pattern id="desk-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="#d8e1ed" strokeWidth="1" /></pattern>
            <filter id="item-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#20304a" floodOpacity=".12" /></filter>
          </defs>
          <rect width={plan.deskWidthMm} height={plan.deskHeightMm} rx="22" fill="#f8fafc" />
          <rect width={plan.deskWidthMm} height={plan.deskHeightMm} rx="22" fill="url(#desk-grid)" />
          <text x="34" y="48" fill="#a0aec0" fontSize="20" letterSpacing="3">FOCUS ZONE / {plan.deskWidthMm} × {plan.deskHeightMm} MM</text>
          {livePlan.items.map((item) => {
            const definition = getDeviceDefinition(item.type)
            const isSelected = selectedItemId === item.id
            const isMoving = movingId === item.id
            const hasIssue = renderedAnalysis.overlapIds.includes(item.id) || renderedAnalysis.outOfBoundsIds.includes(item.id)
            const cx = item.x + item.widthMm / 2
            const cy = item.y + item.heightMm / 2
            return <g className={`desk-item ${isSelected ? 'is-selected' : ''} ${hasIssue ? 'has-issue' : ''} ${isMoving ? 'is-dragging' : ''}`} key={item.id} onPointerDown={(event) => startDrag(event, item)} role="button" tabIndex={0} aria-label={`${definition.label}，${item.widthMm}乘${item.heightMm}毫米`}>
              <g transform={`translate(${cx} ${cy}) rotate(${item.rotation})`}>
                <rect x={-item.widthMm / 2} y={-item.heightMm / 2} width={item.widthMm} height={item.heightMm} rx={Math.min(24, item.heightMm / 5)} fill={definition.color} filter="url(#item-shadow)" />
                <rect className="item-inner-line" x={-item.widthMm / 2 + 12} y={-item.heightMm / 2 + 12} width={Math.max(0, item.widthMm - 24)} height={Math.max(0, item.heightMm - 24)} rx={12} fill="none" />
                <text x="0" y="5" textAnchor="middle" fill="#1f2e44" fontWeight="700" fontSize={Math.max(18, Math.min(32, item.widthMm / 16))}>{definition.shortLabel}</text>
                <text x="0" y="30" textAnchor="middle" fill="#44546b" fontSize="16">{item.widthMm} × {item.heightMm}</text>
              </g>
              {isSelected && !isMoving && <rect className="selection-box" x={getItemBounds(item).left - 8} y={getItemBounds(item).top - 8} width={getItemBounds(item).width + 16} height={getItemBounds(item).height + 16} rx="12" fill="none" />}
              {hasIssue && <g transform={`translate(${Math.max(18, getItemBounds(item).right - 4)} ${Math.max(18, getItemBounds(item).top - 4)}`}><circle r="18" fill="#ef6a6a" /><text textAnchor="middle" y="7" fill="white" fontSize="22" fontWeight="700">!</text></g>}
            </g>
          })}
          {plan.items.length === 0 && <g><circle cx={plan.deskWidthMm / 2} cy={plan.deskHeightMm / 2 - 12} r="32" fill="#e8eef6" /><text x={plan.deskWidthMm / 2} y={plan.deskHeightMm / 2 + 2} textAnchor="middle" fill="#8493a8" fontSize="22">+</text><text x={plan.deskWidthMm / 2} y={plan.deskHeightMm / 2 + 48} textAnchor="middle" fill="#8493a8" fontSize="22">从左侧添加第一件设备</text></g>}
        </svg>
        {live && <GuideLayer guides={live.guides} deskWidthMm={plan.deskWidthMm} deskHeightMm={plan.deskHeightMm} viewport={viewport} />}
      </div>
      <div className="canvas-legend">
        <span><i className="legend-dot clear-dot" /> 可用空间</span>
        <span><i className="legend-dot issue-dot" /> 冲突 / 越界</span>
        <span className="snap-state-hint"><Magnet size={10} /> {settings.snappingEnabled ? `吸附 ${settings.snapThresholdMm} mm · 步进 ${settings.nudgeStepMm} mm` : '吸附已关闭'}</span>
        <span className="canvas-scale">单位：mm · Esc 取消拖动</span>
      </div>
    </div>
  )
}
