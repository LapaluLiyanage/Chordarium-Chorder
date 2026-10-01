import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Effects } from './components/Effects'
import { AnalyzingPage } from './pages/AnalyzingPage'
import { HomePage } from './pages/HomePage'
import { TrackerPage } from './pages/TrackerPage'

export function AppRoutes() {
  return (
    <>
      <Effects />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/jobs/:jobId" element={<AnalyzingPage />} />
        <Route path="/songs/:songId" element={<TrackerPage />} />
      </Routes>
    </>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
