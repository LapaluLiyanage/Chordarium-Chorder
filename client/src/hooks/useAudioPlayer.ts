import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlayerControls } from './useYouTubePlayer'

/** Drives an <audio> element (songs from an uploaded file) with the same controls as the YouTube player. */
export function useAudioPlayer(elementId: string, src: string | null): PlayerControls {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [ready, setReady] = useState(false)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!src) return
    const audio = document.getElementById(elementId) as HTMLAudioElement | null
    if (!audio) return
    audioRef.current = audio
    let frame = 0
    let last = -1
    const onReady = () => setReady(true)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    audio.addEventListener('loadedmetadata', onReady)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onPause)
    const loop = () => {
      // covers metadata that loaded before the listener was attached
      if (audio.readyState >= 1) setReady(true)
      const t = audio.currentTime
      if (Math.abs(t - last) > 0.02) {
        last = t
        setTime(t)
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(frame)
      audio.removeEventListener('loadedmetadata', onReady)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onPause)
      audioRef.current = null
      setReady(false)
    }
  }, [elementId, src])

  const seek = useCallback((t: number) => {
    if (audioRef.current) audioRef.current.currentTime = t
    setTime(t)
  }, [])
  const setRate = useCallback((r: number) => {
    if (audioRef.current) audioRef.current.playbackRate = r
  }, [])
  const play = useCallback(() => { audioRef.current?.play().catch(() => undefined) }, [])
  const pause = useCallback(() => audioRef.current?.pause(), [])

  return { ready, time, playing, seek, setRate, play, pause }
}
