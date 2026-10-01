import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

export { gsap, ScrollTrigger }

let registered = false

/** Register GSAP plugins once. */
export function ensureGsap(): void {
  if (registered) return
  gsap.registerPlugin(ScrollTrigger)
  registered = true
}

/** Animations run only in a real browser that has not asked for reduced motion (never in tests). */
export function motionOK(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The chord "flips up" into place whenever it changes. */
export function flipIn(el: Element | null): void {
  if (!el || !motionOK()) return
  gsap.fromTo(
    el,
    { yPercent: 35, opacity: 0, rotateX: -70, transformPerspective: 600 },
    { yPercent: 0, opacity: 1, rotateX: 0, duration: 0.5, ease: 'back.out(2)', overwrite: true },
  )
}
