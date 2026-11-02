import { describe, expect, it } from 'vitest'
import { editSection, removeSection, sectionAt, sectionKind, splitSection } from './sections'
import type { Section } from './types'

const sections: Section[] = [
  { start: 0, end: 8, label: 'Intro', uncertain: false },
  { start: 8, end: 24, label: 'Verse 1', uncertain: true },
  { start: 24, end: 40, label: 'Chorus', uncertain: true },
]

describe('sectionKind', () => {
  it('reads the kind from the label, numbered or not', () => {
    expect(sectionKind('Verse 2')).toBe('verse')
    expect(sectionKind('chorus')).toBe('chorus')
    expect(sectionKind('Instrumental break')).toBe('interlude')
    expect(sectionKind('Pre-chorus')).toBe('other')
  })
})

describe('sectionAt', () => {
  it('finds the section containing a time', () => {
    expect(sectionAt(sections, 9)?.label).toBe('Verse 1')
    expect(sectionAt(sections, 24)?.label).toBe('Chorus')
    expect(sectionAt(sections, 99)).toBeNull()
  })
})

describe('editSection', () => {
  it('renames a section and clears its uncertain flag', () => {
    const next = editSection(sections, 1, { label: ' Pre-chorus ' })
    expect(next[1]).toMatchObject({ label: 'Pre-chorus', uncertain: false })
    expect(sections[1].label).toBe('Verse 1')
  })

  it('ignores an empty name', () => {
    expect(editSection(sections, 1, { label: '  ' })[1].label).toBe('Verse 1')
  })

  it('moves a boundary and stretches the previous section to match', () => {
    const next = editSection(sections, 2, { start: 20 })
    expect(next[2].start).toBe(20)
    expect(next[1].end).toBe(20)
  })

  it('clamps moves so no section collapses and the first start is fixed', () => {
    expect(editSection(sections, 2, { start: 8 })[2].start).toBeGreaterThan(8)
    expect(editSection(sections, 2, { start: 99 })[2].start).toBeLessThan(40)
    expect(editSection(sections, 0, { start: 3 })[0].start).toBe(0)
  })
})

describe('splitSection', () => {
  it('starts a new section inside the one holding the time', () => {
    const next = splitSection(sections, 16, 'Pre-chorus')
    expect(next.map((s) => [s.start, s.end, s.label])).toEqual([
      [0, 8, 'Intro'], [8, 16, 'Verse 1'], [16, 24, 'Pre-chorus'], [24, 40, 'Chorus'],
    ])
    expect(next[2].uncertain).toBe(false)
  })

  it('does nothing on an existing boundary', () => {
    expect(splitSection(sections, 24, 'X')).toBe(sections)
  })
})

describe('removeSection', () => {
  it('lets the previous section take over the time', () => {
    const next = removeSection(sections, 1)
    expect(next.map((s) => [s.start, s.end, s.label])).toEqual([[0, 24, 'Intro'], [24, 40, 'Chorus']])
  })

  it('lets the next section take over when the first is removed', () => {
    const next = removeSection(sections, 0)
    expect(next.map((s) => [s.start, s.end, s.label])).toEqual([[0, 24, 'Verse 1'], [24, 40, 'Chorus']])
  })

  it('keeps the last remaining section', () => {
    expect(removeSection([sections[0]], 0)).toEqual([sections[0]])
  })
})
