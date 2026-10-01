import type { Section, Segment, Timeline } from './types'

/** A built-in sample (Autumn Leaves changes) that drives the live demos on the home page. */
const A = ['C:min7', 'F:7', 'A#:maj7', 'D#:maj7', 'A:hdim7', 'D:7', 'G:min', 'G:min']
const B = ['A:hdim7', 'D:7', 'G:min', 'G:min', 'C:min7', 'F:7', 'A#:maj7', 'D#:maj7']
const C = ['A:hdim7', 'D:7', 'G:min7', 'C:7', 'C:min7', 'D:7/3', 'G:min', 'G:min']
const BARS = [...A, ...A, ...B, ...C]
const GUESS_BARS = new Set([13, 22, 29])
const BAR_SECONDS = 2
const SECTION_NAMES = ['Verse 1', 'Verse 2', 'Bridge', 'Outro']

const segments: Segment[] = BARS.map((label, i) => ({
  start: i * BAR_SECONDS,
  end: (i + 1) * BAR_SECONDS,
  label,
  alt: null,
  confidence: GUESS_BARS.has(i) ? 0.5 : 0.9,
  bass: null,
  edited: false,
}))

const sections: Section[] = SECTION_NAMES.map((label, i) => ({
  start: i * 8 * BAR_SECONDS,
  end: (i + 1) * 8 * BAR_SECONDS,
  label,
  uncertain: false,
}))

export const DEMO_TIMELINE: Timeline = {
  video_id: 'demo',
  title: 'Autumn Leaves',
  duration: BARS.length * BAR_SECONDS,
  key: 'G:min',
  tempo: 120,
  time_signature: 4,
  beats: Array.from({ length: BARS.length * 4 }, (_, i) => i * (BAR_SECONDS / 4)),
  downbeats: Array.from({ length: BARS.length }, (_, i) => i * BAR_SECONDS),
  segments,
  sections,
  engine: { chords: 'demo', separated: true, version: 'demo' },
  warnings: [],
}
