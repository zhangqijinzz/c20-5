import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_SNAP_SETTINGS, STEP_OPTIONS, type SnapSettings } from './snapping'

const STORAGE_KEY = 'focusdesk.snap.v1'

export function normalizeSnapSettings(value: unknown): SnapSettings {
  if (!value || typeof value !== 'object') return DEFAULT_SNAP_SETTINGS
  const candidate = value as Partial<SnapSettings>
  const enabled = typeof candidate.enabled === 'boolean' ? candidate.enabled : DEFAULT_SNAP_SETTINGS.enabled
  const step = typeof candidate.stepMm === 'number' && STEP_OPTIONS.includes(candidate.stepMm)
    ? candidate.stepMm
    : DEFAULT_SNAP_SETTINGS.stepMm
  return { enabled, stepMm: step }
}

export function loadSnapSettings(storage: Pick<Storage, 'getItem'> = window.localStorage): SnapSettings {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    return raw ? normalizeSnapSettings(JSON.parse(raw)) : DEFAULT_SNAP_SETTINGS
  } catch {
    return DEFAULT_SNAP_SETTINGS
  }
}

/** 吸附偏好只属于本机编辑体验，不进方案文档、不参与云保存。 */
export function useSnapSettings(): {
  settings: SnapSettings
  setEnabled: (enabled: boolean) => void
  setStep: (stepMm: number) => void
} {
  const [settings, setSettings] = useState<SnapSettings>(() => loadSnapSettings())

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // 隐私模式等场景下静默失败，不影响本次编辑
    }
  }, [settings])

  const setEnabled = useCallback((enabled: boolean) => {
    setSettings((current) => ({ ...current, enabled }))
  }, [])
  const setStep = useCallback((stepMm: number) => {
    setSettings((current) => ({ ...current, stepMm: STEP_OPTIONS.includes(stepMm) ? stepMm : current.stepMm }))
  }, [])

  return { settings, setEnabled, setStep }
}
