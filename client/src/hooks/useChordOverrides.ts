import { useCallback, useMemo, useState } from 'react'
import { addPatch, applyPatches, normalizeChord, type Patch } from '../chordEdits'
import type { Segment } from '../types'

const patchKey = (songId: string) => `chordarium:patches:${songId}`
// edits made before bars could be split were saved per segment index; they are read once and converted
const legacyKey = (songId: string) => `chordarium:edits:${songId}`

function readPatches(songId: string, canonical: Segment[]): Patch[] {
  try {
    const raw = localStorage.getItem(patchKey(songId))
    if (raw) {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    }
    const old = localStorage.getItem(legacyKey(songId))
    const overrides: Record<number, { label: string; bass: string | null }> = old ? JSON.parse(old) : {}
    return Object.entries(overrides)
      .filter(([i]) => canonical[Number(i)])
      .map(([i, o]) => ({ start: canonical[Number(i)].start, end: canonical[Number(i)].end, label: o.label, bass: o.bass }))
  } catch {
    return []
  }
}

function writePatches(songId: string, patches: Patch[]): void {
  try {
    localStorage.setItem(patchKey(songId), JSON.stringify(patches))
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

function clearPatches(songId: string): void {
  try {
    localStorage.removeItem(patchKey(songId))
    localStorage.removeItem(legacyKey(songId))
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

export interface ChordEdits {
  segments: Segment[]
  /** change the chord at one segment, or at every segment with the same chord */
  editChord(index: number, label: string, applyToAll: boolean): void
  /** set the chords for pieces of the song (a whole bar, or the halves of a bar) in one step */
  editRanges(pieces: { start: number; end: number; label: string }[]): void
  reset(): void
}

/** The detected chords plus the user's edits, kept in this browser per song. */
export function useChordOverrides(songId: string, canonicalSegments: Segment[]): ChordEdits {
  const [patches, setPatches] = useState<Patch[]>(() => readPatches(songId, canonicalSegments))

  const segments = useMemo(() => applyPatches(canonicalSegments, patches), [canonicalSegments, patches])

  const commit = useCallback((next: Patch[]) => {
    setPatches(next)
    writePatches(songId, next)
  }, [songId])

  const editChord = useCallback((index: number, label: string, applyToAll: boolean) => {
    const chord = normalizeChord(label)
    const target = segments[index].label
    const hit = segments.filter((seg, i) => i === index || (applyToAll && seg.label === target))
    commit(hit.reduce((acc, seg) => addPatch(acc, { start: seg.start, end: seg.end, ...chord }), patches))
  }, [segments, patches, commit])

  const editRanges = useCallback((pieces: { start: number; end: number; label: string }[]) => {
    commit(pieces.reduce((acc, p) => addPatch(acc, { start: p.start, end: p.end, ...normalizeChord(p.label) }), patches))
  }, [patches, commit])

  const reset = useCallback(() => {
    setPatches([])
    clearPatches(songId)
  }, [songId])

  return { segments, editChord, editRanges, reset }
}
