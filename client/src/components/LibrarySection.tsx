import { memo, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { recentProgress } from '../hooks/useLibraryStore'
import { formatClock, isMinorKey, keyShort, keyTint, splitTitle } from '../lib/songMeta'
import type { SongSummary } from '../types'

type KeyFilter = 'ALL' | 'MAJOR' | 'MINOR'
type Sort = 'RECENT' | 'TITLE' | 'KEY' | 'BPM'

const KEY_OPTIONS: KeyFilter[] = ['ALL', 'MAJOR', 'MINOR']
const SORT_OPTIONS: Sort[] = ['RECENT', 'TITLE', 'KEY', 'BPM']

interface Props {
  songs: SongSummary[] | null
  favourites: Set<string>
  onFavourite(songId: string): void
}

function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: T[]; value: T; onChange(v: T): void }) {
  return (
    <div className="segmented sand" role="group" aria-label={label}>
      {options.map((o) => <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)}>{o}</button>)}
    </div>
  )
}

export const LibrarySection = memo(function LibrarySection({ songs, favourites, onFavourite }: Props) {
  const [query, setQuery] = useState('')
  const [keyFilter, setKeyFilter] = useState<KeyFilter>('ALL')
  const [sort, setSort] = useState<Sort>('RECENT')
  const [favOnly, setFavOnly] = useState(false)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (songs ?? []).filter((s) =>
      (!q || s.title.toLowerCase().includes(q)) &&
      (keyFilter === 'ALL' || isMinorKey(s.key) === (keyFilter === 'MINOR')) &&
      (!favOnly || favourites.has(s.id)))
    const by: Record<Sort, (a: SongSummary, b: SongSummary) => number> = {
      RECENT: () => 0, // the server already returns newest first
      TITLE: (a, b) => splitTitle(a.title).title.localeCompare(splitTitle(b.title).title),
      KEY: (a, b) => keyShort(a.key).localeCompare(keyShort(b.key)),
      BPM: (a, b) => a.tempo - b.tempo,
    }
    return [...list].sort(by[sort])
  }, [songs, query, keyFilter, sort, favOnly, favourites])

  const byId = new Map((songs ?? []).map((s) => [s.id, s]))
  const resume = recentProgress(3).filter((r) => byId.has(r.songId))
  const total = songs?.length ?? 0

  return (
    <section id="library" className="library">
      <div className="lib-top"><span>002</span><span>LIBRARY</span><span>{total} {total === 1 ? 'SONG' : 'SONGS'}</span></div>
      <div className="lib-head" data-reveal="1">
        <h2 className="mega lib-title">LIBRARY</h2>
        <p>Every song anyone analyses is saved here. Opening one is instant — no waiting.</p>
      </div>
      {resume.length > 0 && (
        <>
          <div className="rule-label"><span>CONTINUE PRACTISING</span><i /></div>
          <div className="resume-row" data-reveal="1">
            {resume.map(({ songId, progress }) => {
              const s = byId.get(songId)!
              const tint = keyTint(s.key)
              return (
                <Link key={songId} to={`/songs/${songId}`} className="resume-card" data-tilt="1" data-cursor="OPEN">
                  <span className="resume-key" style={{ background: tint }}>{keyShort(s.key)}</span>
                  <span className="resume-info">
                    <span className="resume-title">{splitTitle(s.title).title}</span>
                    <span className="resume-where">{(progress.section ?? 'SONG').toUpperCase()} · {formatClock(progress.time)}</span>
                    <span className="resume-bar"><span style={{ width: `${Math.round(progress.fraction * 100)}%`, background: tint }} /></span>
                  </span>
                </Link>
              )
            })}
          </div>
        </>
      )}
      <div className="lib-tools">
        <input type="search" aria-label="Search songs by title" placeholder="Search titles…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="lib-filters">
          <Segmented<KeyFilter> label="Filter by mode" options={KEY_OPTIONS} value={keyFilter} onChange={setKeyFilter} />
          <Segmented<Sort> label="Sort songs" options={SORT_OPTIONS} value={sort} onChange={setSort} />
          <button type="button" className="fav-filter" aria-pressed={favOnly} onClick={() => setFavOnly((v) => !v)}>★ FAVOURITES</button>
        </div>
      </div>
      {songs === null ? <p className="lib-empty">Loading…</p> : (
        <div className="song-grid" data-reveal="1">
          {visible.map((s, i) => {
            const { title, artist } = splitTitle(s.title)
            const fav = favourites.has(s.id)
            return (
              <div key={s.id} className="song-card" data-tilt="1">
                <Link to={`/songs/${s.id}`} aria-label={s.title} className="song-art" style={{ background: keyTint(s.key) }} data-cursor="OPEN">
                  <span className="song-no">#{String(i + 1).padStart(3, '0')}</span>
                  <span className={s.accurate ? 'song-q accurate' : 'song-q'}>{s.accurate ? 'ACCURATE' : 'QUICK'}</span>
                  <span className="song-key">{keyShort(s.key)}</span>
                  <span className="song-dur">{formatClock(s.duration)}</span>
                </Link>
                <div className="song-info">
                  <div className="song-text">
                    <span className="song-title">{title}</span>
                    <span className="song-sub">{artist ? `${artist} · ` : ''}{Math.round(s.tempo)} BPM</span>
                  </div>
                  <button type="button" className="fav-btn" aria-pressed={fav} aria-label={`${fav ? 'Remove' : 'Add'} ${title} ${fav ? 'from' : 'to'} favourites`}
                    onClick={() => onFavourite(s.id)}>{fav ? '★' : '☆'}</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {songs !== null && visible.length === 0 && (
        <p className="lib-empty">{total === 0 ? 'No songs yet — paste a link above to analyze your first one.' : 'No songs match. Paste a link above to add one.'}</p>
      )}
    </section>
  )
})
