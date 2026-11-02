import type { Section } from './types'

export type SectionKind = 'intro' | 'verse' | 'chorus' | 'bridge' | 'interlude' | 'outro' | 'other'

/** The kind is read from the label, so a renamed section recolours itself. */
export function sectionKind(label: string): SectionKind {
  const l = label.trim().toLowerCase()
  if (l.startsWith('intro')) return 'intro'
  if (l.startsWith('verse')) return 'verse'
  if (l.startsWith('chorus') || l.startsWith('refrain')) return 'chorus'
  if (l.startsWith('bridge')) return 'bridge'
  if (l.startsWith('interlude') || l.startsWith('instrumental') || l.startsWith('solo')) return 'interlude'
  if (l.startsWith('outro') || l.startsWith('ending')) return 'outro'
  return 'other'
}

const KIND_COLORS: Record<SectionKind, string> = {
  intro: '#f2c14e',
  verse: '#6aa8e0',
  chorus: '#f2913d',
  bridge: '#b48be0',
  interlude: '#ee8577',
  outro: '#6fbf8b',
  other: '#b9ad9c',
}

export function sectionColor(label: string): string {
  return KIND_COLORS[sectionKind(label)]
}

export function sectionAt(sections: Section[], time: number): Section | null {
  return sections.find((s) => s.start <= time && time < s.end) ?? null
}

/** Rename a section and/or move where it starts. The previous section absorbs the gap, and the
 * first section always keeps its start. Moves are clamped so no section collapses. */
export function editSection(sections: Section[], index: number, patch: { label?: string; start?: number }): Section[] {
  const next = sections.map((s) => ({ ...s }))
  const target = next[index]
  if (!target) return sections
  if (patch.label !== undefined) {
    target.label = patch.label.trim() || target.label
    target.uncertain = false
  }
  if (patch.start !== undefined && index > 0) {
    const lo = next[index - 1].start + 0.001
    const hi = target.end - 0.001
    const start = Math.min(Math.max(patch.start, lo), hi)
    target.start = start
    next[index - 1].end = start
  }
  return next
}

/** Start a new section at `time`, inside the section that contains it. */
export function splitSection(sections: Section[], time: number, label: string): Section[] {
  const i = sections.findIndex((s) => s.start < time - 0.001 && time < s.end - 0.001)
  if (i < 0) return sections
  const head = { ...sections[i], end: time }
  const tail: Section = { start: time, end: sections[i].end, label: label.trim() || 'Section', uncertain: false }
  return [...sections.slice(0, i), head, tail, ...sections.slice(i + 1)].map((s) => ({ ...s }))
}

/** Remove a section: the one before it takes over its time (the first section hands it to the next). */
export function removeSection(sections: Section[], index: number): Section[] {
  if (sections.length < 2 || !sections[index]) return sections
  const next = sections.map((s) => ({ ...s }))
  if (index === 0) next[1].start = next[0].start
  else next[index - 1].end = next[index].end
  next.splice(index, 1)
  return next
}
