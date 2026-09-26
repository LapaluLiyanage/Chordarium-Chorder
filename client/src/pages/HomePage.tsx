import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { formatKey } from '../theory/chord'
import type { SongSummary } from '../types'

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function HomePage() {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<'fast' | 'accurate'>('fast')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [songs, setSongs] = useState<SongSummary[] | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    api.songs().then(setSongs).catch(() => setSongs([]))
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api.analyze(url.trim(), mode)
      navigate(r.song_id ? `/songs/${r.song_id}` : `/jobs/${r.job_id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <p className="eyebrow">Chord recognition studio</p>
      <h1>Paste a song. Play along with its chords.</h1>
      <form className="analyze-form" onSubmit={submit}>
        <label htmlFor="url" className="muted">YouTube link</label>
        <div className="url-field">
          <span className="badge">YT</span>
          <input id="url" type="text" inputMode="url" required placeholder="https://www.youtube.com/watch?v=…"
            value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <fieldset className="mode">
          <legend className="muted" style={{ gridColumn: '1 / -1' }}>Mode</legend>
          <label className="mode-option">
            <span className="mode-title">
              <input type="radio" name="mode" checked={mode === 'fast'} onChange={() => setMode('fast')} />
              Fast <span className="mode-time">~30 s</span>
            </span>
            <p>Chords and beats from the full mix. Great for pop, rock and most songs.</p>
          </label>
          <label className="mode-option">
            <span className="mode-title">
              <input type="radio" name="mode" checked={mode === 'accurate'} onChange={() => setMode('accurate')} />
              Accurate <span className="mode-time">~3 min</span>
            </span>
            <p>Separates vocals &amp; drums first. Best for jazz, live takes and extended chords.</p>
          </label>
        </fieldset>
        <div><button className="button primary" type="submit" disabled={busy}>{busy ? 'Starting…' : 'Analyze'}</button></div>
        {error && <p role="alert" className="error">{error}</p>}
      </form>

      <h2>Recent songs</h2>
      {songs !== null && songs.length > 0 && (
        <input type="search" aria-label="Search songs by title" placeholder="Search by title…"
          value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
      {songs === null ? <p className="muted">Loading…</p> : songs.length === 0 ? (
        <p className="muted">No songs yet — analyze your first link above.</p>
      ) : (() => {
        const filtered = songs.filter((s) => s.title.toLowerCase().includes(query.trim().toLowerCase()))
        return filtered.length === 0 ? (
          <p className="muted">No songs match “{query}”.</p>
        ) : (
          <div className="library">
            {filtered.map((s) => (
              <Link key={s.id} to={`/songs/${s.id}`} className="song-card" aria-label={s.title}>
                <div className="song-thumb">
                  <img src={`https://i.ytimg.com/vi/${s.video_id}/mqdefault.jpg`} alt="" loading="lazy" />
                  <span className="song-duration">{formatDuration(s.duration)}</span>
                </div>
                <div>
                  <strong>{s.title}</strong>
                  <div className="muted">
                    <span className="pill">{formatKey(s.key)}</span> · {Math.round(s.tempo)} BPM
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )
      })()}
    </main>
  )
}
