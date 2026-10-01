import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SECTIONS, makeSong } from '../test/fixtures'
import { renderAt } from '../test/router'
import { TrackerPage } from './TrackerPage'

const player = vi.hoisted(() => ({ ready: true, time: 1.0, playing: false, seek: vi.fn(), setRate: vi.fn() }))
vi.mock('../hooks/useYouTubePlayer', () => ({ useYouTubePlayer: () => player }))
vi.mock('../api', () => ({ api: { song: vi.fn(), analyze: vi.fn() } }))
import { api } from '../api'
const mocked = vi.mocked(api)

function renderTracker() {
  return renderAt('/songs/s1', <Route path="/songs/:songId" element={<TrackerPage />} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  player.time = 1.0
  mocked.song.mockResolvedValue(makeSong())
})

describe('TrackerPage', () => {
  it('shows the song header and the chord at the playhead', async () => {
    renderTracker()
    expect(await screen.findByRole('heading', { name: 'Test Song' })).toBeInTheDocument()
    expect(screen.getByText('G minor')).toBeInTheDocument()
    expect(screen.getByTestId('current-chord')).toHaveTextContent('Cm7')
    expect(screen.getByTestId('next-chord')).toHaveTextContent('F7')
    expect(screen.getByLabelText('2 beats to next chord')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Piano keys for Cm7' })).toBeInTheDocument()
  })

  it('re-spells chords when transposing', async () => {
    const user = userEvent.setup()
    renderTracker()
    await screen.findByTestId('current-chord')
    await user.click(screen.getByRole('button', { name: 'Transpose up' }))
    expect(screen.getByTestId('current-chord')).toHaveTextContent('C#m7')
    expect(screen.getByText('G# minor')).toBeInTheDocument()
  })

  it('marks the hero chord low-confidence under the spec 70% threshold, not just 50%', async () => {
    const song = makeSong()
    song.timeline.segments[0] = { ...song.timeline.segments[0], confidence: 0.65 }
    mocked.song.mockResolvedValue(song)
    renderTracker()
    const current = await screen.findByTestId('current-chord')
    expect(current.querySelector('.cs')).toHaveClass('low-confidence')
  })

  it('edits a chord through the editor', async () => {
    const user = userEvent.setup()
    renderTracker()
    await screen.findByTestId('current-chord')
    await user.click(screen.getByRole('button', { name: /edit chords/i }))
    await user.click(screen.getByRole('button', { name: 'F7' }))
    await user.click(within(screen.getByRole('group', { name: /suggestions/i })).getByRole('button', { name: 'F' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /edit chord/i })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'F' })).toHaveClass('edited')
  })

  it('keeps an edit after re-rendering and clears it on reset', async () => {
    const user = userEvent.setup()
    renderTracker()
    await screen.findByTestId('current-chord')
    await user.click(screen.getByRole('button', { name: /edit chords/i }))
    await user.click(screen.getByRole('button', { name: 'F7' }))
    await user.click(within(screen.getByRole('group', { name: /suggestions/i })).getByRole('button', { name: 'F' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'F' })).toHaveClass('edited'))
    await user.click(screen.getByRole('button', { name: /reset edits/i }))
    expect(screen.getByRole('button', { name: 'F7' })).not.toHaveClass('edited')
  })

  it('loops between A and B', async () => {
    const user = userEvent.setup()
    const view = renderTracker()
    await screen.findByTestId('current-chord')
    player.time = 0.5
    view.rerender(view.ui())
    await user.click(screen.getByRole('button', { name: /set a/i }))
    player.time = 2.4
    view.rerender(view.ui())
    await user.click(screen.getByRole('button', { name: /set b/i }))
    expect(player.seek).not.toHaveBeenCalled()
    player.time = 2.6
    view.rerender(view.ui())
    await waitFor(() => expect(player.seek).toHaveBeenCalledWith(0.5))
  })

  it('shows analysis warnings', async () => {
    mocked.song.mockResolvedValue(makeSong({ warnings: ['BTC model weights not found.'] }))
    renderTracker()
    expect(await screen.findByRole('status', { name: /analysis warnings/i })).toHaveTextContent('BTC model weights not found.')
  })

  it('shows the section at the playhead and the one-time accuracy notice', async () => {
    mocked.song.mockResolvedValue(makeSong({ sections: SECTIONS }))
    renderTracker()
    expect(await screen.findByLabelText('Current section')).toHaveTextContent('Intro')
    expect(screen.getByRole('note', { name: /accuracy/i })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: /improve this analysis/i })).toBeNull()
  })

  it('offers to detect sections for songs analyzed before sections existed', async () => {
    const user = userEvent.setup()
    mocked.analyze.mockResolvedValue({ job_id: 'j9' })
    renderTracker()
    await screen.findByTestId('current-chord')
    await user.click(screen.getByRole('button', { name: 'Detect sections' }))
    expect(mocked.analyze).toHaveBeenCalledWith('https://www.youtube.com/watch?v=abcdefghijk', 'accurate', true)
  })

  it('hides bass notes when the toggle is off', async () => {
    const user = userEvent.setup()
    renderTracker()
    await screen.findByTestId('current-chord')
    await user.click(screen.getByRole('checkbox', { name: 'Show bass notes' }))
    expect(document.querySelector('main.hide-bass')).not.toBeNull()
  })

  it('shows an error for unknown songs', async () => {
    mocked.song.mockRejectedValue(new Error('Song not found'))
    renderTracker()
    expect(await screen.findByRole('alert')).toHaveTextContent('Song not found')
  })
})
