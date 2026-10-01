import { RATES, type ViewSettings } from '../hooks/useViewSettings'

export interface LoopRange {
  a: number | null
  b: number | null
}

interface Props {
  settings: ViewSettings
  onChange(patch: Partial<ViewSettings>): void
  loop: LoopRange
  onSetA(): void
  onSetB(): void
  onClearLoop(): void
  editMode: boolean
  onToggleEdit(): void
  onReset(): void
  onExport(): void
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

export function Controls(p: Props) {
  const { settings, onChange } = p
  return (
    <section className="controls" aria-label="Playback and chord controls">
      <div className="control">
        <span>Transpose</span>
        <button type="button" className="button" aria-label="Transpose down" onClick={() => onChange({ transpose: settings.transpose - 1 })}>−</button>
        <output aria-label="Transpose value">{signed(settings.transpose)}</output>
        <button type="button" className="button" aria-label="Transpose up" onClick={() => onChange({ transpose: settings.transpose + 1 })}>+</button>
      </div>
      <div className="control">
        <span>Capo</span>
        <button type="button" className="button" aria-label="Capo down" onClick={() => onChange({ capo: settings.capo - 1 })}>−</button>
        <output aria-label="Capo value">{settings.capo}</output>
        <button type="button" className="button" aria-label="Capo up" onClick={() => onChange({ capo: settings.capo + 1 })}>+</button>
      </div>
      <label className="control">
        Speed
        <select aria-label="Speed" value={settings.rate} onChange={(e) => onChange({ rate: Number(e.target.value) })}>
          {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
        </select>
      </label>
      <label className="control">
        <input type="checkbox" aria-label="Simplify chords" checked={settings.simplify}
          onChange={(e) => onChange({ simplify: e.target.checked })} />
        Simplify
      </label>
      <label className="control">
        <input type="checkbox" aria-label="Show bass notes" checked={settings.showBass}
          onChange={(e) => onChange({ showBass: e.target.checked })} />
        Show bass notes
      </label>
      <div className="control">
        <button type="button" className="button" onClick={p.onSetA}>Set A{p.loop.a !== null ? ` ${clock(p.loop.a)}` : ''}</button>
        <button type="button" className="button" onClick={p.onSetB}>Set B{p.loop.b !== null ? ` ${clock(p.loop.b)}` : ''}</button>
        {(p.loop.a !== null || p.loop.b !== null) && (
          <button type="button" className="button" onClick={p.onClearLoop}>Clear loop</button>
        )}
      </div>
      <div className="control">
        <button type="button" className="button" aria-pressed={p.editMode} onClick={p.onToggleEdit}>Edit chords</button>
        <button type="button" className="button" onClick={p.onReset}>Reset edits</button>
        <button type="button" className="button primary" onClick={p.onExport}>Export</button>
      </div>
    </section>
  )
}
