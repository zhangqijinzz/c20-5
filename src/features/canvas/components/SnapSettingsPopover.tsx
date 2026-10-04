import { forwardRef } from 'react'
import { NUDGE_STEP_OPTIONS, SNAP_THRESHOLD_RANGE, type CanvasSettings } from '../snapping'

interface SnapSettingsPopoverProps {
  settings: CanvasSettings
  onToggleSnapping: (enabled: boolean) => void
  onChangeThreshold: (value: number) => void
  onChangeNudgeStep: (value: number) => void
  onToggleRulers: (visible: boolean) => void
}

export const SnapSettingsPopover = forwardRef<HTMLDivElement, SnapSettingsPopoverProps>(function SnapSettingsPopover(
  { settings, onToggleSnapping, onToggleRulers, onChangeThreshold, onChangeNudgeStep },
  ref,
) {
  return (
    <div className="snap-settings-popover" ref={ref} role="group" aria-label="画布吸附设置">
      <label className="snap-setting-row snap-setting-switch">
        <span><strong>智能吸附</strong><small>四边 / 中线 / 设备边缘与中线</small></span>
        <input
          type="checkbox"
          role="switch"
          checked={settings.snappingEnabled}
          onChange={(event) => onToggleSnapping(event.currentTarget.checked)}
        />
      </label>
      <div className={`snap-setting-disabled ${settings.snappingEnabled ? '' : 'is-disabled'}`}>
        <div className="snap-setting-row snap-setting-range">
          <div><span>吸附步进</span><em>{settings.snapThresholdMm} mm</em></div>
          <input
            type="range"
            min={SNAP_THRESHOLD_RANGE.min}
            max={SNAP_THRESHOLD_RANGE.max}
            step={SNAP_THRESHOLD_RANGE.step}
            value={settings.snapThresholdMm}
            disabled={!settings.snappingEnabled}
            onChange={(event) => onChangeThreshold(event.currentTarget.valueAsNumber)}
          />
          <small>参考线 {settings.snapThresholdMm} mm 内自动靠近</small>
        </div>
      </div>
      <div className="snap-setting-row snap-setting-nudge">
        <div><span>方向键步进</span><small>选中设备后按 ← ↑ → ↓ 微调</small></div>
        <select value={settings.nudgeStepMm} onChange={(event) => onChangeNudgeStep(Number(event.currentTarget.value))}>
          {NUDGE_STEP_OPTIONS.map((step) => <option key={step} value={step}>{step} mm</option>)}
        </select>
      </div>
      <label className="snap-setting-row snap-setting-switch">
        <span><strong>显示标尺</strong><small>毫米刻度与光标位置</small></span>
        <input
          type="checkbox"
          role="switch"
          checked={settings.rulersVisible}
          onChange={(event) => onToggleRulers(event.currentTarget.checked)}
        />
      </label>
    </div>
  )
})
