import { describe, expect, it } from 'vitest'
import { barAt, buildBars, buildSheet, chunk } from './sheet'
import { SECTIONS, TIMELINE } from './test/fixtures'
import { keySpelling } from './theory/chord'

const tonic = keySpelling('G:min')
const t = TIMELINE // 4 bars of 2 s; Bbmaj7 and Ebmaj7 share bar 3

describe('buildBars', () => {
  it('lists the chords played in each bar, in order, without repeats', () => {
    const bars = buildBars(t, t.segments, { tonic })
    expect(bars.map((b) => b.chords)).toEqual([['Cm7'], ['F7'], ['Bbmaj7', 'Ebmaj7'], ['D7/F#']])
  })

  it('records how many beats each chord lasts', () => {
    const bars = buildBars(t, t.segments, { tonic })
    expect(bars.map((b) => b.lengths)).toEqual([[4], [4], [2, 2], [4]])
  })

  it('flags bars that contain a low-confidence chord as guesses', () => {
    const bars = buildBars(t, t.segments, { tonic })
    expect(bars.map((b) => b.guess)).toEqual([false, false, true, true])
  })

  it('applies transpose, capo and simplify', () => {
    const bars = buildBars(t, t.segments, { transpose: 2, capo: 2, simplify: true, tonic: keySpelling('G:min', 0) })
    expect(bars.map((b) => b.chords[0])).toEqual(['Cm', 'F', 'Bb', 'D'])
  })

  it('drops silent bars at the start but keeps song positions', () => {
    const segments = [{ ...t.segments[0], label: 'N' }, ...t.segments.slice(1)]
    const bars = buildBars(t, segments, { tonic })
    expect(bars[0].index).toBe(1)
  })
})

describe('buildSheet', () => {
  it('groups bars under their sections with colours', () => {
    const sheet = buildSheet(t, t.segments, SECTIONS, { tonic })
    expect(sheet.map((s) => [s.name, s.bars.length])).toEqual([['Intro', 2], ['Chorus', 2]])
    expect(sheet[1].color).toBe('#f2913d')
  })

  it('falls back to one block without sections', () => {
    const sheet = buildSheet(t, t.segments, [], { tonic })
    expect(sheet).toHaveLength(1)
    expect(sheet[0].bars).toHaveLength(4)
  })
})

describe('barAt and chunk', () => {
  it('finds the bar containing a time', () => {
    expect(barAt([0, 2, 4, 6], 0)).toBe(0)
    expect(barAt([0, 2, 4, 6], 3.9)).toBe(1)
    expect(barAt([1, 2], 0.5)).toBe(-1)
  })
  it('chunks rows', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})
