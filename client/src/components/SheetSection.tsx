import { memo, type ReactNode } from 'react'
import { chunk, type SheetBar, type SheetSection as SheetSectionData } from '../sheet'
import type { LoopRange } from './PlayPanel'
import { ChordSymbol } from './ChordSymbol'

const ROW_OPTIONS = [2, 4, 8] as const

interface Props {
  id?: string
  title: string
  meta: string
  sections: SheetSectionData[]
  perRow: number
  onPerRow(n: number): void
  transpose: number
  onTranspose(delta: number): void
  simplify: boolean
  onSimplify(): void
  playing: boolean
  onTogglePlay(): void
  /** index of the bar being played, -1 for none */
  currentBar: number
  onSeekBar(bar: SheetBar): void
  loop: LoopRange | null
  onLoop(section: SheetSectionData): void
  /** download buttons; omit on demos */
  footer?: ReactNode
  label?: string
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

/** The whole song as a bar grid grouped by section, synced to playback. */
export const SheetSection = memo(function SheetSection(p: Props) {
  return (
    <section id={p.id} className="sheet" data-reveal="1" aria-label="Chord sheet">
      <div className="sheet-top"><span>003</span><span>CHORD SHEET</span><span>{p.label ?? 'SYNCED'}</span></div>
      <div className="sheet-head">
        <div>
          <h2 className="mega sheet-title">{p.title}</h2>
          <div className="sheet-meta">{p.meta}</div>
        </div>
        <div className="sheet-controls">
          <button type="button" className="pill-btn amber" data-mag="1" onClick={p.onTogglePlay}>{p.playing ? 'PAUSE' : 'PLAY'}</button>
          <div className="stepper">
            <button type="button" aria-label="Sheet transpose down" onClick={() => p.onTranspose(-1)}>−</button>
            <span>TRANSPOSE {signed(p.transpose)}</span>
            <button type="button" aria-label="Sheet transpose up" onClick={() => p.onTranspose(1)}>+</button>
          </div>
          <div className="segmented dark" role="group" aria-label="Bars per row">
            {ROW_OPTIONS.map((n) => (
              <button key={n} type="button" aria-pressed={p.perRow === n} onClick={() => p.onPerRow(n)}>{n} / ROW</button>
            ))}
          </div>
          <button type="button" className="pill-btn" aria-pressed={p.simplify} onClick={p.onSimplify}>SIMPLIFY</button>
        </div>
      </div>
      <div className="sheet-body">
        {p.sections.map((sec, si) => {
          const looping = p.loop !== null && Math.abs(p.loop.start - sec.start) < 0.01 && Math.abs(p.loop.end - sec.end) < 0.01
          const first = sec.bars[0].index + 1
          const last = sec.bars[sec.bars.length - 1].index + 1
          return (
            <div key={`${sec.name}-${si}`} className="sheet-section">
              <div className="sheet-section-head">
                <button type="button" className="section-chip" aria-pressed={looping} style={{ background: sec.color }} onClick={() => p.onLoop(sec)}>
                  {sec.name.toUpperCase()} · {looping ? 'LOOPING' : 'LOOP'}
                </button>
                <span className="rule" />
                <span className="bars-range">BARS {first}–{last}</span>
              </div>
              {chunk(sec.bars, p.perRow).map((row, ri) => (
                <div key={ri} className="sheet-row" style={{ gridTemplateColumns: `repeat(${p.perRow}, minmax(0, 1fr))` }}>
                  {row.map((bar) => (
                    <button key={bar.index} type="button" aria-label={`Bar ${bar.index + 1}: ${bar.chords.join(' ')}${bar.guess ? ' (guess)' : ''}`}
                      className={['bar-cell', p.currentBar === bar.index ? 'now' : '', bar.guess ? 'guess' : ''].join(' ').trim()}
                      onClick={() => p.onSeekBar(bar)}>
                      {bar.chords.map((c, i) => <ChordSymbol key={i} symbol={c} />)}
                      {bar.guess && <span className="guess-mark" aria-hidden="true">?</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )
        })}
      </div>
      <div className="sheet-foot">
        <span>Dashed with a <b>?</b> means it’s a guess — listen, then tap to fix. Tap a section tag to loop it.</span>
        {p.footer}
      </div>
    </section>
  )
})
