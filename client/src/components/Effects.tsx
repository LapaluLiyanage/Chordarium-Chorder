import Lenis from 'lenis'
import { useEffect, useRef } from 'react'
import { ensureGsap, gsap, motionOK, ScrollTrigger } from '../motion'

const NOTES = ['♪', '♫', '♩', '♬']

/** Page-level motion from the design, done with GSAP: Lenis smooth scrolling, a scroll progress bar,
 * scroll-triggered reveals, a custom cursor that leaves music notes, magnetic buttons and card tilt.
 * Skipped entirely for reduced-motion users (and in tests). */
export function Effects() {
  const ring = useRef<HTMLDivElement>(null)
  const glyph = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)
  const progress = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!motionOK()) return
    ensureGsap()
    const root = document.documentElement
    const cleanups: (() => void)[] = []
    // everything scroll-driven lives in one context so cleanup restores the elements' styles
    // (React runs effects twice in development; a half-run reveal must not become the "end" state)
    const ctx = gsap.context(() => {})

    // smooth scrolling, driven by GSAP's ticker so ScrollTrigger stays in sync
    const lenis = new Lenis({ duration: 1.15, easing: (t) => Math.min(1, 1.001 - 2 ** (-10 * t)), smoothWheel: true })
    lenis.on('scroll', ScrollTrigger.update)
    const raf = (t: number) => lenis.raf(t * 1000)
    gsap.ticker.add(raf)
    gsap.ticker.lagSmoothing(0)
    const onAnchor = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest<HTMLAnchorElement>('a[href^="#"]')
      if (!a) return
      const id = a.getAttribute('href') ?? ''
      const target: HTMLElement | 0 | null = id === '#top' ? 0 : document.querySelector<HTMLElement>(id)
      if (target === null) return
      e.preventDefault()
      lenis.scrollTo(target, { offset: -12, duration: 1.4 })
    }
    document.addEventListener('click', onAnchor)
    cleanups.push(() => {
      document.removeEventListener('click', onAnchor)
      gsap.ticker.remove(raf)
      lenis.destroy()
    })

    // scroll progress bar
    ctx.add(() => {
      gsap.set(progress.current, { scaleX: 0 })
      gsap.to(progress.current, { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.3 } })
    })

    // reveal every [data-reveal] block once as it scrolls into view (also ones added later)
    const seen = new WeakSet<Element>()
    const bindReveals = () => {
      document.querySelectorAll('[data-reveal]').forEach((el) => {
        if (seen.has(el)) return
        seen.add(el)
        ctx.add(() => gsap.from(el, { y: 60, opacity: 0, duration: 0.9, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 92%', once: true } }))
      })
    }
    bindReveals()
    const mo = new MutationObserver(bindReveals)
    mo.observe(document.body, { childList: true, subtree: true })
    cleanups.push(() => mo.disconnect())

    // magnetic buttons and tilting cards, by event delegation so React re-renders never lose them
    let mag: HTMLElement | null = null
    let tilt: HTMLElement | null = null
    const onFx = (e: PointerEvent) => {
      const target = e.target as Element | null
      const nextMag = target?.closest<HTMLElement>('[data-mag]') ?? null
      if (mag && mag !== nextMag) gsap.to(mag, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1,.4)' })
      mag = nextMag
      if (mag) {
        const r = mag.getBoundingClientRect()
        gsap.to(mag, { x: (e.clientX - r.left - r.width / 2) * 0.3, y: (e.clientY - r.top - r.height / 2) * 0.4, duration: 0.3 })
      }
      const nextTilt = target?.closest<HTMLElement>('[data-tilt]') ?? null
      if (tilt && tilt !== nextTilt) gsap.to(tilt, { rotationX: 0, rotationY: 0, y: 0, duration: 0.6, ease: 'power3.out' })
      tilt = nextTilt
      if (tilt) {
        const r = tilt.getBoundingClientRect()
        const dx = (e.clientX - r.left) / r.width - 0.5
        const dy = (e.clientY - r.top) / r.height - 0.5
        gsap.to(tilt, { rotationY: dx * 12, rotationX: -dy * 12, y: -4, transformPerspective: 700, duration: 0.35 })
      }
    }
    document.addEventListener('pointermove', onFx)
    cleanups.push(() => document.removeEventListener('pointermove', onFx))

    // custom cursor: a lagging ring, a dot, and a trail of music notes
    if (window.matchMedia('(pointer: fine)').matches && ring.current && glyph.current && label.current) {
      root.classList.add('cc-on')
      const [r, g, lab] = [ring.current, glyph.current, label.current]
      // the music note sits exactly on the pointer; the ring trails behind it with a floaty lag
      const rx = gsap.quickTo(r, 'x', { duration: 0.45, ease: 'power3' })
      const ry = gsap.quickTo(r, 'y', { duration: 0.45, ease: 'power3' })
      const gx = gsap.quickTo(g, 'x', { duration: 0.08 })
      const gy = gsap.quickTo(g, 'y', { duration: 0.08 })
      let mode = ''
      let lastNote = 0
      let lx = 0
      let ly = 0
      const spawn = (x: number, y: number, big: boolean) => {
        const n = document.createElement('span')
        n.textContent = NOTES[Math.floor(Math.random() * NOTES.length)]
        n.className = 'cc-note'
        n.style.fontSize = `${big ? 22 : 15}px`
        document.body.appendChild(n)
        gsap.fromTo(n,
          { x: x - 6, y: y - 10, opacity: 0.9, rotation: gsap.utils.random(-25, 25), scale: 0.6 },
          { x: x + gsap.utils.random(-30, 30), y: y - gsap.utils.random(40, 80), opacity: 0, scale: 1.1, rotation: gsap.utils.random(-40, 40),
            duration: gsap.utils.random(0.9, 1.4), ease: 'power2.out', onComplete: () => n.remove() })
      }
      const onMove = (e: MouseEvent) => {
        rx(e.clientX); ry(e.clientY); gx(e.clientX); gy(e.clientY)
        const now = performance.now()
        if (now - lastNote > 110 && Math.hypot(e.clientX - lx, e.clientY - ly) > 40) {
          lastNote = now; lx = e.clientX; ly = e.clientY
          spawn(e.clientX, e.clientY, false)
        }
        const t = e.target as Element | null
        const m = t?.closest('canvas') ? 'drag' : t?.closest('input') ? 'text' : t?.closest('a, button, [data-tilt]') ? 'link' : ''
        if (m === mode) return
        mode = m
        gsap.to(r, { scale: m === 'drag' ? 1.9 : m === 'link' ? 1.5 : m === 'text' ? 0.6 : 1, backgroundColor: m === 'link' ? 'rgba(251,245,234,1)' : 'rgba(251,245,234,0)', duration: 0.3, ease: 'power3.out' })
        gsap.to(g, { scale: m === 'link' ? 0.8 : m === 'drag' ? 0 : m === 'text' ? 0.6 : 1, rotation: m === 'link' ? -18 : 0, duration: 0.3, ease: 'back.out(2)' })
        lab.textContent = m === 'drag' ? 'DRAG' : ''
        gsap.to(lab, { opacity: m === 'drag' ? 1 : 0, duration: 0.2 })
      }
      const onDown = (e: MouseEvent) => {
        gsap.to(r, { scale: '-=.25', duration: 0.12, yoyo: true, repeat: 1 })
        for (let i = 0; i < 3; i++) setTimeout(() => spawn(e.clientX, e.clientY, true), i * 60)
      }
      const hide = () => gsap.to([r, g], { opacity: 0, duration: 0.2 })
      const show = () => gsap.to([r, g], { opacity: 1, duration: 0.2 })
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mousedown', onDown)
      document.addEventListener('mouseleave', hide)
      document.addEventListener('mouseenter', show)
      cleanups.push(() => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mousedown', onDown)
        document.removeEventListener('mouseleave', hide)
        document.removeEventListener('mouseenter', show)
        root.classList.remove('cc-on')
      })
    }

    const refresh = setTimeout(() => ScrollTrigger.refresh(), 600)
    return () => {
      clearTimeout(refresh)
      cleanups.forEach((fn) => fn())
      ctx.revert()
    }
  }, [])

  return (
    <>
      <div className="scroll-progress" ref={progress} aria-hidden="true" />
      <div className="cc-cur cc-ring" ref={ring} aria-hidden="true"><span ref={label} /></div>
      <div className="cc-cur cc-glyph" ref={glyph} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><ellipse cx="9" cy="18" rx="4.6" ry="3.6" transform="rotate(-22 9 18)" /><rect x="12.4" y="3" width="2.2" height="15.5" rx="1" /><path d="M14.6 3c0 3 5.4 4.2 5.4 8.6 0 1.6-.6 2.8-1.4 3.6.4-1 .5-2 .1-3.1-.9-2.4-4.1-3-4.1-3z" /></svg>
      </div>
    </>
  )
}
