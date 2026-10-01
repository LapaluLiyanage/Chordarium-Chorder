interface Props {
  hasSections: boolean
  separated: boolean
  busy: boolean
  onReanalyze(mode: 'fast' | 'accurate'): void
}

/** Offers a better analysis when this one has no sections or was a quick (fast-mode) pass. */
export function ReanalyzeBar({ hasSections, separated, busy, onReanalyze }: Props) {
  if (hasSections && separated) return null
  const missing = !hasSections
  // keep the mode the song was analyzed in when only sections are missing
  const mode = missing && !separated ? 'fast' : 'accurate'
  const message = missing
    ? 'This song was analyzed before section labels (Intro, Verse, Chorus) existed.'
    : 'This was a quick analysis. Accurate mode finds bass notes and song sections more reliably.'
  const action = missing ? 'Detect sections' : 'Re-run in accurate mode (~3 min)'
  return (
    <div role="status" aria-label="Improve this analysis" className="banner">
      <p>{message}</p>
      <button type="button" className="button" disabled={busy} onClick={() => onReanalyze(mode)}>
        {busy ? 'Starting…' : action}
      </button>
      <p className="muted">Re-running replaces this analysis and discards your chord and section edits.</p>
    </div>
  )
}
