import { memo, useEffect, useState, type FormEvent } from 'react'
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
    <div id="top" className="hero-panel">
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
          {error && <p role="alert" className="hero-error">{error}</p>}
        </form>
        <p className="hero-side right">Loop a verse. Slow it down. Print the sheet.</p>
      </div>
      <div className="hero-notch" aria-hidden="true"><span className="notch-l" /><span className="notch-r" /><span className="notch-disc"><span className="notch-logo"><Logo size={64} /></span></span></div>
    </div>
  )
})
