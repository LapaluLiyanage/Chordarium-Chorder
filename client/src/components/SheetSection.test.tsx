import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SheetBar, SheetSection as SheetSectionData } from '../sheet'
import { SheetSection } from './SheetSection'

const bar = (index: number, chord: string): SheetBar => ({
  index, start: index * 2, end: index * 2 + 2, chords: [chord], lengths: [4], guess: false,
})
const sections: SheetSectionData[] = [
  { index: 0, name: 'Verse 1', color: '#ccc', start: 0, end: 4, bars: [bar(0, 'C'), bar(1, 'G')] },
]

function setup(over: Partial<React.ComponentProps<typeof SheetSection>> = {}) {
  const p = {
    title: 'Song', meta: '', sections, perRow: 4, onPerRow: vi.fn(), transpose: 0, onTranspose: vi.fn(),
    simplify: false, onSimplify: vi.fn(), playing: true, onTogglePlay: vi.fn(), currentBar: 1,
    onSeekBar: vi.fn(), loop: null, onLoop: vi.fn(), editMode: true, onToggleEdit: vi.fn(),
    onEditBar: vi.fn(), onEditSection: vi.fn(), ...over,
  }
  render(<SheetSection {...p} />)
  return p
}

describe('SheetSection editing', () => {
  it('still seeks when a bar is tapped in edit mode, so you can listen while correcting', async () => {
    const p = setup()
    await userEvent.setup().click(screen.getByRole('button', { name: /^Bar 1:/ }))
    expect(p.onSeekBar).toHaveBeenCalledWith(sections[0].bars[0])
    expect(p.onEditBar).not.toHaveBeenCalled()
  })

  it('edits the bar being played from the EDIT BAR button', async () => {
    const p = setup()
    await userEvent.setup().click(screen.getByRole('button', { name: 'EDIT BAR 2' }))
    expect(p.onEditBar).toHaveBeenCalledWith(sections[0].bars[1])
  })

  it('has no EDIT BAR button outside edit mode or before the first bar', () => {
    setup({ editMode: false })
    expect(screen.queryByRole('button', { name: /EDIT BAR/ })).toBeNull()
  })

  it('disables EDIT BAR when no bar is playing', () => {
    setup({ currentBar: -1 })
    expect(screen.getByRole('button', { name: 'EDIT BAR' })).toBeDisabled()
  })
})
