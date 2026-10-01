import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { click } from '../audio'
import { AccuracyNotice } from '../components/AccuracyNotice'
import { ChordEditor } from '../components/ChordEditor'
import { ChordLane } from '../components/ChordLane'
import { Controls, type LoopRange as AbLoop } from '../components/Controls'
import { DiagramPanel } from '../components/DiagramPanel'
import { ExportModal } from '../components/ExportModal'
import { PlayPanel } from '../components/PlayPanel'
import { ReanalyzeBar } from '../components/ReanalyzeBar'
import { SectionEditor } from '../components/SectionEditor'
import { SheetSection } from '../components/SheetSection'
import { SiteFooter, SiteNav } from '../components/SiteNav'
import { useChordOverrides } from '../hooks/useChordOverrides'
import { saveProgress } from '../hooks/useLibraryStore'
import { useSectionEdits } from '../hooks/useSectionEdits'
import { RATES, useViewSettings } from '../hooks/useViewSettings'
import { useYouTubePlayer } from '../hooks/useYouTubePlayer'
import { splitTitle } from '../lib/songMeta'
import { sectionAt } from '../sections'
import { barAt, buildSheet } from '../sheet'
import { activeIndex } from '../sync'
import { formatKey, keySpelling, parse, render, simplify, transpose } from '../theory/chord'
import type { ExportFormat, Song } from '../types'

const COUNT_IN_BEATS = 4

export function TrackerPage() {
  const { songId = '' } = useParams()
  const [song, setSong] = useState<Song | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.song(songId).then(setSong).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [songId])

  if (error) {
    return (
      <>
        <SiteNav />
        <main className="page">
          <p role="alert" className="error">{error}</p>
          <Link to="/" className="button">Back to home</Link>
        </main>
      </>
    )
  }
  if (!song) return <><SiteNav /><main className="page"><p className="muted">Loading…</p></main></>
  return <Tracker song={song} />
}

