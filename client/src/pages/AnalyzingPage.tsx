import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { SiteNav } from '../components/SiteNav'
import type { Job, JobState } from '../types'

const STEPS: [JobState, string][] = [
  ['downloading', 'Downloading audio'],
  ['separating', 'Separating stems (vocals, drums, bass)'],
  ['beats', 'Detecting beats'],
  ['chords', 'Recognizing chords'],
  ['bass', 'Detecting bass notes and inversions'],
  ['key', 'Estimating key'],
]
const FINAL: JobState[] = ['done', 'failed', 'cancelled']
const MAX_CONSECUTIVE_FAILURES = 3

export function AnalyzingPage({ pollMs = 1000 }: { pollMs?: number }) {
  const { jobId = '' } = useParams()
  const navigate = useNavigate()
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let consecutiveFailures = 0
    const tick = async () => {
      try {
        const j = await api.job(jobId)
        if (stopped) return
        consecutiveFailures = 0
        setJob(j)
        if (j.state === 'done' && j.song_id) {
          navigate(`/songs/${j.song_id}`, { replace: true })
          return
        }
        if (FINAL.includes(j.state)) return
      } catch (e) {
        if (stopped) return
        const isNotFound = e instanceof ApiError && e.status === 404
        consecutiveFailures += 1
        if (isNotFound || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          setError(e instanceof Error ? e.message : String(e))
          return
        }
      }
      timer = setTimeout(tick, pollMs)
    }
    tick()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [jobId, pollMs, navigate])

  const steps = STEPS.filter(([s]) => s !== 'separating' || job?.mode === 'accurate')
  const current = job ? steps.findIndex(([s]) => s === job.state) : -1
  const status = (i: number) => (job?.state === 'done' || i < current ? 'done' : i === current ? 'active' : 'pending')
  const finished = job !== null && FINAL.includes(job.state)

  return (
    <>
    <SiteNav />
    <main className="page">
      <p className="eyebrow">Analyzing</p>
      <h1>Listening to your song…</h1>
      {job && (
        <img src={`https://i.ytimg.com/vi/${job.video_id}/mqdefault.jpg`} alt="" width={320}
          style={{ borderRadius: 16, maxWidth: '100%' }} />
      )}
      <progress value={job?.progress ?? 0} max={100} aria-label="Analysis progress" />
      <ol className="steps">
        {steps.map(([state, label], i) => (
          <li key={state} data-status={status(i)}>{label}</li>
        ))}
      </ol>
      {job?.message && !finished && <p className="muted">{job.message}</p>}
      {job && !finished && (
        <button className="button" type="button" onClick={() => api.cancelJob(job.id).catch(() => undefined)}>
          Cancel
        </button>
      )}
      {job?.state === 'failed' && <p role="alert" className="error">{job.error ?? 'Analysis failed.'}</p>}
      {job?.state === 'cancelled' && <p>Analysis cancelled.</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {(finished || error) && job?.state !== 'done' && <p><Link to="/" className="button">Try another link</Link></p>}
    </main>
    </>
  )
}
