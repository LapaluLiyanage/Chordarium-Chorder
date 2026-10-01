import { useEffect, useRef, useState } from 'react'
import { playChord } from '../audio'
import type { DemoClock } from '../hooks/useDemoClock'
import { barAt } from '../sheet'
import { sectionAt } from '../sections'
import { activeIndex } from '../sync'
import { keySpelling, parse, render, transpose, QUALITY_INTERVALS } from '../theory/chord'
import type { Timeline } from '../types'
import { ChordSymbol } from './ChordSymbol'
import { ChordWheel } from './ChordWheel'

export function IntroSection({ timeline, clock }: { timeline: Timeline; clock: DemoClock }) {
  const [sound, setSound] = useState(false)
  const idx = activeIndex(timeline.segments, clock.time)
  const seg = idx >= 0 ? timeline.segments[idx] : null
  const chord = seg ? parse(seg.label) : null
  const tonic = keySpelling(timeline.key)
  const symbol = seg ? render(seg.label, { tonic }) : '—'
  const bar = barAt(timeline.downbeats, clock.time) + 1
  const section = sectionAt(timeline.sections ?? [], clock.time)

  const last = useRef(-1)
  useEffect(() => {
    if (!sound || !clock.playing || idx < 0 || idx === last.current || !chord) return
    last.current = idx
    const tones = (QUALITY_INTERVALS[chord.quality] ?? [0, 4, 7]).map((i) => (chord.root + i) % 12)
    playChord(tones, chord.bass ?? chord.root)
  }, [sound, clock.playing, idx, chord])

  return (
    <section id="intro" className="intro">
      <div className="intro-copy" data-reveal="1">
        <div className="eyebrow-light">HOW IT WORKS</div>
        <h2 className="mega">EVERY SONG HAS A SHAPE.</h2>
        <p>
          Chordarium listens, finds each chord, and keeps it in time with the video. The wheel shows the chord playing
          right now — its notes lit up on the circle of fifths. Drag it around; tap a note to hear it.
        </p>
        <div className="intro-actions">
          <button type="button" className="pill-btn outline" data-mag="1" aria-pressed={sound} onClick={() => setSound((s) => !s)}>
            {sound ? '🔊 SOUND ON' : '🔈 HEAR THE CHORDS'}
          </button>
          <button type="button" className="pill-btn outline" onClick={clock.toggle}>{clock.playing ? 'PAUSE' : 'PLAY'}</button>
        </div>
        <div className="legend-dots">
          <span><i className="ld ink" />Root</span>
          <span><i className="ld amber" />Chord tones</span>
          <span><i className="ld blue" />Bass</span>
        </div>
      </div>
      <div className="intro-wheel">
        <ChordWheel chord={chord ? transpose(chord, 0) : null} sound={sound} />
        <div className="wheel-centre" aria-live="off">
          <div className="wheel-chord">{seg ? <ChordSymbol symbol={symbol} /> : '—'}</div>
          <div className="wheel-where">BAR {Math.max(bar, 1)} · {(section?.label ?? 'SONG').toUpperCase()}</div>
        </div>
      </div>
    </section>
  )
}
