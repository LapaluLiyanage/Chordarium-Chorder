import { memo, useEffect, useRef, useState, type FormEvent } from 'react'
import { ensureGsap, gsap, motionOK } from '../motion'
import { Logo } from './Logo'
import { SiteNav } from './SiteNav'

type Mode = 'fast' | 'accurate'

interface Props {
  busy: boolean
  error: string | null
  /** called with the pasted link and chosen mode */
  onAnalyze(url: string, mode: Mode): void
  /** opens a song that is already in the library; omit when there is none */
  onSample?: () => void
}

const STATUS: Record<Mode, string> = {
  fast: 'Quick is great for a first look',
  accurate: 'Accurate takes about 3 minutes and finds bass notes and sections better',
}

const YOUTUBE = /youtu\.?be/i

export const Hero = memo(function Hero({ busy, error, onAnalyze, onSample }: Props) {
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<Mode>('fast')
  const root = useRef<HTMLDivElement>(null)
  const queue = useRef<HTMLDivElement>(null)

  // the design's entrance: letters rise, the form fades up, the logo spins in, the field pulses
  useEffect(() => {
    const el = root.current
    if (!el || !motionOK()) return
    ensureGsap()
    const ctx = gsap.context(() => {
      gsap.from('.wordmark-letter', { yPercent: 115, duration: 1, ease: 'power4.out', stagger: 0.055 })
      gsap.from('.hero-form', { y: 30, opacity: 0, duration: 0.8, delay: 0.5, ease: 'power3.out' })
      gsap.from('.notch-logo', { scale: 0, rotation: -180, duration: 1, delay: 0.4, ease: 'back.out(1.6)' })
      gsap.fromTo('.url-pill', { boxShadow: '0 0 0 0 rgba(35,29,23,.5), 0 14px 34px -14px rgba(35,29,23,.7)' },
        { boxShadow: '0 0 0 18px rgba(35,29,23,0), 0 14px 34px -14px rgba(35,29,23,.7)', duration: 1.6, repeat: -1, ease: 'power2.out', delay: 1.4 })
      gsap.to('.step-arrow', { y: 5, duration: 0.6, repeat: -1, yoyo: true, ease: 'sine.inOut' })
      gsap.to('.notch-logo .logo', { rotation: 360, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 1 } })
    }, el)
    // letters jump and spring back when hovered
    const mark = el.querySelector('.wordmark')
    const bounce = (e: Event) => {
      const letter = (e.target as Element).closest('.wordmark-letter')
      if (!letter) return
      gsap.timeline().to(letter, { y: -22, color: '#fbf5ea', duration: 0.22, ease: 'power2.out' })
        .to(letter, { y: 0, color: '#231d17', duration: 0.8, ease: 'elastic.out(1,.35)' })
    }
    mark?.addEventListener('mouseover', bounce)
    return () => {
      mark?.removeEventListener('mouseover', bounce)
      ctx.revert()
    }
  }, [])

  // a bar that fills over the expected analysis time while the request is being sent
  useEffect(() => {
    if (busy && queue.current && motionOK()) {
      gsap.fromTo(queue.current, { scaleX: 0 }, { scaleX: 1, duration: mode === 'fast' ? 30 : 180, ease: 'none' })
    }
  }, [busy, mode])

  // press Ctrl/Cmd+V anywhere on the page to drop a YouTube link into the field
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const text = e.clipboardData?.getData('text') ?? ''
      if (YOUTUBE.test(text)) {
        setUrl(text.trim())
        document.getElementById('top')?.scrollIntoView?.({ behavior: 'smooth' })
        document.getElementById('yt')?.focus()
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (url.trim()) onAnalyze(url.trim(), mode)
  }

  return (
    <div id="top" className="hero-panel" ref={root}>
      <SiteNav variant="hero" />
      <div className="hero-rule"><span>PASTE A SONG</span><i /><span>PLAY ALONG</span></div>
      <h1 className="wordmark" aria-label="Chordarium">
        {'CHORDARIUM'.split('').map((l, i) => (
          <span key={i} className="wordmark-letter" aria-hidden="true" style={{ animationDelay: `${i * 55}ms` }}>{l}</span>
        ))}
      </h1>
      <div className="hero-grid">
        <p className="hero-side">Chords for any YouTube song, in time with the video.</p>
        <form className="hero-form" onSubmit={submit}>
          <label htmlFor="yt" className="hero-step">
            <span className="step-num">1</span>START HERE — PASTE A YOUTUBE LINK<span className="step-arrow">↓</span>
          </label>
          <div className="url-pill">
            <span className="yt-badge" aria-hidden="true">▶</span>
            <input id="yt" type="text" inputMode="url" autoComplete="off" placeholder="https://www.youtube.com/watch?v=…"
              value={url} onChange={(e) => setUrl(e.target.value)} />
            <button type="submit" className="go-btn" data-mag="1" disabled={busy || !url.trim()}>{busy ? 'STARTING…' : 'GET CHORDS →'}</button>
          </div>
          <div className="hero-sub">
            {onSample && <><span>No link handy?</span><button type="button" className="link-btn" onClick={onSample}>Try a sample song</button></>}
            <span>· or press ⌘V / Ctrl+V anywhere</span>
          </div>
          <div className="hero-mode">
            <div className="segmented light" role="radiogroup" aria-label="Analysis mode">
              <button type="button" role="radio" aria-checked={mode === 'fast'} onClick={() => setMode('fast')}>QUICK ~30S</button>
              <button type="button" role="radio" aria-checked={mode === 'accurate'} onClick={() => setMode('accurate')}>ACCURATE ~3 MIN</button>
            </div>
            <span>{STATUS[mode]}</span>
          </div>
          {busy && <div className="queue-bar" aria-hidden="true"><div ref={queue} /></div>}
          {error && <p role="alert" className="hero-error">{error}</p>}
        </form>
        <p className="hero-side right">Loop a verse. Slow it down. Print the sheet.</p>
      </div>
      <div className="hero-notch" aria-hidden="true"><span className="notch-l" /><span className="notch-r" /><span className="notch-disc"><span className="notch-logo"><Logo size={64} /></span></span></div>
    </div>
  )
})
