import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Magnet, Move, RotateCw } from 'lucide-react'
import type { DeskItem, LayoutAnalysis, WorkspacePlan } from '../../../shared/models'
import { getDeviceDefinition } from '../../../shared/models'
import { getItemBounds } from '../../../shared/layoutRules'
import { computeSnap, type GapMeasurement, type GuideLine } from '../snapping'
import { useSnapSettings } from '../useSnapSettings'
import { Ruler } from './Ruler'

interface CanvasStageProps {
  plan: WorkspacePlan
  selectedItemId: string | null
  analysis: LayoutAnalysis
  onSelect: (id: string | null) => void
  onCommit: (id: string, x: number, y: number) => void
  /** 只读模式（预览弹窗）：隐藏吸附工具条，禁用拖动 */
  readOnly?: boolean
}

interface DragSession {
  id: string
  grabOffsetX: number
  grabOffsetY: number
  originX: number
  originY: number
  /** 上一帧的吸附候选 key，传给引擎做迟滞 */
  activeKeys: { x: string | null; y: string | null }
}

interface LivePreview {
  x: number
  y: number
  guides: GuideLine[]
  gaps: GapMeasurement[]
}

interface DeskFrame {
  widthMm: number
  heightMm: number
}

const COMMIT_EPSILON_MM = 0.5

