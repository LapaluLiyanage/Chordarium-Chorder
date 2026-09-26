import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VIEW } from '../hooks/useViewSettings'
import { TIMELINE } from '../test/fixtures'
import { ExportModal } from './ExportModal'

vi.mock('../api', () => ({
  exportSong: vi.fn(),
  slugTitle: (t: string) => t.replace(/[^A-Za-z0-9]+/g, '-'),
}))
import { exportSong } from '../api'
const mockedExport = vi.mocked(exportSong)

beforeEach(() => {
  vi.clearAllMocks()
  mockedExport.mockResolvedValue(new Blob(['bytes']))
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

describe('ExportModal', () => {
  it('downloads a PDF with the current view settings', async () => {
    const user = userEvent.setup()
    render(<ExportModal songId="s1" title="Test Song" timeline={TIMELINE} settings={{ ...DEFAULT_VIEW, transpose: 2, capo: 1 }} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() => expect(mockedExport).toHaveBeenCalledWith('s1', TIMELINE, {
      fmt: 'pdf', transpose: 2, capo: 1, simplify: false, barsPerRow: 4,
    }))
  })

  it('changes format, drops view settings, simplifies and widens rows', async () => {
    const user = userEvent.setup()
    render(<ExportModal songId="s1" title="Test Song" timeline={TIMELINE} settings={{ ...DEFAULT_VIEW, transpose: 2, capo: 1 }} onClose={vi.fn()} />)
    await user.click(screen.getByLabelText(/chordpro/i))
    await user.click(screen.getByLabelText(/apply current transpose/i))
    await user.click(screen.getByLabelText(/simplified chords/i))
    await user.selectOptions(screen.getByLabelText(/bars per row/i), '8')
    await user.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() => expect(mockedExport).toHaveBeenCalledWith('s1', TIMELINE, {
      fmt: 'chordpro', transpose: 0, capo: 0, simplify: true, barsPerRow: 8,
    }))
  })

  it('shows an error if the export request fails', async () => {
    mockedExport.mockRejectedValue(new Error('Song not found'))
    const user = userEvent.setup()
    render(<ExportModal songId="s1" title="Test Song" timeline={TIMELINE} settings={DEFAULT_VIEW} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /download/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Song not found')
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<ExportModal songId="s1" title="Test Song" timeline={TIMELINE} settings={DEFAULT_VIEW} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ExportModal songId="s1" title="Test Song" timeline={TIMELINE} settings={DEFAULT_VIEW} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
