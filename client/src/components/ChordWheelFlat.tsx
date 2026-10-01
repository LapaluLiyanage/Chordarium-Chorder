import { useRef, useState, type PointerEvent } from 'react'
import { playNote } from '../audio'
import { QUALITY_INTERVALS, type Chord } from '../theory/chord'

const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
const SIZE = 560
const CENTER = SIZE / 2
const RADIUS = 214
const DRAG_THRESHOLD = 4

type Role = 'root' | 'tone' | 'bass' | 'other'

interface Props {
  chord: Chord | null
  /** play a note when a node is tapped */
  sound?: boolean
}

function roles(chord: Chord | null): Map<number, Role> {
  const out = new Map<number, Role>()
  if (!chord) return out
  for (const i of QUALITY_INTERVALS[chord.quality] ?? [0, 4, 7]) out.set((chord.root + i) % 12, 'tone')
  out.set(chord.root, 'root')
  if (chord.bass !== null && chord.bass !== chord.root) out.set(chord.bass, 'bass')
  return out
}

/** Flat SVG circle of fifths, used when WebGL is not available. Drag to spin it; tap a note to hear it. */
export function ChordWheelFlat({ chord, sound = true }: Props) {
  const [rotation, setRotation] = useState(0)
  const drag = useRef<{ x: number; moved: number } | null>(null)
  const roleOf = roles(chord)

  const nodes = Array.from({ length: 12 }, (_, k) => {
    const pc = (k * 7) % 12
    const angle = ((-90 + 30 * k + rotation) * Math.PI) / 180
    return { pc, x: CENTER + RADIUS * Math.cos(angle), y: CENTER + RADIUS * Math.sin(angle), angle, role: roleOf.get(pc) ?? 'other' as Role }
  })
  const lit = nodes.filter((n) => n.role !== 'other' && n.role !== 'bass').sort((a, b) => Math.atan2(a.y - CENTER, a.x - CENTER) - Math.atan2(b.y - CENTER, b.x - CENTER))
  const litNames = nodes.filter((n) => n.role !== 'other').map((n) => NAMES[n.pc]).join(', ')

  function down(e: PointerEvent<SVGSVGElement>) {
    drag.current = { x: e.clientX, moved: 0 }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    if (!drag.current) return
    const dx = e.clientX - drag.current.x
    drag.current = { x: e.clientX, moved: drag.current.moved + Math.abs(dx) }
    setRotation((r) => r + dx * 0.4)
  }
  function up() {
    drag.current = null
  }
  function tap(pc: number) {
    if (sound && (drag.current?.moved ?? 0) < DRAG_THRESHOLD) playNote(pc)
  }

  return (
    <svg className="wheel" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`Circle of fifths. Lit notes: ${litNames || 'none'}`}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <defs>
        {(['root', 'tone', 'bass', 'other'] as Role[]).map((r) => (
          <radialGradient key={r} id={`wheel-${r}`} cx="35%" cy="30%" r="75%">
            <stop offset="0%" className={`wheel-hi wheel-hi-${r}`} />
            <stop offset="100%" className={`wheel-lo wheel-lo-${r}`} />
          </radialGradient>
        ))}
      </defs>
      <circle className="wheel-ring" cx={CENTER} cy={CENTER} r={RADIUS} />
      {lit.length >= 3 && <polygon className="wheel-shape" points={lit.map((n) => `${n.x},${n.y}`).join(' ')} />}
      {nodes.map((n) => {
        const r = n.role === 'root' ? 26 : n.role === 'other' ? 13 : 20
        const lx = CENTER + (RADIUS + 52) * Math.cos(n.angle)
        const ly = CENTER + (RADIUS + 52) * Math.sin(n.angle)
        return (
          <g key={n.pc} className={`wheel-node wheel-${n.role}`} onClick={() => tap(n.pc)}>
            <circle cx={n.x} cy={n.y} r={r + 8} fill="transparent" />
            <circle cx={n.x} cy={n.y} r={r} fill={`url(#wheel-${n.role})`} className="wheel-ball" />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" className="wheel-label">{NAMES[n.pc]}</text>
          </g>
        )
      })}
    </svg>
  )
}