export function CanvasStage({ plan, selectedItemId, analysis, onSelect, onCommit, readOnly = false }: CanvasStageProps) {
  const stageRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<DragSession | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [preview, setPreviewState] = useState<LivePreview | null>(null)
  const previewRef = useRef<LivePreview | null>(null)
  const setPreview = useCallback((next: LivePreview | null) => {
    previewRef.current = next
    setPreviewState(next)
  }, [])
  const [frame, setFrame] = useState<DeskFrame>({ widthMm: 0, heightMm: 0 })
  const [cursorMm, setCursorMm] = useState<{ x: number | null; y: number | null }>({ x: null, y: null })
  const { settings, setEnabled, setStep } = useSnapSettings()

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const othersById = useMemo(() => new Map(plan.items.map((item) => [item.id, item])), [plan.items])

  const measureFrame = useCallback(() => {
    const svg = stageRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    // 画布使用 aspect-ratio 精确铺满，理论上无留白；仍按实际测量结果给标尺
    setFrame({ widthMm: rect.width, heightMm: rect.height })
  }, [])

  useLayoutEffect(() => {
    measureFrame()
    const svg = stageRef.current
    if (!svg || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measureFrame)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [measureFrame])

  const toDeskMm = useCallback((clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return null
    const x = ((clientX - rect.left) / rect.width) * plan.deskWidthMm
    const y = ((clientY - rect.top) / rect.height) * plan.deskHeightMm
    return { x, y, inside: x >= 0 && y >= 0 && x <= plan.deskWidthMm && y <= plan.deskHeightMm }
  }, [plan.deskHeightMm, plan.deskWidthMm])

  const startDrag = (event: ReactPointerEvent<SVGGElement>, item: DeskItem) => {
    event.stopPropagation()
    if (readOnly) return
    const point = toDeskMm(event.clientX, event.clientY)
    if (!point) return
    onSelect(item.id)
    dragRef.current = {
      id: item.id,
      grabOffsetX: point.x - item.x,
      grabOffsetY: point.y - item.y,
      originX: item.x,
      originY: item.y,
      activeKeys: { x: null, y: null },
    }
    setDragId(item.id)
    setPreview(null)
  }

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const point = toDeskMm(event.clientX, event.clientY)
      if (point) setCursorMm({ x: Math.min(plan.deskWidthMm, Math.max(0, point.x)), y: Math.min(plan.deskHeightMm, Math.max(0, point.y)) })
      const drag = dragRef.current
      if (!drag || !point) return
      const item = othersById.get(drag.id)
      if (!item) return
      const rawX = point.x - drag.grabOffsetX
      const rawY = point.y - drag.grabOffsetY
      const others = plan.items.filter((candidate) => candidate.id !== drag.id)
      const snap = computeSnap({
        item,
        rawX,
        rawY,
        others,
        deskWidthMm: plan.deskWidthMm,
        deskHeightMm: plan.deskHeightMm,
        settings: settingsRef.current,
        activeKeys: drag.activeKeys,
      })
      // 吸附结果仅保存在拖拽会话与本地预览状态里，不经过 onCommit，因此不会写入模型/存储
      drag.activeKeys = snap.activeKeys
      setPreview({ x: snap.x, y: snap.y, guides: snap.guides, gaps: snap.gaps })
    }
    const handleUp = () => {
      const drag = dragRef.current
      const live = previewRef.current
      if (drag && live) {
        // 松手才决定最终位置：与起点有实际位移才提交，中途吸附过的位置不会被保存
        if (Math.abs(live.x - drag.originX) > COMMIT_EPSILON_MM || Math.abs(live.y - drag.originY) > COMMIT_EPSILON_MM) {
          onCommit(drag.id, Math.round(live.x), Math.round(live.y))
        }
      }
      dragRef.current = null
      setDragId(null)
      setPreview(null)
    }
    const handleLeave = () => setCursorMm({ x: null, y: null })
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    const stage = stageRef.current
    stage?.addEventListener('pointerleave', handleLeave)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
      stage?.removeEventListener('pointerleave', handleLeave)
    }
  }, [toDeskMm, othersById, plan, onCommit, onSelect, setPreview])

  const liveItemId = dragId
  const snapTargetIds = useMemo(() => {
    const ids = new Set<string>()
    preview?.guides.forEach((guide) => {
      if (guide.scope === 'item' && guide.targetId) ids.add(guide.targetId)
    })
    return ids
  }, [preview])

  const renderedItems = plan.items.map((item) => (
    liveItemId === item.id && preview ? { ...item, x: preview.x, y: preview.y } : item
  ))

  return (
    <div className="canvas-wrap">
      <div className="canvas-toolbar">
        <span className="toolbar-hints"><span><Move size={14} /> 拖动设备调整位置</span><span><RotateCw size={14} /> 旋转请在右侧操作</span></span>
        {!readOnly && (
          <span className="snap-controls">
            <label className={`snap-toggle ${settings.enabled ? 'is-on' : ''}`}>
              <Magnet size={13} />
              <input type="checkbox" checked={settings.enabled} onChange={(event) => setEnabled(event.currentTarget.checked)} />
              吸附
            </label>
            <label className={`step-control ${settings.enabled ? '' : 'is-disabled'}`}>
              步进
              <select
                value={settings.stepMm}
                disabled={!settings.enabled}
                onChange={(event) => setStep(Number(event.currentTarget.value))}
                aria-label="拖动步进（毫米）"
              >
                <option value={0}>关</option>
                <option value={1}>1 mm</option>
                <option value={5}>5 mm</option>
                <option value={10}>10 mm</option>
                <option value={25}>25 mm</option>
                <option value={50}>50 mm</option>
              </select>
            </label>
          </span>
        )}
      </div>
      <div className="canvas-frame">
        <div className="ruler-corner" />
        <Ruler orientation="horizontal" mmSize={plan.deskWidthMm} pxSize={frame.widthMm} cursorMm={cursorMm.x} />
        <Ruler orientation="vertical" mmSize={plan.deskHeightMm} pxSize={frame.heightMm} cursorMm={cursorMm.y} />
        <svg
          ref={stageRef}
          className="desk-canvas"
          viewBox={`0 0 ${plan.deskWidthMm} ${plan.deskHeightMm}`}
          preserveAspectRatio="none"
          style={{ aspectRatio: `${plan.deskWidthMm} / ${plan.deskHeightMm}` }}
          role="img"
          aria-label={`桌面布局画布，${plan.deskWidthMm}乘${plan.deskHeightMm}毫米`}
          onPointerDown={() => onSelect(null)}
        >
          <defs>
            <pattern id="desk-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="#d8e1ed" strokeWidth="1" /></pattern>
            <filter id="item-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#20304a" floodOpacity=".12" /></filter>
          </defs>
          <rect width={plan.deskWidthMm} height={plan.deskHeightMm} rx="22" fill="#f8fafc" />
          <rect width={plan.deskWidthMm} height={plan.deskHeightMm} rx="22" fill="url(#desk-grid)" />
          <text x="34" y="48" fill="#a0aec0" fontSize="20" letterSpacing="3">FOCUS ZONE / {plan.deskWidthMm} × {plan.deskHeightMm} MM</text>
          {renderedItems.map((item) => {
            const definition = getDeviceDefinition(item.type)
            const isSelected = selectedItemId === item.id
            const isDragging = liveItemId === item.id
            const isSnapTarget = snapTargetIds.has(item.id)
            const hasIssue = !isDragging && (analysis.overlapIds.includes(item.id) || analysis.outOfBoundsIds.includes(item.id))
            const cx = item.x + item.widthMm / 2
            const cy = item.y + item.heightMm / 2
            return <g className={`desk-item ${readOnly ? 'is-readonly' : ''} ${isSelected ? 'is-selected' : ''} ${hasIssue ? 'has-issue' : ''} ${isDragging ? 'is-dragging' : ''} ${isSnapTarget ? 'is-snap-target' : ''}`} key={item.id} onPointerDown={(event) => startDrag(event, item)} role={readOnly ? undefined : 'button'} tabIndex={readOnly ? undefined : 0} aria-label={`${definition.label}，${item.widthMm}乘${item.heightMm}毫米`}>
              <g transform={`translate(${cx} ${cy}) rotate(${item.rotation})`}>
                <rect x={-item.widthMm / 2} y={-item.heightMm / 2} width={item.widthMm} height={item.heightMm} rx={Math.min(24, item.heightMm / 5)} fill={definition.color} filter="url(#item-shadow)" />
                <rect className="item-inner-line" x={-item.widthMm / 2 + 12} y={-item.heightMm / 2 + 12} width={Math.max(0, item.widthMm - 24)} height={Math.max(0, item.heightMm - 24)} rx={12} fill="none" />
                <text x="0" y="5" textAnchor="middle" fill="#1f2e44" fontWeight="700" fontSize={Math.max(18, Math.min(32, item.widthMm / 16))}>{definition.shortLabel}</text>
                <text x="0" y="30" textAnchor="middle" fill="#44546b" fontSize="16">{item.widthMm} × {item.heightMm}</text>
              </g>
              {isSelected && !isDragging && <rect className="selection-box" x={getItemBounds(item).left - 8} y={getItemBounds(item).top - 8} width={getItemBounds(item).width + 16} height={getItemBounds(item).height + 16} rx="12" fill="none" />}
              {hasIssue && <g transform={`translate(${Math.max(18, getItemBounds(item).right - 4)} ${Math.max(18, getItemBounds(item).top - 4)}`}><circle r="18" fill="#ef6a6a" /><text textAnchor="middle" y="7" fill="white" fontSize="22" fontWeight="700">!</text></g>}
            </g>
          })}
          {preview && <SnapGuides preview={preview} />}
          {plan.items.length === 0 && <g><circle cx={plan.deskWidthMm / 2} cy={plan.deskHeightMm / 2 - 12} r="32" fill="#e8eef6" /><text x={plan.deskWidthMm / 2} y={plan.deskHeightMm / 2 + 2} textAnchor="middle" fill="#8493a8" fontSize="22">+</text><text x={plan.deskWidthMm / 2} y={plan.deskHeightMm / 2 + 48} textAnchor="middle" fill="#8493a8" fontSize="22">从左侧添加第一件设备</text></g>}
        </svg>
      </div>
      <div className="canvas-legend">
        <span><i className="legend-dot clear-dot" /> 可用空间</span>
        <span><i className="legend-dot issue-dot" /> 冲突 / 越界</span>
        {!readOnly && <span className="legend-snap"><Magnet size={10} /> {settings.enabled ? '吸附已开启' : '吸附已关闭'}</span>}
        {!readOnly && <span className="canvas-scale">{settings.enabled ? `步进 ${settings.stepMm === 0 ? '关' : `${settings.stepMm} mm`} · 松手才保存` : '自由拖动 · 松手才保存'}</span>}
        {readOnly && <span className="canvas-scale">只读预览</span>}
      </div>
    </div>
  )
}

