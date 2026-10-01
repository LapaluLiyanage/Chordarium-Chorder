import { useEffect, useMemo, useState } from 'react'
import type { DemoClock } from '../hooks/useDemoClock'
import { barAt } from '../sheet'
import { activeIndex } from '../sync'
import { formatKey, keySpelling, render } from '../theory/chord'
import type { Timeline } from '../types'
import { PlayPanel } from './PlayPanel'

const FEATURES = [
  { tag: 'BIG CHORD', color: '#f2913d', title: 'PLAY ALONG',
    body: 'The current chord, huge — readable from a music stand. Next chord, beat dots, and a coloured structure bar to jump anywhere.' },
  { tag: 'READ & PRINT', color: '#6aa8e0', title: 'CHORD SHEET',
    body: 'The whole song as a bar grid, grouped by section and synced to playback. What you see is what you download.' },
  { tag: 'LOOP & SLOW', color: '#6fbf8b', title: 'PRACTICE',
    body: 'Tap a section to loop it. Slow to 0.5×, add a count-in, and let the tempo trainer nudge you faster each pass.' },
]

export function ToolSection({ timeline, clock }: { timeline: Timeline; clock: DemoClock }) {
  const [feat, setFeat] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused || (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return
    const id = setInterval(() => setFeat((f) => (f + 1) % FEATURES.length), 5000)
    return () => clearInterval(id)
  }, [paused])

  const tonic = keySpelling(timeline.key)
  const symbols = useMemo(() => timeline.segments.map((s) => render(s.label, { tonic })), [timeline, tonic])
  const idx = activeIndex(timeline.segments, clock.time)
  const upcoming = idx < 0 ? [] : symbols.slice(idx, idx + 6)
  const bar = Math.max(barAt(timeline.downbeats, clock.time) + 1, 1)
  const f = FEATURES[feat]

  return (
    <section id="tool" className="tool" data-reveal="1">
      <div className="tool-copy">
        <div className="tool-top"><span>001</span><span>THE TOOL</span><span>2026</span></div>
        <div className="tool-feature" key={feat}>
          <span className="tool-tag" style={{ background: f.color }}>{f.tag}</span>
          <h2 className="mega">{f.title}</h2>
          <p>{f.body}</p>
          <div className="tool-dots" role="group" aria-label="Features">
            {FEATURES.map((x, i) => (
              <button key={x.title} type="button" aria-label={`Feature ${i + 1}: ${x.title}`} aria-current={i === feat}
                className={i === feat ? 'on' : ''} onClick={() => { setFeat(i); setPaused(true) }} />
            ))}
          </div>
        </div>
        <div className="tool-specs"><span>TRANSPOSE<br />±6</span><span>CAPO<br />0–7</span><span>SPEED<br />0.5–1.5×</span></div>
      </div>
      <div className="tool-stage">
        <div className="ring ring-amber" aria-hidden="true" />
        <div className="ring ring-blue" aria-hidden="true" />
        <div className="tool-card">
          <PlayPanel title="SAMPLE · AUTUMN LEAVES" meta={`${formatKey(timeline.key)} · ${Math.round(timeline.tempo)} BPM`} badge="DEMO"
            segments={timeline.segments} symbols={symbols} sections={timeline.sections ?? []} beats={timeline.beats}
            duration={timeline.duration} time={clock.time} onSeek={clock.seek}
            footer={
              <div className="transport-pill">
                <button type="button" onClick={clock.toggle}><span>{clock.playing ? 'PAUSE' : 'PLAY'}</span><span>BAR {bar}/{timeline.downbeats.length}</span></button>
                <span className="live-badge">LIVE</span>
              </div>
            }>
            <div className="mini-lane" aria-hidden="true">
              {upcoming.map((c, i) => <span key={`${idx}-${i}`} className={i === 0 ? 'now' : ''}>{c}</span>)}
            </div>
          </PlayPanel>
        </div>
      </div>
    </section>
  )
}
