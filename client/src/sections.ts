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
