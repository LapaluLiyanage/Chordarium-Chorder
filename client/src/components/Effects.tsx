import { useEffect, useRef } from 'react'

const matches = (query: string) => typeof window.matchMedia === 'function' && window.matchMedia(query).matches

/** Page-level polish from the design: scroll progress bar, reveal-on-scroll, a custom cursor,
 * magnetic buttons and card tilt. Everything is skipped for reduced-motion and touch users. */
export function Effects() {
  const ring = useRef<HTMLDivElement>(null)
  const dot = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)
  const progress = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const reduced = matches('(prefers-reduced-motion: reduce)')
    const root = document.documentElement
    const cleanups: (() => void)[] = []

    const onScroll = () => {
      const max = root.scrollHeight - window.innerHeight
      if (progress.current) progress.current.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    cleanups.push(() => window.removeEventListener('scroll', onScroll))

    if (!reduced && typeof IntersectionObserver !== 'undefined') {
      root.classList.add('js-reveal')
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) }
      }, { threshold: 0.12 })
      const watch = () => document.querySelectorAll('[data-reveal]:not(.in)').forEach((el) => io.observe(el))
      watch()
      const mo = new MutationObserver(watch)
      mo.observe(document.body, { childList: true, subtree: true })
      cleanups.push(() => { io.disconnect(); mo.disconnect(); root.classList.remove('js-reveal') })
    }

    if (!reduced && matches('(pointer: fine)')) {
      root.classList.add('cc-on')
      let tx = -100, ty = -100, rx = -100, ry = -100, frame = 0
      const tick = () => {
        rx += (tx - rx) * 0.2
        ry += (ty - ry) * 0.2
        if (ring.current) ring.current.style.transform = `translate(${rx}px, ${ry}px)`
        if (dot.current) dot.current.style.transform = `translate(${tx}px, ${ty}px)`
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)

      const move = (e: PointerEvent) => {
        tx = e.clientX
        ty = e.clientY
        const target = e.target as Element | null
        const hot = target?.closest('a, button, input, select, [data-cursor]')
        ring.current?.classList.toggle('hot', !!hot)
        const text = target?.closest('[data-cursor]')?.getAttribute('data-cursor') ?? ''
        if (label.current) { label.current.textContent = text; label.current.style.opacity = text ? '1' : '0' }

        const mag = target?.closest<HTMLElement>('[data-mag]')
        document.querySelectorAll<HTMLElement>('[data-mag]').forEach((el) => {
          if (el !== mag) el.style.transform = ''
        })
        if (mag) {
          const r = mag.getBoundingClientRect()
          mag.style.transform = `translate(${(e.clientX - (r.left + r.width / 2)) * 0.25}px, ${(e.clientY - (r.top + r.height / 2)) * 0.35}px)`
        }
        const tilt = target?.closest<HTMLElement>('[data-tilt]')
        document.querySelectorAll<HTMLElement>('[data-tilt]').forEach((el) => {
          if (el !== tilt) el.style.transform = ''
        })
        if (tilt) {
          const r = tilt.getBoundingClientRect()
          const px = (e.clientX - r.left) / r.width - 0.5
          const py = (e.clientY - r.top) / r.height - 0.5
          tilt.style.transform = `perspective(700px) rotateX(${(-py * 7).toFixed(2)}deg) rotateY(${(px * 7).toFixed(2)}deg) translateY(-3px)`
        }
      }
      document.addEventListener('pointermove', move)
      cleanups.push(() => {
        document.removeEventListener('pointermove', move)
        cancelAnimationFrame(frame)
        root.classList.remove('cc-on')
      })
    }
    return () => cleanups.forEach((fn) => fn())
  }, [])

  return (
    <>
      <div className="scroll-progress" ref={progress} aria-hidden="true" />
      <div className="cc-cur cc-ring" ref={ring} aria-hidden="true"><span ref={label} /></div>
      <div className="cc-cur cc-dot" ref={dot} aria-hidden="true" />
    </>
  )
}
