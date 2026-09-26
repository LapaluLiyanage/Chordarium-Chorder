import { useState } from 'react'
import { useModalA11y } from '../hooks/useModalA11y'
import {
  QUALITIES, QUALITY_SYMBOL, formatSymbol, parse, rootNameInKey, simplify, toHarte, transpose,
} from '../theory/chord'
import type { Segment } from '../types'
import { ChordSymbol } from './ChordSymbol'

interface Props {
  segment: Segment
  shift: number
  tonic: string
  error?: string | null
  onApply(label: string, applyToAll: boolean): void
  onClose(): void
}

function parsesCleanly(label: string): boolean {
  try {
    parse(label)
    return true
  } catch {
    return false
  }
}

export function ChordEditor({ segment, shift, tonic, error, onApply, onClose }: Props) {
  const modalRef = useModalA11y<HTMLDivElement>(onClose)
  const shown = transpose(parse(segment.label), shift)
  const [root, setRoot] = useState(shown?.root ?? 0)
  const [quality, setQuality] = useState(shown?.quality ?? 'maj')
  const [bass, setBass] = useState<number | null>(shown?.bass ?? null)
  const [applyToAll, setApplyToAll] = useState(false)

  const display = (label: string) => formatSymbol(transpose(parse(label), shift), { tonic })
  const simpler = toHarte(simplify(parse(segment.label)))
  const suggestions = [segment.alt, simpler].filter(
    (l, i, all): l is string => !!l && l !== 'N' && l !== segment.label && all.indexOf(l) === i && parsesCleanly(l),
  )

  function applyManual() {
    const picked = { root, quality, bass: bass === null || bass === root ? null : bass }
    onApply(toHarte(transpose(picked, -shift)), applyToAll)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-label="Edit chord" onClick={(e) => e.stopPropagation()}>
        <h2><ChordSymbol symbol={display(segment.label)} /></h2>
        {error && <p role="alert" className="error">{error}</p>}
        {suggestions.length > 0 && (
          <div className="suggestions" role="group" aria-label="Suggestions">
            {suggestions.map((l) => (
              <button key={l} type="button" className="button" onClick={() => onApply(l, applyToAll)}>
                <ChordSymbol symbol={display(l)} />
              </button>
            ))}
          </div>
        )}
        <div className="root-grid" role="group" aria-label="Root">
          {Array.from({ length: 12 }, (_, pc) => (
            <button key={pc} type="button" className="button" aria-pressed={root === pc} onClick={() => setRoot(pc)}>
              {rootNameInKey(pc, tonic)}
            </button>
          ))}
        </div>
        <label>
          Chord type{' '}
          <select aria-label="Chord type" value={quality} onChange={(e) => setQuality(e.target.value)}>
            {QUALITIES.map((q) => <option key={q} value={q}>{QUALITY_SYMBOL[q] || 'major'}</option>)}
          </select>
        </label>
        <label>
          Bass{' '}
          <select aria-label="Bass" value={bass ?? ''} onChange={(e) => setBass(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">Root position</option>
            {Array.from({ length: 12 }, (_, pc) => <option key={pc} value={pc}>{rootNameInKey(pc, tonic)}</option>)}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} />
          {' '}Apply to every matching chord
        </label>
        <div className="control">
          <button type="button" className="button primary" onClick={applyManual}>Apply</button>
          <button type="button" className="button" onClick={() => onApply('N', applyToAll)}>No chord</button>
          <button type="button" className="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
