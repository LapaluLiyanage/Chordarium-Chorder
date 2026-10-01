import { useCallback, useState } from 'react'

/** Favourites and "continue practising" progress, kept in this browser only. */

const FAV_KEY = 'chordarium:favourites'
const progressKey = (songId: string) => `chordarium:progress:${songId}`
const INDEX_KEY = 'chordarium:progress-index'

export interface Progress {
  time: number
  section: string | null
  fraction: number
  at: number
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

export function saveProgress(songId: string, progress: Omit<Progress, 'at'>): void {
  writeJson(progressKey(songId), { ...progress, at: Date.now() })
  const index = readJson<string[]>(INDEX_KEY, []).filter((id) => id !== songId)
  writeJson(INDEX_KEY, [songId, ...index].slice(0, 30))
}

/** Most recently practised songs first. */
export function recentProgress(limit = 3): { songId: string; progress: Progress }[] {
  return readJson<string[]>(INDEX_KEY, [])
    .map((songId) => ({ songId, progress: readJson<Progress | null>(progressKey(songId), null) }))
    .filter((r): r is { songId: string; progress: Progress } => r.progress !== null)
    .slice(0, limit)
}

export function useFavourites(): [Set<string>, (songId: string) => void] {
  const [favs, setFavs] = useState<Set<string>>(() => new Set(readJson<string[]>(FAV_KEY, [])))
  const toggle = useCallback((songId: string) => {
    setFavs((prev) => {
      const next = new Set(prev)
      if (next.has(songId)) next.delete(songId)
      else next.add(songId)
      writeJson(FAV_KEY, [...next])
      return next
    })
  }, [])
  return [favs, toggle]
}
