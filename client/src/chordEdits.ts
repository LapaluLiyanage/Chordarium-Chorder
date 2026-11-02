import { parse, SHARPS, toHarte } from './theory/chord'
import type { Segment } from './types'

/** One user edit: from `start` to `end` the chord is `label` (a Harte label, or "N" for no chord). */
export interface Patch {
  start: number
  end: number
  label: string
  bass: string | null
}

const EPS = 1e-3

/** Turn any chord text into the Harte label and bass note stored with an edit. Throws on an invalid chord. */
export function normalizeChord(label: string): { label: string; bass: string | null } {
  if (label === 'N') return { label: 'N', bass: null }
  const chord = parse(label)
  return { label: toHarte(chord), bass: chord === null ? null : SHARPS[chord.bass ?? chord.root] }
}

/** Replace the chords between `start` and `end`: segments are cut at the edges and the patch fills the gap. */
export function applyPatch(segments: Segment[], patch: Patch): Segment[] {
  if (patch.end - patch.start < EPS) return segments
  const out: Segment[] = []
  for (const seg of segments) {
    if (seg.end <= patch.start + EPS || seg.start >= patch.end - EPS) {
      out.push(seg)
      continue
    }
    if (seg.start < patch.start - EPS) out.push({ ...seg, end: patch.start })
    if (seg.end > patch.end + EPS) out.push({ ...seg, start: patch.end })
  }
  out.push({ start: patch.start, end: patch.end, label: patch.label, alt: null, confidence: 1, bass: patch.bass, edited: true })
  return out.sort((a, b) => a.start - b.start)
}

/** The detected chords with every edit laid over them, in the order the edits were made. */
export function applyPatches(canonical: Segment[], patches: Patch[]): Segment[] {
  return patches.reduce(applyPatch, canonical)
}

/** Add an edit, dropping earlier edits it completely covers so the list stays short. */
export function addPatch(patches: Patch[], patch: Patch): Patch[] {
  return [...patches.filter((p) => !(p.start >= patch.start - EPS && p.end <= patch.end + EPS)), patch]
}
