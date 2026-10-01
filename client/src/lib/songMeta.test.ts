import { describe, expect, it } from 'vitest'
import { formatClock, isMinorKey, keyShort, keyTint, splitTitle } from './songMeta'

describe('splitTitle', () => {
  it('splits artist and song and drops video noise', () => {
    expect(splitTitle('Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)'))
      .toEqual({ artist: 'Rick Astley', title: 'Never Gonna Give You Up' })
  })
  it('keeps titles with no artist separator whole', () => {
    expect(splitTitle('Wala Athula')).toEqual({ artist: null, title: 'Wala Athula' })
  })
  it('drops a trailing channel after a pipe', () => {
    expect(splitTitle('Sparsha | Naada').title).toBe('Sparsha')
  })
})

describe('key helpers', () => {
  it('shortens keys', () => {
    expect(keyShort('G:min')).toBe('Gm')
    expect(keyShort('C:maj')).toBe('C')
    expect(keyShort('A#:maj')).toBe('Bb')
  })
  it('knows minor keys and gives each tonic a stable tint', () => {
    expect(isMinorKey('E:min')).toBe(true)
    expect(isMinorKey('E:maj')).toBe(false)
    expect(keyTint('G:min')).toBe(keyTint('G:maj'))
    expect(keyTint('C:maj')).not.toBe(keyTint('D:maj'))
  })
})

describe('formatClock', () => {
  it('formats m:ss', () => {
    expect(formatClock(342)).toBe('5:42')
    expect(formatClock(59.6)).toBe('1:00')
  })
})
