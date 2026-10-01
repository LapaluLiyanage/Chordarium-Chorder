import { keySpelling } from '../theory/chord'

const TINTS = ['#f2913d', '#6aa8e0', '#b48be0', '#6fbf8b', '#ee8577', '#f2c14e']
const TONICS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const NOISE = /\s*[([][^)\]]*(official|video|audio|lyrics?|remaster|4k|hd|mv|music)[^)\]]*[)\]]/gi

/** "Artist - Song (Official Video)" -> { artist, title }; falls back to the whole title. */
export function splitTitle(raw: string): { title: string; artist: string | null } {
  const cleaned = raw.replace(NOISE, '').replace(/\s*\|.*$/, '').trim() || raw.trim()
  const m = cleaned.match(/^(.{1,60}?)\s+[-–—]\s+(.+)$/)
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: null, title: cleaned }
}

export function isMinorKey(key: string): boolean {
  return key.endsWith(':min')
}

/** "G:min" -> "Gm", "C:maj" -> "C" */
export function keyShort(key: string): string {
  try {
    return keySpelling(key) + (isMinorKey(key) ? 'm' : '')
  } catch {
    return key
  }
}

/** A stable card colour per tonic, so the same key always looks the same. */
export function keyTint(key: string): string {
  const pc = TONICS.indexOf(key.split(':')[0])
  return TINTS[(pc < 0 ? 0 : pc) % TINTS.length]
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
