import type { ReactNode } from 'react'
import { sectionAt, sectionColor } from '../sections'
import { activeIndex, beatsUntil, isLowConfidence, upcomingIndex } from '../sync'
import type { Section, Segment } from '../types'
import { ChordSymbol } from './ChordSymbol'

export interface LoopRange {
  start: number
  end: number
}

interface Props {
  title: string
  meta: string
  badge: string
  segments: Segment[]
  symbols: string[]
  sections: Section[]
  beats: number[]
  duration: number
  time: number
  loop?: LoopRange | null
  countdown?: number | null
  onSeek(t: number): void
  /** the scrolling chord lane, or a compact chip list */
  children?: ReactNode
  /** the transport row under the lane */
  footer?: ReactNode
}

/** The "tool" card: current chord, next chord, beat dots, a coloured structure bar, a lane and a transport. */
export function PlayPanel({ title, meta, badge, segments, symbols, sections, beats, duration, time, loop, countdown, onSeek, children, footer }: Props) {
  const idx = activeIndex(segments, time)
  const next = upcomingIndex(segments, time)
  const toNext = next >= 0 ? Math.min(beatsUntil(beats, time, segments[next].start), 4) : 0
  const section = sectionAt(sections, time)
  return (
    <section className="play-panel" aria-label="Play along">
      <div className="play-meta">
        <span>{title}</span>
        <span>{meta}</span>
        <span>{badge}</span>
      </div>
      <div className="play-hero">
        <div className="big-chord" data-testid="current-chord">
          {countdown ? <span className="countdown" aria-live="assertive">{countdown}</span>
            : idx >= 0 ? <ChordSymbol symbol={symbols[idx]} lowConfidence={isLowConfidence(segments[idx].confidence)} /> : '—'}
        </div>
        <div className="play-next">
          <span className="eyebrow-dark">NEXT</span>
          <span className="next-chord" data-testid="next-chord">{next >= 0 ? symbols[next] : '—'}</span>
          <span className="beat-dots" aria-label={`${toNext} beats to next chord`}>
            {Array.from({ length: 4 }, (_, i) => <span key={i} className={i < toNext ? 'dot on' : 'dot'} />)}
          </span>
        </div>
      </div>
      {sections.length > 0 && (
        <div className="structure" role="group" aria-label="Song structure">
          {sections.map((s, i) => {
            const active = section === s
            const looping = loop && Math.abs(loop.start - s.start) < 0.01 && Math.abs(loop.end - s.end) < 0.01
            return (
              <button key={`${s.label}-${i}`} type="button" aria-label={`Jump to ${s.label}`} aria-current={active || undefined}
                className={['structure-block', active ? 'active' : '', looping ? 'looping' : '', s.uncertain ? 'guess' : ''].join(' ').trim()}
                style={{ flexGrow: Math.max(s.end - s.start, 1), ['--sec' as string]: sectionColor(s.label) }}
                onClick={() => onSeek(s.start)}>
                {s.label.toUpperCase()}{s.uncertain ? '?' : ''}
              </button>
            )
          })}
          <span className="structure-playhead" style={{ left: `${Math.min(100, (time / Math.max(duration, 1)) * 100)}%` }} />
        </div>
      )}
      {children}
      {footer}
    </section>
  )
}
