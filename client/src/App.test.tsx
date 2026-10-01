import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { AppRoutes } from './App'

vi.mock('./api', () => ({ api: { analyze: vi.fn(), songs: vi.fn().mockResolvedValue([]) } }))

it('renders the wordmark and the paste field at /', async () => {
  render(<MemoryRouter initialEntries={['/']}><AppRoutes /></MemoryRouter>)
  expect(screen.getByRole('heading', { level: 1, name: 'Chordarium' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute('href', '#top')
  expect(screen.getByLabelText(/paste a youtube link/i)).toBeInTheDocument()
  expect(await screen.findByText(/no songs yet/i)).toBeInTheDocument()
})
