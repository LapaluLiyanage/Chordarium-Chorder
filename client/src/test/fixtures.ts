import type { Song, Timeline } from '../types'

export const TIMELINE: Timeline = {
  video_id: 'abcdefghijk',
  title: 'Test Song',
  duration: 8.0,
  key: 'G:min',
  tempo: 120.0,
  time_signature: 4,
  beats: Array.from({ length: 16 }, (_, i) => i * 0.5),
  downbeats: [0, 2, 4, 6],
  segments: [
    { start: 0, end: 2, label: 'C:min7', alt: 'C:min', confidence: 0.8, bass: 'C', edited: false },
    { start: 2, end: 4, label: 'F:7', alt: 'F:maj', confidence: 0.7, bass: 'F', edited: false },
    { start: 4, end: 5, label: 'A#:maj7', alt: null, confidence: 0.6, bass: 'A#', edited: false },
    { start: 5, end: 6, label: 'D#:maj7', alt: null, confidence: 0.6, bass: 'D#', edited: false },
    { start: 6, end: 8, label: 'D:7/3', alt: 'D:7', confidence: 0.4, bass: 'F#', edited: false },
  ],
  engine: { chords: 'btc-large', separated: true, version: '1' },
  warnings: [],
}

export function makeSong(patch: Partial<Timeline> = {}): Song {
  const timeline = structuredClone({ ...TIMELINE, ...patch })
  return {
    id: 's1', video_id: timeline.video_id, title: timeline.title, duration: timeline.duration,
    key: timeline.key, tempo: timeline.tempo, created_at: '2026-09-26T00:00:00Z',
    updated_at: '2026-09-26T00:00:00Z', timeline,
  }
}

export const SONG: Song = makeSong()

export const SECTIONS = [
  { start: 0, end: 4, label: 'Intro', uncertain: false },
  { start: 4, end: 8, label: 'Chorus', uncertain: true },
]
