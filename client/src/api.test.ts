import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, onWaking, slugTitle } from './api'

function reply(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('api', () => {
  it('posts analyze requests as JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(202, { job_id: 'j1' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.analyze('https://youtu.be/x', 'accurate')).resolves.toEqual({ job_id: 'j1' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/analyze')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ url: 'https://youtu.be/x', mode: 'accurate' })
  })

  it('turns error responses into ApiError with the server message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(400, { error: 'Not a YouTube link' })))
    const err = await api.analyze('nope', 'fast').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.message).toBe('Not a YouTube link')
    expect(err.status).toBe(400)
  })

  it('returns undefined for 204 responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(204)))
    await expect(api.deleteSong('s1')).resolves.toBeUndefined()
  })

  it('posts the timeline and returns a blob for exports', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('pdf-bytes', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const timeline = { segments: [] } as unknown as import('./types').Timeline
    const result = await api.exportSong('s1', timeline, { fmt: 'chordpro', transpose: -2, capo: 3, simplify: true, barsPerRow: 8 })
    expect(await result.text()).toBe('pdf-bytes')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/songs/s1/export?fmt=chordpro&transpose=-2&capo=3&simplify=1&bars_per_row=8')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ timeline })
  })

  it('turns a failed export into an ApiError with the server message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(404, { error: 'Song not found' })))
    const err = await api.exportSong('s1', {} as unknown as import('./types').Timeline, { fmt: 'pdf', transpose: 0, capo: 0, simplify: false, barsPerRow: 4 }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.message).toBe('Song not found')
  })
})

describe('slugTitle', () => {
  it('replaces non-alphanumeric runs with a dash and trims the ends', () => {
    expect(slugTitle("Autumn Leaves (Live) - Cover!")).toBe('Autumn-Leaves-Live-Cover')
  })

  it('falls back to a default for an empty or all-punctuation title', () => {
    expect(slugTitle('')).toBe('chordarium')
    expect(slugTitle('!!!')).toBe('chordarium')
  })
})

describe('waking server', () => {
  const gateway = (status = 429) => new Response('Too Many Requests', { status, headers: { 'Content-Type': 'text/plain' } })

  it('retries a gateway reply until the server answers, and says so while it waits', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(gateway(429))
      .mockResolvedValueOnce(gateway(502))
      .mockResolvedValueOnce(reply(200, []))
    vi.stubGlobal('fetch', fetchMock)
    const seen: boolean[] = []
    const stop = onWaking((w) => seen.push(w))
    const pending = api.songs()
    await vi.advanceTimersByTimeAsync(20000)
    await expect(pending).resolves.toEqual([])
    stop()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(seen[0]).toBe(true)
    expect(seen[seen.length - 1]).toBe(false)
  })

  it("does not retry the app's own JSON errors, such as a full queue", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(429, { error: 'Lots of songs are being analyzed right now.' }))
    vi.stubGlobal('fetch', fetchMock)
    const err = await api.analyze('https://youtu.be/x', 'fast').catch((e) => e)
    expect(err.message).toBe('Lots of songs are being analyzed right now.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('gives up with the status after the last retry', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => gateway(429)))
    const pending = api.songs().catch((e) => e)
    await vi.advanceTimersByTimeAsync(120000)
    const err = await pending
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(429)
  })
})