/** index of the last beat at or before t (-1 before the first beat) */
function beatAt(beats: number[], t: number): number {
  let lo = 0
  let hi = beats.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (beats[mid] <= t) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

function Tracker({ song }: { song: Song }) {
  const t = song.timeline
  const navigate = useNavigate()
  const [settings, update] = useViewSettings(song.id)
  const [segments, applyOverride, resetOverrides] = useChordOverrides(song.id, t.segments)
  const detectedSections = useMemo(() => t.sections ?? [], [t.sections])
  const [sections, editSectionAt, resetSections] = useSectionEdits(song.id, detectedSections)
  const player = useYouTubePlayer('yt-player', t.video_id)
  const [loop, setLoop] = useState<AbLoop>({ a: null, b: null })
  const [editMode, setEditMode] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [editingSection, setEditingSection] = useState<number | null>(null)
  const [exportFormat, setExportFormat] = useState<ExportFormat | null>(null)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [perRow, setPerRow] = useState(4)
  const [countIn, setCountIn] = useState(false)
  const [metronome, setMetronome] = useState(false)
  const [trainer, setTrainer] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const countTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const shift = settings.transpose - settings.capo
  const tonic = keySpelling(t.key, shift)
  const renderOpts = useMemo(
    () => ({ transpose: settings.transpose, capo: settings.capo, simplify: settings.simplify, tonic }),
    [settings.transpose, settings.capo, settings.simplify, tonic],
  )
  const symbols = useMemo(() => segments.map((s) => render(s.label, renderOpts)), [segments, renderOpts])
  const sheet = useMemo(() => buildSheet(t, segments, sections, renderOpts), [t, segments, sections, renderOpts])

  const { setRate, ready, seek, time, play, pause, playing } = player
  const idx = activeIndex(segments, time)
  const currentChord = useMemo(() => {
    if (idx < 0) return null
    let c = parse(segments[idx].label)
    if (settings.simplify) c = simplify(c)
    return transpose(c, shift)
  }, [idx, segments, settings.simplify, shift])
  const currentSection = sectionAt(sections, time)
  const loopRange = useMemo(
    () => (loop.a !== null && loop.b !== null && loop.b > loop.a ? { start: loop.a, end: loop.b } : null),
    [loop.a, loop.b],
  )

  useEffect(() => {
    if (ready) setRate(settings.rate)
  }, [ready, setRate, settings.rate])

  // loop playback; with the tempo trainer on, every pass steps the speed up
  useEffect(() => {
    if (!loopRange || time <= loopRange.end) return
    seek(loopRange.start)
    if (trainer) {
      const next = RATES[Math.min(RATES.indexOf(settings.rate) + 1, RATES.length - 1)]
      if (next !== settings.rate) update({ rate: next })
    }
  }, [time, loopRange, seek, trainer, settings.rate, update])

  // metronome: a click on every detected beat, accented on the first beat of a bar
  const lastBeat = useRef(-1)
  useEffect(() => {
    const b = beatAt(t.beats, time)
    if (b === lastBeat.current) return
    lastBeat.current = b
    if (metronome && playing && b >= 0) click(t.downbeats.some((d) => Math.abs(d - t.beats[b]) < 0.05))
  }, [time, metronome, playing, t.beats, t.downbeats])

  // remember where you were, for "continue practising" on the home page
  const latest = useRef({ time, section: currentSection?.label ?? null })
  useEffect(() => {
    latest.current = { time, section: currentSection?.label ?? null }
  }, [time, currentSection])
  useEffect(() => {
    const save = () => {
      if (latest.current.time > 0) saveProgress(song.id, { ...latest.current, fraction: Math.min(1, latest.current.time / Math.max(t.duration, 1)) })
    }
    const id = setInterval(save, 3000)
    return () => { clearInterval(id); save() }
  }, [song.id, t.duration])

  const stopCountdown = useCallback(() => {
    if (countTimer.current) clearInterval(countTimer.current)
    countTimer.current = null
    setCountdown(null)
  }, [])
  useEffect(() => stopCountdown, [stopCountdown])

  /** start playing, with a spoken-style count-in first when it is switched on */
  const startPlayback = useCallback(() => {
    if (!countIn) { play(); return }
    pause()
    let n = COUNT_IN_BEATS
    setCountdown(n)
    click(true)
    const beatMs = (60 / (t.tempo * settings.rate)) * 1000
    countTimer.current = setInterval(() => {
      n -= 1
      if (n <= 0) { stopCountdown(); play(); return }
      setCountdown(n)
      click(false)
    }, beatMs)
  }, [countIn, play, pause, stopCountdown, t.tempo, settings.rate])

  function togglePlayback() {
    if (countdown !== null) { stopCountdown(); return }
    if (playing) pause()
    else startPlayback()
  }

  function toggleSectionLoop(s: { start: number; end: number }) {
    if (loopRange && Math.abs(loopRange.start - s.start) < 0.01 && Math.abs(loopRange.end - s.end) < 0.01) {
      setLoop({ a: null, b: null })
      return
    }
    setLoop({ a: s.start, b: s.end })
    seek(s.start)
    startPlayback()
  }

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

  const { title, artist } = splitTitle(t.title)
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  return (
    <>
      <SiteNav />
      <main className={settings.showBass ? 'song' : 'song hide-bass'}>
        <header className="song-head">
          <h1 className="mega track-title">{title}</h1>
          <div className="song-chips">
            {artist && <span className="chip-meta">{artist}</span>}
            <span className="chip-meta">{formatKey(t.key, settings.transpose)}</span>
            <span className="chip-meta">{Math.round(t.tempo)} BPM</span>
            <span className="chip-meta">{t.time_signature}/4</span>
            {settings.capo > 0 && <span className="chip-meta">Capo {settings.capo}</span>}
            {currentSection && <span className="chip-meta" aria-label="Current section">{currentSection.label}</span>}
            <span className="chip-meta muted">{t.engine.chords === 'btc-large' ? 'BTC model' : 'Template model'}{t.engine.separated ? ' · stems' : ''}</span>
          </div>
        </header>
        <div className="notices">
          {t.warnings.length > 0 && (
            <div role="status" aria-label="Analysis warnings" className="banner">
              {t.warnings.map((w) => <p key={w}>{w}</p>)}
            </div>
          )}
          <AccuracyNotice />
          <ReanalyzeBar hasSections={t.sections !== undefined} separated={t.engine.separated} busy={reanalyzing} onReanalyze={reanalyze} />
          {actionError && <p role="alert" className="error">{actionError}</p>}
        </div>

        <section id="play" className="stage dark-surface" aria-label="Play along workspace">
          <div className="stage-grid">
            <div className="player"><div id="yt-player" /></div>
            <PlayPanel title={(artist ? `${artist} · ` : '') + title} meta={`${formatKey(t.key, settings.transpose)} · ${Math.round(t.tempo)} BPM`}
              badge={t.engine.separated ? 'ACCURATE' : 'QUICK'} segments={segments} symbols={symbols} sections={sections}
              beats={t.beats} duration={t.duration} time={time} loop={loopRange} countdown={countdown} onSeek={seek}
              footer={
                <div className="transport-pill">
                  <button type="button" onClick={togglePlayback}>
                    <span>{countdown !== null ? 'CANCEL' : playing ? 'PAUSE' : 'PLAY'}</span>
                    <span>BAR {Math.max(barAt(t.downbeats, time) + 1, 1)}/{t.downbeats.length}</span>
                  </button>
                  <span className="live-badge">{playing ? 'LIVE' : 'READY'}</span>
                </div>
              } />
          </div>
          <ChordLane segments={segments} sections={sections} symbols={symbols} beats={t.beats} downbeats={t.downbeats} duration={t.duration}
            time={time} editMode={editMode} onSeek={seek} onEdit={setEditing} onEditSection={setEditingSection} />
          <p className="lane-legend" aria-label="Colour key"><span>Chord</span> · <span className="legend-bass">Bass note</span></p>
          <div className="practice" role="group" aria-label="Practice tools">
            <button type="button" className="pill-btn" aria-pressed={countIn} onClick={() => setCountIn((v) => !v)}>COUNT-IN</button>
            <button type="button" className="pill-btn" aria-pressed={metronome} onClick={() => setMetronome((v) => !v)}>METRONOME</button>
            <button type="button" className="pill-btn" aria-pressed={trainer} onClick={() => setTrainer((v) => !v)}>TEMPO TRAINER</button>
            <span className="practice-note">
              {loopRange ? `Looping ${clock(loopRange.start)}–${clock(loopRange.end)}${trainer ? ` · speed ${settings.rate}×, steps up each pass` : ''}` : 'Tap a section in the sheet below to loop it.'}
            </span>
          </div>
          <div className="stage-bottom">
            <DiagramPanel chord={currentChord} label={idx >= 0 ? symbols[idx] : 'N.C.'} />
            <Controls settings={settings} onChange={update} loop={loop}
              onSetA={() => setLoop((l) => ({ ...l, a: time }))} onSetB={() => setLoop((l) => ({ ...l, b: time }))}
              onClearLoop={() => setLoop({ a: null, b: null })} editMode={editMode} onToggleEdit={() => setEditMode((m) => !m)}
              onReset={resetEdits} onExport={() => setExportFormat('pdf')} />
          </div>
        </section>

        <SheetSection id="sheet" title={title} label="SYNCED"
          meta={`${artist ? `${artist.toUpperCase()} · ` : ''}KEY ${formatKey(t.key, settings.transpose).toUpperCase()} · ${Math.round(t.tempo)} BPM · ${t.time_signature}/4 · ${t.engine.separated ? 'ACCURATE' : 'QUICK'} ANALYSIS`}
          sections={sheet} perRow={perRow} onPerRow={setPerRow} transpose={settings.transpose}
          onTranspose={(d) => update({ transpose: settings.transpose + d })} simplify={settings.simplify}
          onSimplify={() => update({ simplify: !settings.simplify })} playing={playing} onTogglePlay={togglePlayback}
          currentBar={barAt(t.downbeats, time)} onSeekBar={(b) => seek(b.start)} loop={loopRange} onLoop={toggleSectionLoop}
          footer={
            <div className="export-links">
              <button type="button" onClick={() => setExportFormat('pdf')}>PDF</button>
              <button type="button" onClick={() => setExportFormat('chordpro')}>CHORDPRO</button>
              <button type="button" onClick={() => setExportFormat('txt')}>TXT</button>
              <button type="button" className="primary" onClick={() => setExportFormat('pdf')}>DOWNLOAD WHAT YOU SEE</button>
            </div>
          } />
        <SiteFooter />

        {editing !== null && (
          <ChordEditor segment={segments[editing]} shift={shift} tonic={tonic} error={actionError} onApply={applyEdit} onClose={() => setEditing(null)} />
        )}
        {editingSection !== null && sections[editingSection] && (
          <SectionEditor section={sections[editingSection]} index={editingSection} downbeats={t.downbeats}
            onApply={(patch) => { editSectionAt(editingSection, patch); setEditingSection(null) }}
            onClose={() => setEditingSection(null)} />
        )}
        {exportFormat !== null && (
          <ExportModal songId={song.id} title={t.title} timeline={{ ...t, segments, sections }} settings={settings}
            initialFormat={exportFormat} onClose={() => setExportFormat(null)} />
        )}
      </main>
    </>
  )
}
