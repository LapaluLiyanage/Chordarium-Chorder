import { sectionColor } from './sections'
import { activeIndex, isLowConfidence } from './sync'
import { render, type RenderOpts } from './theory/chord'
import type { Section, Segment, Timeline } from './types'

export interface SheetBar {
  /** position in the song, 0-based */
  index: number
  start: number
  end: number
  /** rendered chord symbols played in this bar, in order ("N.C." for no chord) */
  chords: string[]
  /** how many beats each chord lasts, same order as `chords` */
  lengths: number[]
  guess: boolean
}

export interface SheetSection {
  /** position in the (sorted) section list, -1 for the single block of a song without sections */
  index: number
  name: string
  color: string
  start: number
  end: number
  bars: SheetBar[]
}

type Grid = Pick<Timeline, 'downbeats' | 'beats' | 'duration' | 'time_signature'>

const SONG_COLOR = '#b9ad9c'

function barBounds(timeline: Grid): number[] {
  const step = timeline.time_signature || 4
  const downbeats = timeline.downbeats.length ? timeline.downbeats : timeline.beats.filter((_, i) => i % step === 0)
  return [...downbeats, timeline.duration]
}

/** Which bar (0-based) a time falls in, or -1 before the first downbeat. */
export function barAt(downbeats: number[], t: number): number {
  let lo = 0
  let hi = downbeats.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (downbeats[mid] <= t) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

export function buildBars(timeline: Grid, segments: Segment[], opts: RenderOpts): SheetBar[] {
  const bounds = barBounds(timeline)
  const bars: SheetBar[] = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const [start, end] = [bounds[i], bounds[i + 1]]
    const beats = timeline.beats.filter((b) => b >= start - 1e-6 && b < end - 1e-6)
    const chords: string[] = []
    const lengths: number[] = []
    let guess = false
    for (const beat of beats.length ? beats : [start]) {
      const idx = activeIndex(segments, beat + 0.01)
      const seg = idx >= 0 ? segments[idx] : null
      const symbol = seg && seg.label !== 'N' ? render(seg.label, opts) : 'N.C.'
      if (chords[chords.length - 1] !== symbol) {
        chords.push(symbol)
        lengths.push(1)
      } else lengths[lengths.length - 1] += 1
      if (seg && seg.label !== 'N' && isLowConfidence(seg.confidence)) guess = true
    }
    bars.push({ index: i, start, end, chords, lengths, guess })
  }
  const silent = (b: SheetBar) => b.chords.every((c) => c === 'N.C.')
  while (bars.length && silent(bars[0])) bars.shift()
  while (bars.length && silent(bars[bars.length - 1])) bars.pop()
  return bars
}

/** The whole song as sections of bars. Without detected sections it is one block. */
export function buildSheet(timeline: Grid, segments: Segment[], sections: Section[], opts: RenderOpts): SheetSection[] {
  const bars = buildBars(timeline, segments, opts)
  if (!bars.length) return []
  if (!sections.length) {
    return [{ index: -1, name: 'Song', color: SONG_COLOR, start: bars[0].start, end: bars[bars.length - 1].end, bars }]
  }
  const sorted = [...sections].sort((a, b) => a.start - b.start)
  const out: SheetSection[] = sorted.map((s, index) => ({ index, name: s.label, color: sectionColor(s.label), start: s.start, end: s.end, bars: [] }))
  for (const bar of bars) {
    const owner = out.find((s) => bar.start >= s.start - 1e-6 && bar.start < s.end - 1e-6) ?? out[out.length - 1]
    owner.bars.push(bar)
  }
  return out.filter((s) => s.bars.length > 0)
}

/** The time that splits a bar in half, on a beat (null when the bar has fewer than two beats). */
export function barMidpoint(bar: { start: number; end: number }, beats: number[]): number | null {
  const inside = beats.filter((b) => b >= bar.start - 1e-6 && b < bar.end - 1e-6)
  return inside.length >= 2 ? inside[Math.floor(inside.length / 2)] : null
}

export function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size))
  return rows
}
