import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { AccuracyNotice } from '../components/AccuracyNotice'
import { ChordEditor } from '../components/ChordEditor'
import { ChordHero } from '../components/ChordHero'
import { ChordLane } from '../components/ChordLane'
import { Controls, type LoopRange } from '../components/Controls'
import { DiagramPanel } from '../components/DiagramPanel'
import { ExportModal } from '../components/ExportModal'
import { ReanalyzeBar } from '../components/ReanalyzeBar'
import { SectionEditor } from '../components/SectionEditor'
import { useChordOverrides } from '../hooks/useChordOverrides'
import { useSectionEdits } from '../hooks/useSectionEdits'
import { useViewSettings } from '../hooks/useViewSettings'
import { useYouTubePlayer } from '../hooks/useYouTubePlayer'
import { sectionAt } from '../sections'
import { activeIndex, beatsUntil, isLowConfidence, upcomingIndex } from '../sync'
import { formatKey, keySpelling, parse, render, simplify, transpose } from '../theory/chord'
import type { Song } from '../types'

export function TrackerPage() {
  const { songId = '' } = useParams()
  const [song, setSong] = useState<Song | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.song(songId).then(setSong).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [songId])

  if (error) {
    return (
      <main className="page">
        <p role="alert" className="error">{error}</p>
        <Link to="/" className="button">Back to home</Link>
      </main>
    )
  }
  if (!song) return <main className="page"><p className="muted">Loading…</p></main>
  return <Tracker song={song} />
}

function Tracker({ song }: { song: Song }) {
  const t = song.timeline
  const [settings, update] = useViewSettings(song.id)
  const [segments, applyOverride, resetOverrides] = useChordOverrides(song.id, t.segments)
  const detectedSections = useMemo(() => t.sections ?? [], [t.sections])
  const [sections, editSectionAt, resetSections] = useSectionEdits(song.id, detectedSections)
  const navigate = useNavigate()
  const [editingSection, setEditingSection] = useState<number | null>(null)
  const [reanalyzing, setReanalyzing] = useState(false)
  const player = useYouTubePlayer('yt-player', t.video_id)
  const [loop, setLoop] = useState<LoopRange>({ a: null, b: null })
  const [editMode, setEditMode] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const shift = settings.transpose - settings.capo
  const tonic = keySpelling(t.key, shift)
  const symbols = useMemo(
    () => segments.map((s) => render(s.label, { transpose: settings.transpose, capo: settings.capo, simplify: settings.simplify, tonic })),
    [segments, settings.transpose, settings.capo, settings.simplify, tonic],
  )

  const idx = activeIndex(segments, player.time)
  const currentSection = sectionAt(sections, player.time)
  const next = upcomingIndex(segments, player.time)
  const beatsToNext = next >= 0 ? beatsUntil(t.beats, player.time, segments[next].start) : 0
  const currentChord = useMemo(() => {
    if (idx < 0) return null
    let c = parse(segments[idx].label)
    if (settings.simplify) c = simplify(c)
    return transpose(c, shift)
  }, [idx, segments, settings.simplify, shift])

  const { setRate, ready, seek, time } = player
  useEffect(() => {
    if (ready) setRate(settings.rate)
  }, [ready, setRate, settings.rate])

  useEffect(() => {
    if (loop.a !== null && loop.b !== null && loop.b > loop.a && time > loop.b) seek(loop.a)
  }, [time, loop, seek])

  function applyEdit(label: string, applyToAll: boolean) {
    if (editing === null) return
    try {
      applyOverride(editing, label, applyToAll)
      setEditing(null)
      setActionError(null)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  async function reanalyze(mode: 'fast' | 'accurate') {
    setReanalyzing(true)
    try {
      const r = await api.analyze(`https://www.youtube.com/watch?v=${t.video_id}`, mode, true)
      resetOverrides()
      resetSections()
      navigate(r.job_id ? `/jobs/${r.job_id}` : `/songs/${r.song_id}`)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
      setReanalyzing(false)
    }
  }

  function resetEdits() {
    resetOverrides()
    resetSections()
    setActionError(null)
  }

  return (
    <main className={settings.showBass ? 'page tracker' : 'page tracker hide-bass'}>
      <div>
        <h1>{t.title}</h1>
        <div className="chips">
          <span className="chip-meta">{formatKey(t.key, settings.transpose)}</span>
          <span className="chip-meta">{Math.round(t.tempo)} BPM</span>
          <span className="chip-meta">{t.time_signature}/4</span>
          {settings.capo > 0 && <span className="chip-meta">Capo {settings.capo}</span>}
          {currentSection && <span className="chip-meta" aria-label="Current section">{currentSection.label}</span>}
          <span className="chip-meta muted">{t.engine.chords === 'btc-large' ? 'BTC model' : 'Template model'}{t.engine.separated ? ' · stems' : ''}</span>
        </div>
      </div>
      {t.warnings.length > 0 && (
        <div role="status" aria-label="Analysis warnings" className="banner">
          {t.warnings.map((w) => <p key={w}>{w}</p>)}
        </div>
      )}
      <AccuracyNotice />
      <ReanalyzeBar hasSections={t.sections !== undefined} separated={t.engine.separated}
        busy={reanalyzing} onReanalyze={reanalyze} />
      {actionError && <p role="alert" className="error">{actionError}</p>}
      <div className="tracker-top">
        <div className="player"><div id="yt-player" /></div>
        <ChordHero current={idx >= 0 ? symbols[idx] : null} next={next >= 0 ? symbols[next] : null} beatsToNext={beatsToNext}
          lowConfidence={idx >= 0 && isLowConfidence(segments[idx].confidence)} />
      </div>
      <ChordLane segments={segments} sections={sections} symbols={symbols} beats={t.beats} downbeats={t.downbeats} duration={t.duration}
        time={player.time} editMode={editMode} onSeek={seek} onEdit={setEditing} onEditSection={setEditingSection} />
      <p className="lane-legend muted" aria-label="Colour key">
        <span className="legend-chord">Chord</span> · <span className="legend-bass">Bass note</span>
      </p>
      <div className="tracker-bottom">
        <DiagramPanel chord={currentChord} label={idx >= 0 ? symbols[idx] : 'N.C.'} />
        <Controls settings={settings} onChange={update} loop={loop}
          onSetA={() => setLoop((l) => ({ ...l, a: time }))} onSetB={() => setLoop((l) => ({ ...l, b: time }))}
          onClearLoop={() => setLoop({ a: null, b: null })} editMode={editMode} onToggleEdit={() => setEditMode((m) => !m)}
          onReset={resetEdits} onExport={() => setExporting(true)} />
      </div>
      {editing !== null && (
        <ChordEditor segment={segments[editing]} shift={shift} tonic={tonic} error={actionError} onApply={applyEdit} onClose={() => setEditing(null)} />
      )}
      {editingSection !== null && sections[editingSection] && (
        <SectionEditor section={sections[editingSection]} index={editingSection} downbeats={t.downbeats}
          onApply={(patch) => { editSectionAt(editingSection, patch); setEditingSection(null) }}
          onClose={() => setEditingSection(null)} />
      )}
      {exporting && (
        <ExportModal songId={song.id} title={t.title} timeline={{ ...t, segments, sections }} settings={settings}
          onClose={() => setExporting(false)} />
      )}
    </main>
  )
}
