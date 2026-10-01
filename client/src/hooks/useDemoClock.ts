import { useCallback, useEffect, useRef, useState } from 'react'

export interface DemoClock {
  time: number
  playing: boolean
  toggle(): void
  seek(t: number): void
}

const TICK_MS = 100

/** A fake playhead that runs through a sample song, optionally looping a time range. */
export function useDemoClock(duration: number, loop: { start: number; end: number } | null = null, enabled = true): DemoClock {
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(true)
  const loopRef = useRef(loop)
  useEffect(() => {
    loopRef.current = loop
  }, [loop])

  useEffect(() => {
    if (!playing || !enabled) return
    const id = setInterval(() => {
      setTime((t) => {
        let next = t + TICK_MS / 1000
        const l = loopRef.current
        if (l && (next >= l.end || next < l.start)) next = l.start
        return next >= duration ? 0 : next
      })
    }, TICK_MS)
    return () => clearInterval(id)
  }, [playing, enabled, duration])

  const toggle = useCallback(() => setPlaying((p) => !p), [])
  const seek = useCallback((t: number) => setTime(t), [])
  return { time, playing, toggle, seek }
}
