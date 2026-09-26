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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!res.ok) throw await toApiError(res)
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export type AnalyzeResponse = { job_id?: string; song_id?: string; cached?: boolean }

export const api = {
  analyze: (url: string, mode: 'fast' | 'accurate') =>
    request<AnalyzeResponse>('/analyze', { method: 'POST', body: JSON.stringify({ url, mode }) }),
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
    const res = await fetch(`/api/songs/${songId}/export?${params.toString()}`, {
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
