import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AudioDeck } from './AudioDeck'

function renderDeck(over: Partial<Parameters<typeof AudioDeck>[0]> = {}) {
  const props = { audioId: 'a', src: '/a.mp3', title: 'Test Song', artist: 'Someone', time: 30, duration: 120,
    playing: false, onToggle: vi.fn(), onSeek: vi.fn(), ...over }
  render(<AudioDeck {...props} />)
  return props
}

describe('AudioDeck', () => {
  it('shows the song, times and a play button that toggles', async () => {
    const props = renderDeck()
    expect(screen.getByText('Test Song')).toBeInTheDocument()
    expect(screen.getByText('Someone')).toBeInTheDocument()
    expect(screen.getByText('0:30')).toBeInTheDocument()
    expect(screen.getByText('2:00')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(props.onToggle).toHaveBeenCalled()
  })

  it('labels the button Pause while playing and seeks from the bar', () => {
    const props = renderDeck({ playing: true })
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '45' } })
    expect(props.onSeek).toHaveBeenCalledWith(45)
  })

  it('sets volume and mute on the audio element', async () => {
    renderDeck()
    const audio = document.getElementById('a') as HTMLAudioElement
    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.5' } })
    expect(audio.volume).toBe(0.5)
    await userEvent.click(screen.getByRole('button', { name: 'Mute' }))
    expect(audio.muted).toBe(true)
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeInTheDocument()
  })
})
