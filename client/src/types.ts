export interface Segment {
  start: number
  end: number
  label: string
  alt: string | null
  confidence: number
  bass: string | null
  edited: boolean
}

export interface Section {
  start: number
  end: number
  label: string
  /** true when the label is a weaker guess (no vocal stem was available) */
  uncertain: boolean
}

export interface Timeline {
  video_id: string
  title: string
  duration: number
  key: string
  tempo: number
  time_signature: number
  beats: number[]
  downbeats: number[]
  segments: Segment[]
  /** absent on songs analysed before section detection existed */
  sections?: Section[]
  engine: { chords: string; separated: boolean; version: string }
  warnings: string[]
}

export interface SongSummary {
  id: string
  video_id: string
  title: string
  duration: number
  key: string
  tempo: number
  created_at: string
  updated_at: string
}

export interface Song extends SongSummary {
  timeline: Timeline
}

export type JobState =
  | 'queued' | 'downloading' | 'separating' | 'beats' | 'chords' | 'bass' | 'key'
  | 'done' | 'failed' | 'cancelled'

export interface Job {
  id: string
  video_id: string
  mode: 'fast' | 'accurate'
  state: JobState
  progress: number
  message: string | null
  error: string | null
  song_id: string | null
  created_at: string
}

export type ExportFormat = 'pdf' | 'chordpro' | 'txt' | 'midi' | 'json'

export interface ExportRequest {
  fmt: ExportFormat
  transpose: number
  capo: number
  simplify: boolean
  barsPerRow: 4 | 8
}
