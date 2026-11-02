import { useState } from 'react'
import { useModalA11y } from '../hooks/useModalA11y'
import { barMidpoint, type SheetBar } from '../sheet'
import { activeIndex } from '../sync'
import { formatSymbol, parse, transpose } from '../theory/chord'
import type { Segment } from '../types'
import { ChordEditor } from './ChordEditor'
import { ChordSymbol } from './ChordSymbol'

interface Props {
  bar: SheetBar
  /** every beat time in the song */
  beats: number[]
  segments: Segment[]
  /** how far the sheet is transposed (transpose minus capo) */
  shift: number
  tonic: string
  onApply(pieces: { start: number; end: number; label: string }[]): void
  /** start a new section at the beginning of this bar; omit when sections can't be edited */
  onNewSection?(time: number): void
  onClose(): void
}

interface Slot {
  start: number
  end: number
  label: string
}

const labelAt = (segments: Segment[], t: number): string => segments[activeIndex(segments, t + 0.01)]?.label ?? 'N'

/** Change one bar of the chord sheet: a single chord, or two chords (one per half). */
export function BarEditor({ bar, beats, segments, shift, tonic, onApply, onNewSection, onClose }: Props) {
  const modalRef = useModalA11y<HTMLDivElement>(onClose)
  const mid = barMidpoint(bar, beats)
  const first = labelAt(segments, bar.start)
  const second = mid === null ? first : labelAt(segments, mid)
  const [split, setSplit] = useState(mid !== null && first !== second)
  const [labels, setLabels] = useState<[string, string]>([first, second])
  const [picking, setPicking] = useState<0 | 1 | null>(null)

  const slots: Slot[] = split && mid !== null
    ? [{ start: bar.start, end: mid, label: labels[0] }, { start: mid, end: bar.end, label: labels[1] }]
    : [{ start: bar.start, end: bar.end, label: labels[0] }]
  const show = (label: string) => (label === 'N' ? 'N.C.' : formatSymbol(transpose(parse(label), shift), { tonic }))

  if (picking !== null) {
    const source = segments[activeIndex(segments, slots[picking].start + 0.01)] ?? segments[0]
    return (
      <ChordEditor segment={{ ...source, label: labels[picking] }} shift={shift} tonic={tonic} single
        onApply={(label) => {
          setLabels((prev) => (picking === 0 ? [label, prev[1]] : [prev[0], label]))
          setPicking(null)
        }}
        onClose={() => setPicking(null)} />
    )
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-label={`Edit bar ${bar.index + 1}`} onClick={(e) => e.stopPropagation()}>
        <h2>Bar {bar.index + 1}</h2>
        <div className="bar-slots" role="group" aria-label="Chords in this bar">
          {slots.map((slot, i) => (
            <button key={i} type="button" className="button bar-slot" aria-label={`Change chord ${i + 1}`} onClick={() => setPicking(i as 0 | 1)}>
              <ChordSymbol symbol={show(slot.label)} />
            </button>
          ))}
        </div>
        <div className="control">
          {mid !== null && (
            <button type="button" className="button" onClick={() => setSplit((v) => !v)}>
              {split ? 'One chord for the whole bar' : 'Split bar in two'}
            </button>
          )}
          <button type="button" className="button" onClick={() => setLabels(['N', 'N'])}>No chord</button>
        </div>
        {onNewSection && bar.start > 0.01 && (
          <button type="button" className="button" onClick={() => onNewSection(bar.start)}>Start a new section at this bar</button>
        )}
        <div className="control">
          <button type="button" className="button primary" onClick={() => onApply(slots.map(({ start, end, label }) => ({ start, end, label })))}>Apply</button>
          <button type="button" className="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
