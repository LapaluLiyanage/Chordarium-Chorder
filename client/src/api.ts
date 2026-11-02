import type { ExportRequest, Job, Song, SongSummary, Timeline } from './types'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  let message = res.statusText || `Request failed (${res.status})`
  try {
    const body = await res.json()
    if (body?.error) message = body.error
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(message, res.status)
}

/** The free API host sleeps when idle; while it wakes (up to a minute) its gateway answers with these. */
const WAKING_STATUSES = [429, 502, 503, 504]
export const WAKE_RETRY_MS = [3000, 5000, 8000, 12000, 15000, 20000]
const wakeListeners = new Set<(waking: boolean) => void>()

/** Be told when requests are waiting for the server to wake up (true) and when that is over (false). */
export function onWaking(listener: (waking: boolean) => void): () => void {
  wakeListeners.add(listener)
  return () => { wakeListeners.delete(listener) }
}

const isGatewayReply = (res: Response) =>
  WAKING_STATUSES.includes(res.status) && !(res.headers.get('Content-Type') ?? '').includes('application/json')

/** fetch, but a "server is waking up" reply (not one of the app's own JSON errors) is retried for about a minute. */
async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  let res = await fetch(input, init)
  for (let attempt = 0; isGatewayReply(res) && attempt < WAKE_RETRY_MS.length; attempt++) {
    wakeListeners.forEach((l) => l(true))
    await new Promise((resolve) => setTimeout(resolve, WAKE_RETRY_MS[attempt]))
    res = await fetch(input, init)
  }
  wakeListeners.forEach((l) => l(false))
  return res
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!res.ok) throw await toApiError(res)
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export type AnalyzeResponse = { job_id?: string; song_id?: string; cached?: boolean }

export const api = {
  analyze: (url: string, mode: 'fast' | 'accurate', refresh = false) =>
    request<AnalyzeResponse>('/analyze', { method: 'POST', body: JSON.stringify(refresh ? { url, mode, refresh } : { url, mode }) }),
  /** any audio or video file; the server converts it, so the format doesn't matter */
  upload: async (file: File, mode: 'fast' | 'accurate'): Promise<AnalyzeResponse> => {
    const form = new FormData()
    form.append('file', file)
    form.append('mode', mode)
    const res = await apiFetch('/api/upload', { method: 'POST', body: form })
    if (!res.ok) throw await toApiError(res)
    return res.json() as Promise<AnalyzeResponse>
  },
  songAudioUrl: (songId: string) => `/api/songs/${songId}/audio`,
  job: (id: string) => request<Job>(`/jobs/${id}`),
  cancelJob: (id: string) => request<{ cancelled: boolean }>(`/jobs/${id}/cancel`, { method: 'POST' }),
  songs: () => request<SongSummary[]>('/songs'),
  song: (id: string) => request<Song>(`/songs/${id}`),
  deleteSong: (songId: string) => request<void>(`/songs/${songId}`, { method: 'DELETE' }),
  exportSong: async (songId: string, timeline: Timeline, req: ExportRequest): Promise<Blob> => {
    const params = new URLSearchParams({
      fmt: req.fmt,
      transpose: String(req.transpose),
      capo: String(req.capo),
      simplify: req.simplify ? '1' : '0',
      bars_per_row: String(req.barsPerRow),
    })
    const res = await apiFetch(`/api/songs/${songId}/export?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeline }),
    })
    if (!res.ok) throw await toApiError(res)
    return res.blob()
  },
}

export function slugTitle(title: string): string {
  return title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'chordarium'
}
