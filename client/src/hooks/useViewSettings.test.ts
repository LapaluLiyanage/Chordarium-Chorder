import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VIEW, normalizeView, useViewSettings } from './useViewSettings'

afterEach(() => vi.restoreAllMocks())

describe('normalizeView', () => {
  it('clamps ranges and snaps speed', () => {
    expect(normalizeView({ transpose: 9, capo: -1, rate: 3 })).toEqual({ ...DEFAULT_VIEW, transpose: 6, capo: 0, rate: 1 })
    expect(normalizeView({ transpose: -8, capo: 12, rate: 0.75, simplify: true, showBass: true }))
      .toEqual({ transpose: -6, capo: 7, rate: 0.75, simplify: true, showBass: true })
  })
})

describe('useViewSettings', () => {
  it('starts with defaults and persists changes per song', () => {
    const { result, unmount } = renderHook(() => useViewSettings('s1'))
    expect(result.current[0]).toEqual(DEFAULT_VIEW)
    act(() => result.current[1]({ transpose: 2, capo: 1 }))
    expect(result.current[0]).toMatchObject({ transpose: 2, capo: 1 })
    unmount()
    expect(renderHook(() => useViewSettings('s1')).result.current[0]).toMatchObject({ transpose: 2, capo: 1 })
    expect(renderHook(() => useViewSettings('s2')).result.current[0]).toEqual(DEFAULT_VIEW)
  })

  it('works when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const { result } = renderHook(() => useViewSettings('s1'))
    act(() => result.current[1]({ transpose: 3 }))
    expect(result.current[0].transpose).toBe(3)
  })
})
