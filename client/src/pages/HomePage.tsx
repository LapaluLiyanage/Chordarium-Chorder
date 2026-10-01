import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Hero } from '../components/Hero'
import { IntroSection } from '../components/IntroSection'
import { LibrarySection } from '../components/LibrarySection'
import { SheetSection } from '../components/SheetSection'
import { SiteFooter } from '../components/SiteNav'
import { ToolSection } from '../components/ToolSection'
import { DEMO_TIMELINE } from '../demo'
import { useDemoClock } from '../hooks/useDemoClock'
import { useFavourites } from '../hooks/useLibraryStore'
import { barAt, buildSheet } from '../sheet'
import { formatKey, keySpelling } from '../theory/chord'
import type { SongSummary } from '../types'

const SAMPLE_FOOTER = <span className="sheet-hint">Analyze a song to download its own sheet as PDF, ChordPro or TXT.</span>

export function HomePage() {
  const navigate = useNavigate()
  const { hash } = useLocation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [songs, setSongs] = useState<SongSummary[] | null>(null)
  const [favourites, toggleFavourite] = useFavourites()

  // the sample sheet's own controls
  const [loop, setLoop] = useState<{ start: number; end: number } | null>(null)
  const [shift, setShift] = useState(0)
  const [perRow, setPerRow] = useState(4)
  const [simplify, setSimplify] = useState(false)
  const clock = useDemoClock(DEMO_TIMELINE.duration, loop)

  useEffect(() => {
    api.songs().then(setSongs).catch(() => setSongs([]))
  }, [])

  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView?.()
  }, [hash, songs])

  const analyze = useCallback(async (url: string, mode: 'fast' | 'accurate') => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.analyze(url, mode)
      navigate(r.song_id ? `/songs/${r.song_id}` : `/jobs/${r.job_id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }, [navigate])

  const sheet = useMemo(
    () => buildSheet(DEMO_TIMELINE, DEMO_TIMELINE.segments, DEMO_TIMELINE.sections ?? [],
      { transpose: shift, simplify, tonic: keySpelling(DEMO_TIMELINE.key, shift) }),
    [shift, simplify],
  )
  const transposeBy = useCallback((d: number) => setShift((s) => Math.max(-6, Math.min(6, s + d))), [])
  const toggleSimplify = useCallback(() => setSimplify((v) => !v), [])
  const seekDemo = clock.seek
  const seekBar = useCallback((b: { start: number }) => seekDemo(b.start), [seekDemo])
  const toggleLoop = useCallback((s: { start: number; end: number }) => setLoop((l) => (l && l.start === s.start && l.end === s.end ? null : { start: s.start, end: s.end })), [])
  const sampleId = songs && songs.length > 0 ? songs[0].id : null
  const openSample = useCallback(() => { if (sampleId) navigate(`/songs/${sampleId}`) }, [sampleId, navigate])

  return (
    <main className="home">
      <Hero busy={busy} error={error} onAnalyze={analyze} onSample={sampleId ? openSample : undefined} />
      <IntroSection timeline={DEMO_TIMELINE} clock={clock} />
      <div className="rule-line" />
      <div className="steps-bar"><span>① PASTE A LINK</span><span>② WE FIND THE CHORDS</span><span>③ YOU PLAY ALONG</span></div>
      <ToolSection timeline={DEMO_TIMELINE} clock={clock} />
      <LibrarySection songs={songs} favourites={favourites} onFavourite={toggleFavourite} />
      <SheetSection id="sheet" title="AUTUMN LEAVES" label="SAMPLE · SYNCED"
        meta={`KEY ${formatKey(DEMO_TIMELINE.key, shift).toUpperCase()} · 120 BPM · 4/4 · SAMPLE SONG`}
        sections={sheet} perRow={perRow} onPerRow={setPerRow} transpose={shift} onTranspose={transposeBy}
        simplify={simplify} onSimplify={toggleSimplify} playing={clock.playing} onTogglePlay={clock.toggle}
        currentBar={barAt(DEMO_TIMELINE.downbeats, clock.time)} onSeekBar={seekBar}
        loop={loop} onLoop={toggleLoop}
        footer={SAMPLE_FOOTER} />
      <SiteFooter />
    </main>
  )
}
