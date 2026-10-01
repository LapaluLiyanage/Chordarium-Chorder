import { useEffect, useRef, useState } from 'react'
import { PX_PER_SECOND, isLowConfidence, laneOffset } from '../sync'
import { sectionKind } from '../sections'
import type { Section, Segment } from '../types'
import { ChordSymbol } from './ChordSymbol'

interface Props {
  segments: Segment[]
  sections?: Section[]
  symbols: string[]
  beats: number[]
  downbeats: number[]
  duration: number
  time: number
  editMode: boolean
  onSeek(t: number): void
  onEdit(index: number): void
  onEditSection?(index: number): void
  width?: number
}

export function ChordLane({ segments, sections = [], symbols, beats, downbeats, duration, time, editMode, onSeek, onEdit, onEditSection, width }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [measured, setMeasured] = useState(800)

  useEffect(() => {
    if (width !== undefined) return
    const el = ref.current
    if (!el) return
    const update = () => setMeasured(el.clientWidth || 800)
    update()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    observer?.observe(el)
    return () => observer?.disconnect()
  }, [width])

  const offset = laneOffset(time, width ?? measured)
  return (
    <div className="lane" ref={ref} aria-label="Chord timeline">
      <div className="lane-playhead" />
      <div className="lane-track" data-testid="lane-track"
        style={{ transform: `translateX(${offset}px)`, width: duration * PX_PER_SECOND }}>
        {beats.map((b) => <span key={`b${b}`} className="beat-tick" style={{ left: b * PX_PER_SECOND }} />)}
        {downbeats.map((d) => <span key={`d${d}`} className="bar-line" style={{ left: d * PX_PER_SECOND }} />)}
        {sections.map((sec, i) => (
          <button key={`s${i}`} type="button" data-kind={sectionKind(sec.label)}
            className={sec.uncertain ? 'section-tag guess' : 'section-tag'}
            style={{ left: sec.start * PX_PER_SECOND, width: Math.max((sec.end - sec.start) * PX_PER_SECOND - 2, 24) }}
            title={editMode ? 'Rename or move this section' : sec.uncertain ? `${sec.label} (automatic guess) — jump here` : `${sec.label} — jump here`}
            onClick={() => (editMode && onEditSection ? onEditSection(i) : onSeek(sec.start))}>
            {sec.label}{sec.uncertain ? '?' : ''}
          </button>
        ))}
        {segments.map((s, i) => {
          if (s.label === 'N') {
            if (!editMode) return null
            return (
              <button key={i} type="button" className="chip empty"
                style={{ left: s.start * PX_PER_SECOND, width: Math.max((s.end - s.start) * PX_PER_SECOND - 4, 28) }}
                title="Add a chord here" aria-label="Add a chord here" onClick={() => onEdit(i)}>
                +
              </button>
            )
          }
          const classes = ['chip']
          if (s.end <= time) classes.push('past')
          if (s.start <= time && time < s.end) classes.push('active')
          if (isLowConfidence(s.confidence)) classes.push('low')
          if (s.edited) classes.push('edited')
          return (
            <button key={i} type="button" className={classes.join(' ')}
              style={{ left: s.start * PX_PER_SECOND, width: Math.max((s.end - s.start) * PX_PER_SECOND - 4, 28) }}
              title={editMode ? 'Edit this chord' : 'Jump here'}
              onClick={() => (editMode ? onEdit(i) : onSeek(s.start))}>
              <ChordSymbol symbol={symbols[i]} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
