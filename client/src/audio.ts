/** A tiny WebAudio synth: chord pads for the wheel and a click for the metronome and count-in. */

let ctx: AudioContext | null = null

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!ctx) ctx = new Ctor()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12)

function tone(c: AudioContext, midi: number, when: number, seconds: number, gain: number, type: OscillatorType) {
  const osc = c.createOscillator()
  const amp = c.createGain()
  osc.type = type
  osc.frequency.value = midiToHz(midi)
  amp.gain.setValueAtTime(0.0001, when)
  amp.gain.exponentialRampToValueAtTime(gain, when + 0.02)
  amp.gain.exponentialRampToValueAtTime(0.0001, when + seconds)
  osc.connect(amp).connect(c.destination)
  osc.start(when)
  osc.stop(when + seconds + 0.05)
}

/** Play a set of pitch classes together (a chord), with an optional lower bass note. */
export function playChord(tones: number[], bass: number | null = null, seconds = 1.1): void {
  const c = context()
  if (!c) return
  const now = c.currentTime
  tones.forEach((pc, i) => tone(c, 60 + ((pc % 12) + 12) % 12 + (i > 3 ? 12 : 0), now, seconds, 0.07, 'triangle'))
  if (bass !== null) tone(c, 36 + (((bass % 12) + 12) % 12), now, seconds, 0.12, 'sine')
}

export function playNote(pc: number, seconds = 0.8): void {
  const c = context()
  if (!c) return
  tone(c, 60 + (((pc % 12) + 12) % 12), c.currentTime, seconds, 0.12, 'triangle')
}

/** A short click; the accent is higher and louder (use it on the first beat of a bar). */
export function click(accent = false): void {
  const c = context()
  if (!c) return
  tone(c, accent ? 88 : 80, c.currentTime, 0.05, accent ? 0.22 : 0.14, 'square')
}
