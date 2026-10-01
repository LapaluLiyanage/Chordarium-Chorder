import { Link } from 'react-router-dom'
import { Logo } from './Logo'

/** Top navigation. On the home page the anchors scroll to its sections; elsewhere it is a slim bar. */
export function SiteNav({ variant = 'bar' }: { variant?: 'hero' | 'bar' }) {
  if (variant === 'hero') {
    return (
      <nav className="site-nav hero-nav" aria-label="Main">
        <a href="#top" className="nav-home"><Logo size={20} />HOME</a>
        <a href="#intro">HOW IT WORKS</a>
        <a href="#tool">THE TOOL</a>
        <a href="#library">LIBRARY</a>
        <a href="#sheet">CHORD SHEET</a>
      </nav>
    )
  }
  return (
    <nav className="site-nav bar-nav" aria-label="Main">
      <Link to="/" className="nav-home"><Logo size={22} />CHORDARIUM</Link>
      <Link to="/#library">LIBRARY</Link>
    </nav>
  )
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>PASTE</span><span>PLAY</span>
      <Logo size={28} />
      <span>PRACTISE</span><span>REPEAT</span>
    </footer>
  )
}
