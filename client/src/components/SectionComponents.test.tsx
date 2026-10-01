import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SECTIONS, TIMELINE } from '../test/fixtures'
import { AccuracyNotice } from './AccuracyNotice'
import { ChordLane } from './ChordLane'
import { ReanalyzeBar } from './ReanalyzeBar'
import { SectionEditor } from './SectionEditor'

const symbols = ['Cm7', 'F7', 'Bbmaj7', 'Ebmaj7', 'D7/F#']

function lane(props: Partial<Parameters<typeof ChordLane>[0]> = {}) {
  const onSeek = vi.fn()
  const onEditSection = vi.fn()
  render(
    <ChordLane segments={TIMELINE.segments} sections={SECTIONS} symbols={symbols} beats={TIMELINE.beats}
      downbeats={TIMELINE.downbeats} duration={TIMELINE.duration} time={2.5} width={800} editMode={false}
      onSeek={onSeek} onEdit={vi.fn()} onEditSection={onEditSection} {...props} />,
  )
  return { onSeek, onEditSection }
}

describe('ChordLane sections', () => {
  it('labels each section and marks automatic guesses with a ?', () => {
    lane()
    expect(screen.getByRole('button', { name: /^Intro/ })).toHaveAttribute('data-kind', 'intro')
    const chorus = screen.getByRole('button', { name: /^Chorus\?/ })
    expect(chorus).toHaveClass('guess')
    expect(chorus).toHaveAttribute('data-kind', 'chorus')
  })

  it('jumps to a section on click', async () => {
    const user = userEvent.setup()
    const { onSeek } = lane()
    await user.click(screen.getByRole('button', { name: /^Chorus/ }))
    expect(onSeek).toHaveBeenCalledWith(4)
  })

  it('opens the section editor in edit mode', async () => {
    const user = userEvent.setup()
    const { onSeek, onEditSection } = lane({ editMode: true })
    await user.click(screen.getByRole('button', { name: /^Chorus/ }))
    expect(onEditSection).toHaveBeenCalledWith(1)
    expect(onSeek).not.toHaveBeenCalled()
  })

  it('draws the bass note of a slash chord in its own element', () => {
    lane()
    expect(screen.getByRole('button', { name: 'D7/F#' }).querySelector('.cs-bass')).toHaveTextContent('/F#')
  })
})

describe('SectionEditor', () => {
  it('renames and moves a section start to a chosen bar', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<SectionEditor section={SECTIONS[1]} index={1} downbeats={[0, 2, 4, 6]} onApply={onApply} onClose={vi.fn()} />)
    await user.clear(screen.getByLabelText('Section name'))
    await user.type(screen.getByLabelText('Section name'), 'Bridge')
    await user.selectOptions(screen.getByLabelText('Section start'), '6')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledWith({ label: 'Bridge', start: 6 })
  })

  it('offers common names and keeps the first section anchored to the start', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<SectionEditor section={SECTIONS[0]} index={0} downbeats={[0, 2, 4, 6]} onApply={onApply} onClose={vi.fn()} />)
    expect(screen.queryByLabelText('Section start')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Verse' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledWith({ label: 'Verse' })
  })
})

describe('AccuracyNotice', () => {
  beforeEach(() => localStorage.clear())

  it('explains that detection can be wrong, once', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<AccuracyNotice />)
    expect(screen.getByRole('note', { name: /accuracy/i })).toHaveTextContent(/detected automatically/i)
    await user.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByRole('note')).toBeNull()
    unmount()
    render(<AccuracyNotice />)
    expect(screen.queryByRole('note')).toBeNull()
  })
})

describe('ReanalyzeBar', () => {
  it('is hidden for an accurate analysis that has sections', () => {
    const { container } = render(<ReanalyzeBar hasSections separated busy={false} onReanalyze={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('offers accurate mode after a quick analysis', async () => {
    const user = userEvent.setup()
    const onReanalyze = vi.fn()
    render(<ReanalyzeBar hasSections separated={false} busy={false} onReanalyze={onReanalyze} />)
    await user.click(screen.getByRole('button', { name: /accurate mode/i }))
    expect(onReanalyze).toHaveBeenCalledWith('accurate')
  })

  it('adds sections to an older song in the mode it was analyzed with', async () => {
    const user = userEvent.setup()
    const onReanalyze = vi.fn()
    const { rerender } = render(<ReanalyzeBar hasSections={false} separated={false} busy={false} onReanalyze={onReanalyze} />)
    await user.click(screen.getByRole('button', { name: 'Detect sections' }))
    expect(onReanalyze).toHaveBeenLastCalledWith('fast')
    rerender(<ReanalyzeBar hasSections={false} separated busy={false} onReanalyze={onReanalyze} />)
    await user.click(screen.getByRole('button', { name: 'Detect sections' }))
    expect(onReanalyze).toHaveBeenLastCalledWith('accurate')
  })
})
