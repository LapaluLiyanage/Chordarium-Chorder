import { useCallback, useState } from 'react'
import { editSection } from '../sections'
import type { Section } from '../types'

const storageKey = (songId: string) => `chordarium:sections:${songId}`

function read(songId: string): Section[] | null {
  try {
    const raw = localStorage.getItem(storageKey(songId))
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function write(songId: string, sections: Section[] | null): void {
  try {
    if (sections) localStorage.setItem(storageKey(songId), JSON.stringify(sections))
    else localStorage.removeItem(storageKey(songId))
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

/** Detected sections plus the user's renames and boundary moves, kept in this browser per song. */
export function useSectionEdits(
  songId: string,
  detected: Section[],
): [Section[], (index: number, patch: { label?: string; start?: number }) => void, () => void] {
  const [saved, setSaved] = useState<Section[] | null>(() => {
    const stored = read(songId)
    return stored && stored.length === detected.length ? stored : null
  })
  const sections = saved ?? detected

  const edit = useCallback((index: number, patch: { label?: string; start?: number }) => {
    setSaved((prev) => {
      const next = editSection(prev ?? detected, index, patch)
      write(songId, next)
      return next
    })
  }, [songId, detected])

  const reset = useCallback(() => {
    setSaved(null)
    write(songId, null)
  }, [songId])

  return [sections, edit, reset]
}
