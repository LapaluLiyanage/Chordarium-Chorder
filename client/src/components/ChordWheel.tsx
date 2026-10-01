import { useState } from 'react'
import type { Chord } from '../theory/chord'
import { ChordWheel3D } from './ChordWheel3D'
import { ChordWheelFlat } from './ChordWheelFlat'

interface Props {
  chord: Chord | null
  sound?: boolean
  time?: number
  tempo?: number
}

function webglAvailable(): boolean {
  // jsdom (tests) has no matchMedia or WebGL, so it gets the flat wheel
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/** The circle of fifths: 3D (Three.js) where WebGL works, a flat SVG wheel everywhere else. */
export function ChordWheel(props: Props) {
  const [use3d] = useState(webglAvailable)
  return use3d ? <ChordWheel3D {...props} /> : <ChordWheelFlat chord={props.chord} sound={props.sound} />
}
