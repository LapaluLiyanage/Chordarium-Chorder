import { describe, expect, it } from 'vitest'
import { addPatch, applyPatch, applyPatches, normalizeChord } from './chordEdits'
import type { Segment } from './types'

const seg = (start: number, end: number, label: string): Segment =>
  ({ start, end, label, alt: 'C:maj', confidence: 0.4, bass: 'C', edited: false })
const base = [seg(0, 4, 'C:maj'), seg(4, 8, 'A:min'), seg(8, 12, 'F:maj')]
const patch = (start: number, end: number, label: string) => ({ start, end, label, bass: null })

describe('applyPatch', () => {
  it('replaces whole segments one for one', () => {
    const out = applyPatch(base, patch(4, 8, 'G:maj'))
    expect(out.map((s) => [s.start, s.end, s.label])).toEqual([[0, 4, 'C:maj'], [4, 8, 'G:maj'], [8, 12, 'F:maj']])
    expect(out[1]).toMatchObject({ edited: true, confidence: 1, alt: null })
  })

  it('cuts the segments at both edges of the patch', () => {
    const out = applyPatch(base, patch(2, 10, 'D:min'))
    expect(out.map((s) => [s.start, s.end, s.label])).toEqual([[0, 2, 'C:maj'], [2, 10, 'D:min'], [10, 12, 'F:maj']])
  })

  it('ignores an empty range', () => {
    expect(applyPatch(base, patch(5, 5, 'G:maj'))).toBe(base)
  })
})

describe('applyPatches and addPatch', () => {
  it('lays later edits over earlier ones', () => {
    const out = applyPatches(base, [patch(0, 4, 'G:maj'), patch(0, 2, 'D:maj')])
    expect(out.map((s) => [s.start, s.end, s.label])).toEqual([[0, 2, 'D:maj'], [2, 4, 'G:maj'], [4, 8, 'A:min'], [8, 12, 'F:maj']])
  })

  it('drops earlier edits that a new one covers', () => {
    const list = addPatch(addPatch([], patch(0, 2, 'G:maj')), patch(0, 4, 'D:maj'))
    expect(list).toEqual([patch(0, 4, 'D:maj')])
  })
})

describe('normalizeChord', () => {
  it('writes Harte labels with the bass note', () => {
    expect(normalizeChord('C:maj/E')).toMatchObject({ bass: 'E' })
    expect(normalizeChord('N')).toEqual({ label: 'N', bass: null })
  })
  it('throws for nonsense', () => {
    expect(() => normalizeChord('H:maj')).toThrow()
  })
})
