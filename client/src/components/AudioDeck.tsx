import { useEffect, useState, type CSSProperties } from 'react'

interface Props {
  /** id the audio player hook looks the element up by */
  audioId: string
  src: string
  title: string
  artist: string | null
  time: number
  duration: number
  playing: boolean
  onToggle(): void
  onSeek(t: number): void
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Themed player for songs from an uploaded file; replaces the browser's own audio controls. */
export function AudioDeck({ audioId, src, title, artist, time, duration, playing, onToggle, onSeek }: Props) {
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    const audio = document.getElementById(audioId) as HTMLAudioElement | null
    if (!audio) return
    audio.volume = volume
    audio.muted = muted
  }, [audioId, volume, muted])

  const total = Math.max(duration, 1)
  const progress = Math.min(1, time / total)
  const quiet = muted || volume === 0

  return (
    <div className="audio-card">
      <audio id={audioId} src={src} preload="metadata" />
      <span className="audio-badge">UPLOADED FILE</span>
      <div>
        <p className="audio-title">{title}</p>
        {artist && <p className="audio-artist">{artist}</p>}
      </div>
      <div className="deck">
        <button type="button" className="deck-play" aria-label={playing ? 'Pause' : 'Play'} onClick={onToggle}>
          {playing
            ? <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>}
        </button>
        <span className="deck-time">{clock(time)}</span>
        <input type="range" className="deck-range deck-seek" aria-label="Seek" min={0} max={total} step={0.1}
          value={Math.min(time, total)} style={{ '--p': `${progress * 100}%` } as CSSProperties}
          onChange={(e) => onSeek(Number(e.target.value))} />
        <span className="deck-time">{clock(duration)}</span>
        <button type="button" className="deck-mute" aria-label={quiet ? 'Unmute' : 'Mute'} aria-pressed={quiet}
          onClick={() => { setMuted((m) => !m); if (volume === 0) setVolume(1) }}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
            {quiet
              ? <path d="M16 9.5l5 5m0-5l-5 5" fill="none" strokeWidth="2" strokeLinecap="round" />
              : <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" strokeWidth="2" strokeLinecap="round" />}
          </svg>
        </button>
        <input type="range" className="deck-range deck-volume" aria-label="Volume" min={0} max={1} step={0.05}
          value={quiet ? 0 : volume} style={{ '--p': `${(quiet ? 0 : volume) * 100}%` } as CSSProperties}
          onChange={(e) => { setVolume(Number(e.target.value)); setMuted(false) }} />
      </div>
    </div>
  )
}
