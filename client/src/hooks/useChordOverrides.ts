import { useCallback, useMemo, useState } from 'react'
import { parse, SHARPS, toHarte } from '../theory/chord'
import type { Segment } from '../types'

interface Override {
  label: string
  bass: string | null
}

function storageKey(songId: string): string {
  return `chordarium:edits:${songId}`
}

function readOverrides(songId: string): Record<number, Override> {
  try {
    const raw = localStorage.getItem(storageKey(songId))
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeOverrides(songId: string, overrides: Record<number, Override>): void {
  try {
    localStorage.setItem(storageKey(songId), JSON.stringify(overrides))
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

function clearOverrides(songId: string): void {
  try {
    localStorage.removeItem(storageKey(songId))
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

export function useChordOverrides(
  songId: string,
  canonicalSegments: Segment[],
): [Segment[], (index: number, label: string, applyToAll: boolean) => void, () => void] {
  const [overrides, setOverrides] = useState<Record<number, Override>>(() => readOverrides(songId))

  const segments = useMemo(
    () => canonicalSegments.map((seg, i) => {
      const o = overrides[i]
      return o ? { ...seg, label: o.label, bass: o.bass, edited: true } : seg
    }),
    [canonicalSegments, overrides],
  )

  const applyEdit = useCallback(
    (index: number, label: string, applyToAll: boolean) => {
      const chord = parse(label)
      const newLabel = toHarte(chord)
      const bass = chord === null ? null : SHARPS[chord.bass ?? chord.root]
      const target = segments[index].label
      const next = { ...overrides }
      segments.forEach((seg, i) => {
        if (i === index || (applyToAll && seg.label === target)) next[i] = { label: newLabel, bass }
      })
      setOverrides(next)
      writeOverrides(songId, next)
    },
    [segments, overrides, songId],
  )

  const reset = useCallback(() => {
    setOverrides({})
    clearOverrides(songId)
  }, [songId])

  return [segments, applyEdit, reset]
}
