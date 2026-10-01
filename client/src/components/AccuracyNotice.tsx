import { useState } from 'react'

const KEY = 'chordarium:accuracy-notice-seen'

function alreadySeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** One-time heads-up for new users: detection is automatic and can be wrong. */
export function AccuracyNotice() {
  const [hidden, setHidden] = useState(alreadySeen)
  if (hidden) return null

  function dismiss() {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* storage unavailable: it will show again next visit */
    }
    setHidden(true)
  }

  return (
    <div role="note" aria-label="About accuracy" className="banner notice">
      <p>
        <strong>Good to know:</strong> chords, bass notes and song sections (Intro, Verse, Chorus…) are detected
        automatically, so some will be wrong. Check them against the video, and use <em>Edit chords</em> to fix any.
        Anything marked <span className="guess-mark">?</span> is a weaker guess.
      </p>
      <button type="button" className="button" onClick={dismiss}>Got it</button>
    </div>
  )
}
