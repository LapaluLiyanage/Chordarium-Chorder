import { useCallback, useEffect, useRef, useState } from 'react'

interface YTPlayer {
  getCurrentTime?: () => number
  seekTo(seconds: number, allowSeekAhead: boolean): void
  setPlaybackRate(rate: number): void
  playVideo(): void
  pauseVideo(): void
  destroy(): void
}

interface YTNamespace {
  Player: new (elementId: string, opts: unknown) => YTPlayer
  PlayerState: { PLAYING: number }
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<YTNamespace> | null = null

export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const previous = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        previous?.()
        resolve(window.YT as YTNamespace)
      }
      const script = document.createElement('script')
      script.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(script)
    })
  }
  return apiPromise
}

export interface PlayerControls {
  ready: boolean
  time: number
  playing: boolean
  seek(t: number): void
  setRate(r: number): void
  play(): void
  pause(): void
}

export function useYouTubePlayer(elementId: string, videoId: string): PlayerControls {
  const playerRef = useRef<YTPlayer | null>(null)
  const [ready, setReady] = useState(false)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    let cancelled = false
    let frame = 0
    let last = -1
    loadYouTubeApi().then((YT) => {
      if (cancelled) return
      playerRef.current = new YT.Player(elementId, {
        videoId,
        playerVars: { rel: 0, playsinline: 1, modestbranding: 1 },
        events: {
          onReady: () => !cancelled && setReady(true),
          onStateChange: (e: { data: number }) => !cancelled && setPlaying(e.data === YT.PlayerState.PLAYING),
        },
      })
      const loop = () => {
        const t = playerRef.current?.getCurrentTime?.() ?? 0
        if (Math.abs(t - last) > 0.02) {
          last = t
          setTime(t)
        }
        frame = requestAnimationFrame(loop)
      }
      frame = requestAnimationFrame(loop)
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      playerRef.current?.destroy()
      playerRef.current = null
      setReady(false)
    }
  }, [elementId, videoId])

  const seek = useCallback((t: number) => {
    playerRef.current?.seekTo(t, true)
    setTime(t)
  }, [])
  const setRate = useCallback((r: number) => playerRef.current?.setPlaybackRate(r), [])

  const play = useCallback(() => playerRef.current?.playVideo(), [])
  const pause = useCallback(() => playerRef.current?.pauseVideo(), [])

  return { ready, time, playing, seek, setRate, play, pause }
}
