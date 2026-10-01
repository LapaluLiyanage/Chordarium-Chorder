import { useState } from 'react'
import { useModalA11y } from '../hooks/useModalA11y'
import type { Section } from '../types'

interface Props {
  section: Section
  index: number
  downbeats: number[]
  onApply(patch: { label: string; start?: number }): void
  onClose(): void
}

const SUGGESTED = ['Intro', 'Verse', 'Pre-chorus', 'Chorus', 'Bridge', 'Interlude', 'Solo', 'Outro']
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

export function SectionEditor({ section, index, downbeats, onApply, onClose }: Props) {
  const modalRef = useModalA11y<HTMLDivElement>(onClose)
  const [label, setLabel] = useState(section.label)
  // the first section always starts at the beginning of the song
  const bars = index === 0 ? [] : downbeats.map((t, bar) => ({ t, bar: bar + 1 })).filter((b) => b.t > 0)
  const nearest = bars.reduce<number | null>(
    (best, b) => (best === null || Math.abs(b.t - section.start) < Math.abs(best - section.start) ? b.t : best), null)
  const [start, setStart] = useState<number | null>(nearest)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-label="Edit section" onClick={(e) => e.stopPropagation()}>
        <h2>Edit section</h2>
        <label>
          Name{' '}
          <input type="text" aria-label="Section name" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <div className="suggestions" role="group" aria-label="Common names">
          {SUGGESTED.map((n) => (
            <button key={n} type="button" className="button" onClick={() => setLabel(n)}>{n}</button>
          ))}
        </div>
        {bars.length > 0 && (
          <label>
            Starts at{' '}
            <select aria-label="Section start" value={start ?? ''} onChange={(e) => setStart(Number(e.target.value))}>
              {bars.map((b) => <option key={b.bar} value={b.t}>Bar {b.bar} · {clock(b.t)}</option>)}
            </select>
          </label>
        )}
        <div className="control">
          <button type="button" className="button primary"
            onClick={() => onApply({ label, ...(start !== null && index > 0 ? { start } : {}) })}>Apply</button>
          <button type="button" className="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
