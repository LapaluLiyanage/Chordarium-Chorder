import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Segment } from '../types'
import { ChordEditor } from './ChordEditor'

const rootButton = (name: string) => within(screen.getByRole('group', { name: 'Root' })).getByRole('button', { name })

const seg: Segment = { start: 6, end: 8, label: 'D:7/3', alt: 'D:7', confidence: 0.4, bass: 'F#', edited: false }

describe('ChordEditor', () => {
  it('offers the model alternative and a simpler chord', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<ChordEditor segment={seg} shift={0} tonic="G" onApply={onApply} onClose={vi.fn()} />)
    expect(screen.getByRole('heading')).toHaveTextContent('D7/F#')
    const suggestions = screen.getByRole('group', { name: /suggestions/i })
    expect(suggestions).toHaveTextContent('D7')
    expect(suggestions).toHaveTextContent('D')
    await user.click(within(suggestions).getByRole('button', { name: 'D7' }))
    expect(onApply).toHaveBeenCalledWith('D:7', false)
  })

  it('saves manual picks in concert pitch', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    // transpose +2: D7/F# is displayed as E7/G#
    render(<ChordEditor segment={seg} shift={2} tonic="A" onApply={onApply} onClose={vi.fn()} />)
    expect(screen.getByRole('heading')).toHaveTextContent('E7/G#')
    expect(rootButton('E')).toHaveAttribute('aria-pressed', 'true')
    await user.selectOptions(screen.getByLabelText('Chord type'), 'maj7')
    await user.click(screen.getByRole('button', { name: /^apply$/i }))
    expect(onApply).toHaveBeenCalledWith('D:maj7/3', false)
  })

  it('picks a new root and bass', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<ChordEditor segment={seg} shift={0} tonic="G" onApply={onApply} onClose={vi.fn()} />)
    await user.click(rootButton('C'))
    await user.selectOptions(screen.getByLabelText('Chord type'), 'maj')
    await user.selectOptions(screen.getByLabelText('Bass'), '')
    await user.click(screen.getByRole('button', { name: /^apply$/i }))
    expect(onApply).toHaveBeenCalledWith('C:maj', false)
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<ChordEditor segment={seg} shift={0} tonic="G" onApply={vi.fn()} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('can mark no chord for every matching chord', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<ChordEditor segment={seg} shift={0} tonic="G" onApply={onApply} onClose={vi.fn()} />)
    await user.click(screen.getByLabelText(/apply to every matching chord/i))
    await user.click(screen.getByRole('button', { name: /no chord/i }))
    expect(onApply).toHaveBeenCalledWith('N', true)
  })

  it('filters out an unparseable model suggestion instead of crashing', () => {
    const bad: Segment = { ...seg, alt: 'H:maj' }
    render(<ChordEditor segment={bad} shift={0} tonic="G" onApply={vi.fn()} onClose={vi.fn()} />)
    const suggestions = within(screen.getByRole('group', { name: /suggestions/i }))
    expect(suggestions.getAllByRole('button')).toHaveLength(1)
    expect(suggestions.getByRole('button')).toHaveTextContent('D')
  })

  it('shows an error message when given one', () => {
    render(<ChordEditor segment={seg} shift={0} tonic="G" error="Unknown chord root: H" onApply={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Unknown chord root: H')
  })
})
