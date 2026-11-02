import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TIMELINE } from '../test/fixtures'
import { useChordOverrides } from './useChordOverrides'

afterEach(() => vi.restoreAllMocks())

describe('useChordOverrides', () => {
  it('starts with the canonical segments unedited', () => {
    const { result } = renderHook(() => useChordOverrides('s1', TIMELINE.segments))
    expect(result.current.segments).toEqual(TIMELINE.segments)
  })

  it('applies a single edit without touching other segments', () => {
    const { result } = renderHook(() => useChordOverrides('s2', TIMELINE.segments))
    act(() => result.current.editChord(0, 'C:min', false))
    expect(result.current.segments[0]).toMatchObject({ label: 'C:min', bass: 'C', edited: true })
    expect(result.current.segments[1]).toEqual(TIMELINE.segments[1])
  })

  it('applies to every segment with a matching label', () => {
    const segments = TIMELINE.segments.map((s, i) => (i === 3 ? { ...s, label: 'C:min7' } : s))
    const { result } = renderHook(() => useChordOverrides('s3', segments))
    act(() => result.current.editChord(0, 'N', true))
    expect(result.current.segments[0].label).toBe('N')
    expect(result.current.segments[3].label).toBe('N')
    expect(result.current.segments[0].bass).toBeNull()
  })

  it('persists edits per song across remounts, independently per song', () => {
    const { result, unmount } = renderHook(() => useChordOverrides('s4', TIMELINE.segments))
    act(() => result.current.editChord(1, 'G:maj', false))
    unmount()
    const again = renderHook(() => useChordOverrides('s4', TIMELINE.segments))
    expect(again.result.current.segments[1]).toMatchObject({ label: 'G:maj' })
    const other = renderHook(() => useChordOverrides('s5', TIMELINE.segments))
    expect(other.result.current.segments[1]).toEqual(TIMELINE.segments[1])
  })

  it('reset clears all overrides and storage', () => {
    const { result } = renderHook(() => useChordOverrides('s6', TIMELINE.segments))
    act(() => result.current.editChord(0, 'C:min', false))
    act(() => result.current.reset())
    expect(result.current.segments).toEqual(TIMELINE.segments)
    expect(localStorage.getItem('chordarium:edits:s6')).toBeNull()
  })

  it('throws for an invalid label, leaving segments unchanged', () => {
    const { result } = renderHook(() => useChordOverrides('s7', TIMELINE.segments))
    expect(() => act(() => result.current.editChord(0, 'H:maj', false))).toThrow()
    expect(result.current.segments).toEqual(TIMELINE.segments)
  })

  it('works when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const { result } = renderHook(() => useChordOverrides('s8', TIMELINE.segments))
    act(() => result.current.editChord(0, 'C:min', false))
    expect(result.current.segments[0].label).toBe('C:min')
  })

  it('sets chords for a bar split in two, cutting the segment it lands in', () => {
    const { result } = renderHook(() => useChordOverrides('s9', TIMELINE.segments))
    const first = TIMELINE.segments[0]
    const mid = (first.start + first.end) / 2
    act(() => result.current.editRanges([
      { start: first.start, end: mid, label: 'G:maj' },
      { start: mid, end: first.end, label: 'D:maj' },
    ]))
    const [a, b, c] = result.current.segments
    expect([a.label, b.label, c]).toEqual(['G:maj', 'D:maj', TIMELINE.segments[1]])
    expect([a.start, a.end, b.start, b.end]).toEqual([first.start, mid, mid, first.end])
  })

  it('keeps edits made before bars could be split', () => {
    localStorage.setItem('chordarium:edits:s10', JSON.stringify({ 1: { label: 'G:maj', bass: 'G' } }))
    const { result } = renderHook(() => useChordOverrides('s10', TIMELINE.segments))
    expect(result.current.segments[1]).toMatchObject({ label: 'G:maj', bass: 'G', edited: true })
  })
})
