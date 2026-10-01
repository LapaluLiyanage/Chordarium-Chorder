import { useEffect, useRef } from 'react'
import { playNote } from '../audio'
import { gsap, motionOK } from '../motion'
import { QUALITY_INTERVALS, type Chord } from '../theory/chord'

const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
const RADIUS = 3.4
/** pitch class -> position on the circle of fifths (7 is its own inverse mod 12) */
const fifth = (pc: number) => (pc * 7) % 12

type Role = 'root' | 'tone' | 'bass'

function rolesOf(chord: Chord | null): Map<number, Role> {
  const out = new Map<number, Role>()
  if (!chord) return out
  for (const i of QUALITY_INTERVALS[chord.quality] ?? [0, 4, 7]) out.set(fifth((chord.root + i) % 12), 'tone')
  out.set(fifth(chord.root), 'root')
  if (chord.bass !== null && chord.bass !== chord.root) out.set(fifth(chord.bass), 'bass')
  return out
}

interface Props {
  chord: Chord | null
  sound?: boolean
  /** playhead time and tempo, so the lit notes pulse on the beat */
  time?: number
  tempo?: number
}

interface WheelApi {
  setChord(chord: Chord | null): void
}

/** The circle of fifths as 3D spheres (Three.js). Drag to spin it, hover to lift a note, tap one to hear it. */
export function ChordWheel3D({ chord, sound = true, time = 0, tempo = 120 }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const api = useRef<WheelApi | null>(null)
  const latestChord = useRef(chord)
  const soundOn = useRef(sound)
  const phase = useRef(0)

  useEffect(() => { soundOn.current = sound }, [sound])
  useEffect(() => { phase.current = ((time * tempo) / 60) % 1 }, [time, tempo])
  useEffect(() => {
    latestChord.current = chord
    api.current?.setChord(chord)
  }, [chord])

  useEffect(() => {
    let disposed = false
    let teardown = () => {}

    void (async () => {
      const THREE = await import('three')
      await document.fonts?.load("800 58px 'Archivo'").catch(() => undefined)
      const el = host.current
      if (disposed || !el) return

      const width = el.clientWidth || 400
      const height = el.clientHeight || 400
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
      renderer.setSize(width, height)
      el.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100)
      camera.position.set(0, 0, 14.4) // far enough back that the outer ring and labels are not cropped
      scene.add(new THREE.AmbientLight(0xffffff, 1.1))
      const sun = new THREE.DirectionalLight(0xffffff, 1.6)
      sun.position.set(3, 5, 8)
      scene.add(sun)

      const group = new THREE.Group()
      scene.add(group)
      group.add(new THREE.Mesh(new THREE.TorusGeometry(RADIUS, 0.025, 8, 160), new THREE.MeshBasicMaterial({ color: 0x231d17, transparent: true, opacity: 0.35 })))
      group.add(new THREE.Mesh(new THREE.TorusGeometry(RADIUS + 1.05, 0.012, 8, 160), new THREE.MeshBasicMaterial({ color: 0x231d17, transparent: true, opacity: 0.15 })))

      const positions: InstanceType<typeof THREE.Vector3>[] = []
      const balls: InstanceType<typeof THREE.Mesh>[] = []
      const sphere = new THREE.SphereGeometry(0.26, 32, 32)
      for (let i = 0; i < 12; i++) {
        const a = Math.PI / 2 - (i / 12) * Math.PI * 2
        const p = new THREE.Vector3(Math.cos(a) * RADIUS, Math.sin(a) * RADIUS, 0)
        positions.push(p)
        const ball = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({ color: 0xe6dccb, roughness: 0.45, metalness: 0.05 }))
        ball.position.copy(p)
        ball.userData.i = i
        group.add(ball)
        balls.push(ball)

        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 128
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.fillStyle = '#231d17'
          ctx.font = "800 58px 'Archivo', sans-serif"
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(NAMES[(i * 7) % 12], 64, 66)
        }
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }))
        label.position.set(Math.cos(a) * (RADIUS + 0.75), Math.sin(a) * (RADIUS + 0.75), 0)
        label.scale.set(0.75, 0.75, 1)
        group.add(label)
      }

      // the chord shape: an outline and a soft fill between the lit notes
      const lineGeo = new THREE.BufferGeometry()
      lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 3), 3))
      group.add(new THREE.LineLoop(lineGeo, new THREE.LineBasicMaterial({ color: 0xf2913d })))
      const fillGeo = new THREE.BufferGeometry()
      fillGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 9), 3))
      const fillMaterial = new THREE.MeshBasicMaterial({ color: 0xf2913d, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
      group.add(new THREE.Mesh(fillGeo, fillMaterial))

      // floating dust
      const dustCount = 420
      const dustPositions = new Float32Array(dustCount * 3)
      for (let i = 0; i < dustCount; i++) {
        const r = 4 + Math.random() * 5
        const th = Math.random() * Math.PI * 2
        const u = Math.random() * 2 - 1
        dustPositions[i * 3] = r * Math.sqrt(1 - u * u) * Math.cos(th)
        dustPositions[i * 3 + 1] = r * Math.sqrt(1 - u * u) * Math.sin(th)
        dustPositions[i * 3 + 2] = r * u * 0.6
      }
      const dustGeo = new THREE.BufferGeometry()
      dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))
      const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0x231d17, size: 0.035, transparent: true, opacity: 0.35 }))
      scene.add(dust)

      let roles = new Map<number, Role>()
      const setChord = (c: Chord | null) => {
        roles = rolesOf(c)
        const lit = [...roles.entries()].filter(([, r]) => r !== 'bass').map(([i]) => i).sort((a, b) => a - b)
        const pts = lit.map((i) => positions[i])
        const line = lineGeo.attributes.position
        const fill = fillGeo.attributes.position
        if (pts.length) {
          for (let i = 0; i < 6; i++) { const v = pts[i % pts.length]; line.setXYZ(i, v.x, v.y, 0) }
          const cx = pts.reduce((s, v) => s + v.x, 0) / pts.length
          const cy = pts.reduce((s, v) => s + v.y, 0) / pts.length
          for (let i = 0; i < 6; i++) {
            const a = pts[i % pts.length]
            const b = pts[(i + 1) % pts.length]
            const on = i < pts.length
            fill.setXYZ(i * 3, cx, cy, 0)
            fill.setXYZ(i * 3 + 1, on ? a.x : cx, on ? a.y : cy, 0)
            fill.setXYZ(i * 3 + 2, on ? b.x : cx, on ? b.y : cy, 0)
          }
        }
        line.needsUpdate = true
        fill.needsUpdate = true
        lineGeo.setDrawRange(0, pts.length)
        if (motionOK()) gsap.fromTo(fillMaterial, { opacity: 0.55 }, { opacity: 0.2, duration: 0.8 })
      }
      api.current = { setChord }
      setChord(latestChord.current)

      // interaction: drag to spin, hover to lift, tap to hear
      const target = { x: -0.35, y: 0 }
      let dragX: number | null = null
      let spin = 0
      let velocity = 0
      let hover: number | null = null
      const pulse = new Map<number, number>()
      const ray = new THREE.Raycaster()
      const pointer = new THREE.Vector2()
      const pick = (e: PointerEvent) => {
        const r = el.getBoundingClientRect()
        const nx = ((e.clientX - r.left) / r.width) * 2 - 1
        const ny = ((e.clientY - r.top) / r.height) * 2 - 1
        pointer.set(nx, -ny)
        ray.setFromCamera(pointer, camera)
        return { nx, ny, hit: ray.intersectObjects(balls)[0] }
      }
      const onMove = (e: PointerEvent) => {
        const { nx, ny, hit } = pick(e)
        target.x = -0.35 + ny * 0.35
        if (dragX !== null) {
          const d = (e.clientX - dragX) * 0.008
          spin += d
          velocity = d
          dragX = e.clientX
        } else target.y = nx * 0.3
        hover = hit ? (hit.object.userData.i as number) : null
        el.style.cursor = hit ? 'pointer' : dragX !== null ? 'grabbing' : 'grab'
      }
      const onDown = (e: PointerEvent) => {
        dragX = e.clientX
        const { hit } = pick(e)
        if (hit) {
          const i = hit.object.userData.i as number
          if (soundOn.current) playNote((i * 7) % 12)
          pulse.set(i, 1)
        }
      }
      const onUp = () => { dragX = null }
      const onLeave = () => { hover = null }
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerdown', onDown)
      el.addEventListener('pointerleave', onLeave)
      window.addEventListener('pointerup', onUp)

      const resize = new ResizeObserver(() => {
        const w = el.clientWidth
        const h = el.clientHeight
        if (!w || !h) return
        renderer.setSize(w, h)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
      })
      resize.observe(el)
      let visible = true
      const watch = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting })
      watch.observe(el)

      const amber = new THREE.Color(0xf2913d)
      const ink = new THREE.Color(0x231d17)
      const blue = new THREE.Color(0x6aa8e0)
      const base = new THREE.Color(0xe6dccb)
      const tmp = new THREE.Color()
      const clock = new THREE.Clock()
      const animate = motionOK()
      let frame = 0
      const loop = () => {
        frame = requestAnimationFrame(loop)
        if (!visible) return
        const t = clock.getElapsedTime()
        if (dragX === null) {
          velocity *= 0.94
          spin += velocity + (animate ? 0.0025 : 0)
        }
        group.rotation.x += (target.x - group.rotation.x) * 0.06
        group.rotation.y += (target.y + Math.sin(spin) * 0.5 - group.rotation.y) * 0.06
        group.rotation.z = spin * 0.6
        dust.rotation.y = t * 0.03
        balls.forEach((b, i) => {
          const role = roles.get(i)
          let s = role ? 1.55 + (role === 'root' ? 0.35 : 0) : 1
          if (role && animate) s += Math.max(0, 0.25 - phase.current * 0.4)
          if (hover === i) s += 0.3
          const p = pulse.get(i)
          if (p) { s += p * 0.8; pulse.set(i, p * 0.9); if (p < 0.02) pulse.delete(i) }
          b.scale.setScalar(b.scale.x + (s - b.scale.x) * 0.18)
          const mat = b.material as InstanceType<typeof THREE.MeshStandardMaterial>
          mat.color.lerp(tmp.copy(role === 'root' ? ink : role === 'bass' ? blue : role ? amber : base), 0.15)
          b.position.z = role ? Math.sin(t * 2 + i) * 0.15 + 0.2 : 0
        })
        renderer.render(scene, camera)
      }
      loop()

      teardown = () => {
        cancelAnimationFrame(frame)
        resize.disconnect()
        watch.disconnect()
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerdown', onDown)
        el.removeEventListener('pointerleave', onLeave)
        window.removeEventListener('pointerup', onUp)
        scene.traverse((o) => {
          const mesh = o as InstanceType<typeof THREE.Mesh>
          mesh.geometry?.dispose?.()
          const m = mesh.material as InstanceType<typeof THREE.Material> | InstanceType<typeof THREE.Material>[] | undefined
          ;[m].flat().forEach((x) => {
            const withMap = x as InstanceType<typeof THREE.SpriteMaterial> | undefined
            withMap?.map?.dispose()
            x?.dispose()
          })
        })
        renderer.dispose()
        renderer.domElement.remove()
        api.current = null
      }
    })()

    return () => {
      disposed = true
      teardown()
    }
  }, [])

  return <div ref={host} className="wheel-3d" role="img" aria-label="3D circle of fifths. Drag to spin it; tap a note to hear it." />
}
