import { describe, expect, it } from 'vitest'
import { editSection, sectionAt, sectionKind } from './sections'
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
