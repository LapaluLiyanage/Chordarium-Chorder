import { useState } from 'react'
import { exportSong, slugTitle } from '../api'
import { useModalA11y } from '../hooks/useModalA11y'
import type { ViewSettings } from '../hooks/useViewSettings'
import type { ExportFormat, Timeline } from '../types'

const FORMATS: { fmt: ExportFormat; label: string; ext: string; hint: string }[] = [
  { fmt: 'pdf', label: 'PDF chord sheet', ext: '.pdf', hint: 'Printable bar grid with a chord legend' },
  { fmt: 'chordpro', label: 'ChordPro', ext: '.cho', hint: 'For OnSong, forScore, SongbookPro' },
  { fmt: 'txt', label: 'Plain text', ext: '.txt', hint: 'Paste into notes or messages' },
  { fmt: 'midi', label: 'MIDI', ext: '.mid', hint: 'Chord track + bass, at song tempo' },
  { fmt: 'json', label: 'JSON', ext: '.json', hint: 'Timestamps & confidence data' },
]

interface Props {
  songId: string
  title: string
  timeline: Timeline
  settings: ViewSettings
  onClose(): void
}

export function ExportModal({ songId, title, timeline, settings, onClose }: Props) {
  const modalRef = useModalA11y<HTMLDivElement>(onClose)
  const [fmt, setFmt] = useState<ExportFormat>('pdf')
  const [includeView, setIncludeView] = useState(true)
  const [simplify, setSimplify] = useState(settings.simplify)
  const [barsPerRow, setBarsPerRow] = useState<4 | 8>(4)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    setBusy(true)
    setError(null)
    try {
      const ext = FORMATS.find((f) => f.fmt === fmt)!.ext
      const blob = await exportSong(songId, timeline, {
        fmt,
        transpose: includeView ? settings.transpose : 0,
        capo: includeView ? settings.capo : 0,
        simplify,
        barsPerRow,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${slugTitle(title)}${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-label="Export chord sheet" onClick={(e) => e.stopPropagation()}>
        <p className="eyebrow">Format</p>
        <div className="formats" role="radiogroup" aria-label="Format">
          {FORMATS.map((f) => (
            <label key={f.fmt}>
              <input type="radio" name="fmt" checked={fmt === f.fmt} onChange={() => setFmt(f.fmt)} />
              <span className="fmt-row"><span>{f.label}</span><span className="fmt-ext">{f.ext}</span></span>
              <p className="muted">{f.hint}</p>
            </label>
          ))}
        </div>
        <p className="eyebrow">Options</p>
        <label><input type="checkbox" checked={includeView} onChange={(e) => setIncludeView(e.target.checked)} /> Apply current transpose &amp; capo</label>
        <label><input type="checkbox" checked={simplify} onChange={(e) => setSimplify(e.target.checked)} /> Simplified chords</label>
        <label>
          Bars per row{' '}
          <select value={barsPerRow} onChange={(e) => setBarsPerRow(Number(e.target.value) as 4 | 8)}>
            <option value={4}>4</option>
            <option value={8}>8</option>
          </select>
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="control">
          <button type="button" className="button primary" onClick={download} disabled={busy}>{busy ? 'Preparing…' : 'Download'}</button>
          <button type="button" className="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
