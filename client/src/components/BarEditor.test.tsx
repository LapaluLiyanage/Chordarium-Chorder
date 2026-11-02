import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { barMidpoint, buildBars } from '../sheet'
import { TIMELINE } from '../test/fixtures'
import { BarEditor } from './BarEditor'

// bar 1 of the fixture song is 0-2s: one chord (Cm7) over four beats
const bars = buildBars(TIMELINE, TIMELINE.segments, { transpose: 0, capo: 0, simplify: false, tonic: 'G' })

function open(barIndex = 0, extra: Partial<Parameters<typeof BarEditor>[0]> = {}) {
  const onApply = vi.fn()
  const onClose = vi.fn()
  render(<BarEditor bar={bars[barIndex]} beats={TIMELINE.beats} segments={TIMELINE.segments} shift={0} tonic="G"
    onApply={onApply} onClose={onClose} {...extra} />)
  return { onApply, onClose }
}

describe('barMidpoint', () => {
  it('splits a bar on the middle beat', () => {
    expect(barMidpoint(bars[0], TIMELINE.beats)).toBe(1)
    expect(barMidpoint({ start: 0, end: 0.5 }, TIMELINE.beats)).toBeNull()
  })
})

describe('BarEditor', () => {
  it('applies the existing chord unchanged for a whole bar', async () => {
    const { onApply } = open()
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledWith([{ start: 0, end: 2, label: 'C:min7' }])
  })

  it('splits the bar in two and changes the second half', async () => {
    const user = userEvent.setup()
    const { onApply } = open()
    await user.click(screen.getByRole('button', { name: 'Split bar in two' }))
    await user.click(screen.getByRole('button', { name: 'Change chord 2' }))
    await user.click(screen.getByRole('button', { name: 'D' }))
    await user.click(screen.getByRole('button', { name: 'Apply' })) // the chord picker
    expect(onApply).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Apply' })) // the bar
    expect(onApply).toHaveBeenCalledTimes(1)
    const pieces = onApply.mock.calls[0][0]
    expect(pieces).toHaveLength(2)
    expect(pieces[0]).toEqual({ start: 0, end: 1, label: 'C:min7' })
    expect(pieces[1]).toMatchObject({ start: 1, end: 2 })
    expect(pieces[1].label.startsWith('D:')).toBe(true)
  })

  it('sets no chord for the bar', async () => {
    const user = userEvent.setup()
    const { onApply } = open()
    await user.click(screen.getByRole('button', { name: 'No chord' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledWith([{ start: 0, end: 2, label: 'N' }])
  })

  it('offers a new section only after the first bar', async () => {
    const onNewSection = vi.fn()
    const { unmount } = render(<BarEditor bar={bars[0]} beats={TIMELINE.beats} segments={TIMELINE.segments} shift={0}
      tonic="G" onApply={vi.fn()} onNewSection={onNewSection} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /new section/i })).toBeNull()
    unmount()
    render(<BarEditor bar={bars[1]} beats={TIMELINE.beats} segments={TIMELINE.segments} shift={0}
      tonic="G" onApply={vi.fn()} onNewSection={onNewSection} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /start a new section/i }))
    expect(onNewSection).toHaveBeenCalledWith(2)
  })
})
