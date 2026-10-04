import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_CANVAS_SETTINGS,
  clampNudgeStep,
  clampSnapThreshold,
  normalizeCanvasSettings,
  type CanvasSettings,
} from './snapping'

export const CANVAS_SETTINGS_STORAGE_KEY = 'focusdesk.canvas-settings.v1'

export interface CanvasSettingsRepository {
  read(): string | null
  write(value: string): void
}

const browserRepository: CanvasSettingsRepository = {
  read: () => {
    try {
      return window.localStorage.getItem(CANVAS_SETTINGS_STORAGE_KEY)
    } catch {
      return null
    }
  },
  write: (value) => {
    try {
      window.localStorage.setItem(CANVAS_SETTINGS_STORAGE_KEY, value)
    } catch {
      // 隐私模式或存储被禁用时，设置只在本次会话内生效
    }
  },
}

function loadSettings(repository: CanvasSettingsRepository): CanvasSettings {
  const raw = repository.read()
  if (!raw) return { ...DEFAULT_CANVAS_SETTINGS }
  try {
    return normalizeCanvasSettings(JSON.parse(raw) as Partial<CanvasSettings>)
  } catch {
    return { ...DEFAULT_CANVAS_SETTINGS }
  }
}

export function useCanvasSettings(repository: CanvasSettingsRepository = browserRepository) {
  const [settings, setSettings] = useState<CanvasSettings>(() => loadSettings(repository))

  useEffect(() => {
    repository.write(JSON.stringify(settings))
  }, [repository, settings])

  const update = useCallback((patch: Partial<CanvasSettings>) => {
    setSettings((current) => ({ ...current, ...patch }))
  }, [])

  const setThresholdMm = useCallback((value: number) => {
    setSettings((current) => ({ ...current, snapThresholdMm: clampSnapThreshold(value) }))
  }, [])

  const setNudgeStepMm = useCallback((value: number) => {
    setSettings((current) => ({ ...current, nudgeStepMm: clampNudgeStep(value) }))
  }, [])

  return { settings, update, setThresholdMm, setNudgeStepMm }
}
