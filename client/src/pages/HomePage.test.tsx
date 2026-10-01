import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderAt } from '../test/router'
import { HomePage } from './HomePage'

vi.mock('../api', () => ({ api: { analyze: vi.fn(), songs: vi.fn() } }))
// a still demo clock keeps these tests fast and deterministic
vi.mock('../hooks/useDemoClock', () => ({ useDemoClock: () => ({ time: 0, playing: true, toggle: vi.fn(), seek: vi.fn() }) }))
import { api } from '../api'
const mocked = vi.mocked(api)

function renderHome() {
  return renderAt('/', (
    <>
      <Route path="/" element={<HomePage />} />
      <Route path="/jobs/:jobId" element={<p>JOB PAGE</p>} />
      <Route path="/songs/:songId" element={<p>SONG PAGE</p>} />
    </>
  ))
}

const song = (over: Partial<Parameters<typeof mocked.songs.mockResolvedValue>[0][number]> = {}) => ({
  id: 's1', video_id: 'abcdefghijk', title: 'Autumn Leaves', duration: 200, key: 'G:min', tempo: 124,
  created_at: '', updated_at: '', ...over,
})

beforeEach(() => {
  localStorage.clear()
  mocked.songs.mockResolvedValue([])
})

describe('HomePage hero', () => {
  it('starts a quick analysis and opens the job page', async () => {
    mocked.analyze.mockResolvedValue({ job_id: 'j1' })
    const user = userEvent.setup()
    renderHome()
    await user.type(screen.getByLabelText(/paste a youtube link/i), 'https://youtu.be/dQw4w9WgXcQ')
    await user.click(screen.getByRole('button', { name: /get chords/i }))
    expect(mocked.analyze).toHaveBeenCalledWith('https://youtu.be/dQw4w9WgXcQ', 'fast')
    expect(await screen.findByText('JOB PAGE')).toBeInTheDocument()
  })

  it('uses accurate mode when chosen and opens cached songs directly', async () => {
    mocked.analyze.mockResolvedValue({ song_id: 's9', cached: true })
    const user = userEvent.setup()
    renderHome()
    await user.click(screen.getByRole('radio', { name: /accurate/i }))
    await user.type(screen.getByLabelText(/paste a youtube link/i), 'https://youtu.be/dQw4w9WgXcQ')
    await user.click(screen.getByRole('button', { name: /get chords/i }))
    expect(mocked.analyze).toHaveBeenCalledWith('https://youtu.be/dQw4w9WgXcQ', 'accurate')
    expect(await screen.findByText('SONG PAGE')).toBeInTheDocument()
  })

  it('shows the server error message', async () => {
    mocked.analyze.mockRejectedValue(new Error("That doesn't look like a YouTube video link."))
    const user = userEvent.setup()
    renderHome()
    await user.type(screen.getByLabelText(/paste a youtube link/i), 'hello')
    await user.click(screen.getByRole('button', { name: /get chords/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent("doesn't look like a YouTube")
  })

  it('disables the button until a link is typed', () => {
    renderHome()
    expect(screen.getByRole('button', { name: /get chords/i })).toBeDisabled()
  })

  it('offers a sample song only when the library has one, and opens it', async () => {
    const user = userEvent.setup()
    mocked.songs.mockResolvedValue([song()])
    renderHome()
    await user.click(await screen.findByRole('button', { name: /try a sample song/i }))
    expect(await screen.findByText('SONG PAGE')).toBeInTheDocument()
  })

  it('has no sample button for an empty library', async () => {
    renderHome()
    await screen.findByText(/no songs yet/i)
    expect(screen.queryByRole('button', { name: /try a sample song/i })).toBeNull()
  })
})

describe('HomePage library', () => {
  it('lists songs with key, tempo and analysis quality', async () => {
    mocked.songs.mockResolvedValue([song({ accurate: true })])
    renderHome()
    const link = await screen.findByRole('link', { name: /autumn leaves/i })
    expect(link).toHaveAttribute('href', '/songs/s1')
    expect(within(link).getByText('Gm')).toBeInTheDocument()
    expect(within(link).getByText('ACCURATE')).toBeInTheDocument()
    expect(screen.getByText(/124 BPM/)).toBeInTheDocument()
  })

  it('shows an empty library message', async () => {
    renderHome()
    expect(await screen.findByText(/no songs yet/i)).toBeInTheDocument()
  })

  it('filters the library by title', async () => {
    mocked.songs.mockResolvedValue([song(), song({ id: 's2', title: 'Blue Bossa', key: 'C:min' })])
    const user = userEvent.setup()
    renderHome()
    await screen.findByRole('link', { name: /autumn leaves/i })
    await user.type(screen.getByLabelText(/search songs/i), 'blue')
    expect(screen.queryByRole('link', { name: /autumn leaves/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /blue bossa/i })).toBeInTheDocument()
  })

  it('shows a no-matches message when the filter matches nothing', async () => {
    mocked.songs.mockResolvedValue([song()])
    const user = userEvent.setup()
    renderHome()
    await screen.findByRole('link', { name: /autumn leaves/i })
    await user.type(screen.getByLabelText(/search songs/i), 'zzz')
    expect(await screen.findByText(/no songs match/i)).toBeInTheDocument()
  })

  it('filters by major or minor', async () => {
    mocked.songs.mockResolvedValue([song(), song({ id: 's2', title: 'Let It Be', key: 'C:maj' })])
    const user = userEvent.setup()
    renderHome()
    await screen.findByRole('link', { name: /let it be/i })
    await user.click(within(screen.getByRole('group', { name: /filter by mode/i })).getByRole('button', { name: 'MAJOR' }))
    expect(screen.queryByRole('link', { name: /autumn leaves/i })).toBeNull()
    expect(screen.getByRole('link', { name: /let it be/i })).toBeInTheDocument()
  })

  it('sorts by BPM', async () => {
    mocked.songs.mockResolvedValue([song({ tempo: 140 }), song({ id: 's2', title: 'Slow One', tempo: 60 })])
    const user = userEvent.setup()
    renderHome()
    await screen.findByRole('link', { name: /slow one/i })
    await user.click(within(screen.getByRole('group', { name: /sort songs/i })).getByRole('button', { name: 'BPM' }))
    const names = screen.getAllByRole('link').filter((l) => /autumn|slow/i.test(l.getAttribute('aria-label') ?? '')).map((l) => l.getAttribute('aria-label'))
    expect(names).toEqual(['Slow One', 'Autumn Leaves'])
  })

  it('remembers favourites and can show only them', async () => {
    mocked.songs.mockResolvedValue([song(), song({ id: 's2', title: 'Blue Bossa' })])
    const user = userEvent.setup()
    renderHome()
    await screen.findByRole('link', { name: /blue bossa/i })
    await user.click(screen.getByRole('button', { name: /add blue bossa to favourites/i }))
    expect(JSON.parse(localStorage.getItem('chordarium:favourites') ?? '[]')).toEqual(['s2'])
    await user.click(screen.getByRole('button', { name: '★ FAVOURITES' }))
    expect(screen.queryByRole('link', { name: /autumn leaves/i })).toBeNull()
    expect(screen.getByRole('link', { name: /blue bossa/i })).toBeInTheDocument()
  })

  it('offers to continue practising where you left off', async () => {
    localStorage.setItem('chordarium:progress:s1', JSON.stringify({ time: 84, section: 'Verse 2', fraction: 0.4, at: 1 }))
    localStorage.setItem('chordarium:progress-index', JSON.stringify(['s1']))
    mocked.songs.mockResolvedValue([song()])
    renderHome()
    expect(await screen.findByText('VERSE 2 · 1:24')).toBeInTheDocument()
  })
})

describe('HomePage sample sheet', () => {
  it('loops a section and transposes the sample', async () => {
    const user = userEvent.setup()
    renderHome()
    const loopButtons = screen.getAllByRole('button', { name: /verse 1 · loop/i })
    await user.click(loopButtons[0])
    expect(screen.getByRole('button', { name: /verse 1 · looping/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sheet transpose up' }))
    expect(screen.getByText('TRANSPOSE +1')).toBeInTheDocument()
  })
})
