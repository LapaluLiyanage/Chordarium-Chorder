import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAudioPlayer } from './useAudioPlayer'

let audio: HTMLAudioElement

beforeEach(() => {
  audio = document.createElement('audio')
  audio.id = 'audio'
  audio.play = vi.fn(() => Promise.resolve())
  audio.pause = vi.fn()
  document.body.appendChild(audio)
})
afterEach(() => audio.remove())

describe('useAudioPlayer', () => {
  it('does nothing without a source', () => {
    const { result } = renderHook(() => useAudioPlayer('audio', null))
    result.current.play()
    expect(audio.play).not.toHaveBeenCalled()
  })

  it('reports ready and playing state from the element', () => {
    const { result } = renderHook(() => useAudioPlayer('audio', '/a.mp3'))
    act(() => { audio.dispatchEvent(new Event('loadedmetadata')) })
    expect(result.current.ready).toBe(true)
    act(() => { audio.dispatchEvent(new Event('play')) })
    expect(result.current.playing).toBe(true)
    act(() => { audio.dispatchEvent(new Event('ended')) })
    expect(result.current.playing).toBe(false)
  })

  it('seeks, sets the speed and plays through the element', () => {
    const { result } = renderHook(() => useAudioPlayer('audio', '/a.mp3'))
    act(() => result.current.seek(12.5))
    expect(audio.currentTime).toBe(12.5)
    expect(result.current.time).toBe(12.5)
    result.current.setRate(0.75)
    expect(audio.playbackRate).toBe(0.75)
    result.current.play()
    result.current.pause()
    expect(audio.play).toHaveBeenCalled()
    expect(audio.pause).toHaveBeenCalled()
  })
})
