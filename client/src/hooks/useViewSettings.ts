import { useCallback, useState } from 'react'

export const RATES = [0.5, 0.75, 1, 1.25, 1.5]

export interface ViewSettings {
  transpose: number
  capo: number
  simplify: boolean
  rate: number
  showBass: boolean
}

export const DEFAULT_VIEW: ViewSettings = { transpose: 0, capo: 0, simplify: false, rate: 1, showBass: true }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)))

export function normalizeView(v: Partial<ViewSettings>): ViewSettings {
  const m = { ...DEFAULT_VIEW, ...v }
  return {
    transpose: clamp(m.transpose, -6, 6),
    capo: clamp(m.capo, 0, 7),
    simplify: Boolean(m.simplify),
    rate: RATES.includes(m.rate) ? m.rate : 1,
    showBass: m.showBass !== false,
  }
}

function read(key: string): ViewSettings {
  try {
    const raw = localStorage.getItem(key)
    return raw ? normalizeView(JSON.parse(raw)) : DEFAULT_VIEW
  } catch {
    return DEFAULT_VIEW
  }
}

export function useViewSettings(songId: string): [ViewSettings, (patch: Partial<ViewSettings>) => void] {
  const key = `chordarium:view:${songId}`
  const [settings, setSettings] = useState<ViewSettings>(() => read(key))
  const update = useCallback(
    (patch: Partial<ViewSettings>) => {
      setSettings((prev) => {
        const next = normalizeView({ ...prev, ...patch })
        try {
          localStorage.setItem(key, JSON.stringify(next))
        } catch {
          /* storage unavailable: keep in memory only */
        }
        return next
      })
    },
    [key],
  )
  return [settings, update]
}