function SnapGuides({ preview }: { preview: LivePreview }) {
  const lineColor = '#f0586a'
  return (
    <g className="snap-layer" pointerEvents="none">
      {preview.guides.map((guide, index) => guide.axis === 'x' ? (
        <line
          key={`guide-${index}`}
          x1={guide.position}
          x2={guide.position}
          y1={guide.from}
          y2={guide.to}
          stroke={lineColor}
          strokeWidth={2.5}
          strokeDasharray={guide.scope === 'desk' ? '14 8' : undefined}
        />
      ) : (
        <line
          key={`guide-${index}`}
          x1={guide.from}
          x2={guide.to}
          y1={guide.position}
          y2={guide.position}
          stroke={lineColor}
          strokeWidth={2.5}
          strokeDasharray={guide.scope === 'desk' ? '14 8' : undefined}
        />
      ))}
      {preview.gaps.map((gap, index) => <GapTag key={`gap-${index}`} gap={gap} />)}
    </g>
  )
}

function GapTag({ gap }: { gap: GapMeasurement }) {
  const mid = (gap.from + gap.to) / 2
  const label = `${Math.round(gap.distanceMm)}`
  const textWidth = Math.max(44, label.length * 15 + 26)
  const textHeight = 26
  const isX = gap.axis === 'x'
  const x = isX ? mid - textWidth / 2 : gap.at + 8
  const y = isX ? gap.at + 8 : mid - textHeight / 2
  return (
    <g>
      {isX ? (
        <line x1={gap.from} x2={gap.to} y1={gap.at} y2={gap.at} stroke="#f0586a" strokeWidth={1.5} />
      ) : (
        <line x1={gap.at} x2={gap.at} y1={gap.from} y2={gap.to} stroke="#f0586a" strokeWidth={1.5} />
      )}
      <g transform={`translate(${x} ${y})`}>
        <rect width={textWidth} height={textHeight} rx={6} fill="#f0586a" />
        <text x={textWidth / 2} y={18} textAnchor="middle" fill="#fff" fontSize={16} fontWeight={700}>{label}<tspan fontSize="11" fontWeight={500}> mm</tspan></text>
      </g>
    </g>
  )
}
