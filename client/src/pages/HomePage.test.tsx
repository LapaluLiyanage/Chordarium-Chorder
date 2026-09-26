import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderAt } from '../test/router'
import { HomePage } from './HomePage'

vi.mock('../api', () => ({ api: { analyze: vi.fn(), songs: vi.fn() } }))
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

beforeEach(() => {
  mocked.songs.mockResolvedValue([])
})

describe('HomePage', () => {
  it('starts a fast analysis and opens the job page', async () => {
    mocked.analyze.mockResolvedValue({ job_id: 'j1' })
    const user = userEvent.setup()
    renderHome()
    await user.type(screen.getByLabelText(/youtube link/i), 'https://youtu.be/dQw4w9WgXcQ')
    await user.click(screen.getByRole('button', { name: /analyze/i }))
    expect(mocked.analyze).toHaveBeenCalledWith('https://youtu.be/dQw4w9WgXcQ', 'fast')
    expect(await screen.findByText('JOB PAGE')).toBeInTheDocument()
  })

  it('uses accurate mode when chosen and opens cached songs directly', async () => {
    mocked.analyze.mockResolvedValue({ song_id: 's9', cached: true })
    const user = userEvent.setup()
    renderHome()
    await user.click(screen.getByLabelText(/accurate/i))
    await user.type(screen.getByLabelText(/youtube link/i), 'https://youtu.be/dQw4w9WgXcQ')
    await user.click(screen.getByRole('button', { name: /analyze/i }))
    expect(mocked.analyze).toHaveBeenCalledWith('https://youtu.be/dQw4w9WgXcQ', 'accurate')
    expect(await screen.findByText('SONG PAGE')).toBeInTheDocument()
  })

  it('shows the server error message', async () => {
    mocked.analyze.mockRejectedValue(new Error("That doesn't look like a YouTube video link."))
    const user = userEvent.setup()
    renderHome()
    await user.type(screen.getByLabelText(/youtube link/i), 'hello')
    await user.click(screen.getByRole('button', { name: /analyze/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent("doesn't look like a YouTube")
  })

  it('lists recent songs or an empty state', async () => {
    mocked.songs.mockResolvedValue([{
      id: 's1', video_id: 'abcdefghijk', title: 'Autumn Leaves', duration: 200, key: 'G:min', tempo: 124,
      created_at: '', updated_at: '',
    }])
    renderHome()
    const link = await screen.findByRole('link', { name: /autumn leaves/i })
    expect(link).toHaveAttribute('href', '/songs/s1')
    expect(screen.getByText('G minor')).toBeInTheDocument()
    expect(screen.getByText(/124 BPM/)).toBeInTheDocument()
  })

  it('shows an empty library message', async () => {
    renderHome()
    expect(await screen.findByText(/no songs yet/i)).toBeInTheDocument()
  })

  it('filters the library by title', async () => {
    mocked.songs.mockResolvedValue([
      { id: 's1', video_id: 'a', title: 'Autumn Leaves', duration: 200, key: 'G:min', tempo: 124, created_at: '', updated_at: '' },
      { id: 's2', video_id: 'b', title: 'Blue Bossa', duration: 180, key: 'C:min', tempo: 130, created_at: '', updated_at: '' },
    ])
    const user = userEvent.setup()
    renderHome()
    await screen.findByRole('link', { name: /autumn leaves/i })
    await user.type(screen.getByLabelText(/search songs/i), 'blue')
    expect(screen.queryByRole('link', { name: /autumn leaves/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /blue bossa/i })).toBeInTheDocument()
  })

  it('shows a no-matches message when the filter matches nothing', async () => {
    mocked.songs.mockResolvedValue([{
      id: 's1', video_id: 'a', title: 'Autumn Leaves', duration: 200, key: 'G:min', tempo: 124, created_at: '', updated_at: '',
    }])
    const user = userEvent.setup()
    renderHome()
    await screen.findByRole('link', { name: /autumn leaves/i })
    await user.type(screen.getByLabelText(/search songs/i), 'zzz')
    expect(await screen.findByText(/no songs match/i)).toBeInTheDocument()
  })
})
