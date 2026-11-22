/**
 * OWNER: B. Sound cues: a short sound with each vibration, for when the hand is not on the mouse (typing, notes,
 * a tremor). Off by default (Settings). Same vocabulary as the vibrations (events.ts HAPTIC_PATTERNS):
 *   knock        → one short wooden "tock" (2 knocks = "tock tock", because main sends 2 knocks 350 ms apart)
 *   angry_alert  → low "buzz-buzz"         completed → rising two-note chime
 *   ringing / damp_state_change (extra vibrations) → soft bell / soft low tone
 * Synthesised with Web Audio: no audio files, nothing to load, works offline. Plays on the default output
 * (the headphones), never into the mic path.
 */
import type { Waveform } from '../../../shared/events'

export const SOUND_KEY = 'tap:sound-cues'
export const VOLUME_KEY = 'tap:sound-volume'

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
export const soundOn = (): boolean => read(SOUND_KEY) === 'true'
export const soundVolume = (): number => {
  const v = Number(read(VOLUME_KEY) ?? 0.6)
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.6
}

let ctx: AudioContext | null = null
const audio = (): AudioContext => {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** One enveloped tone. */
function tone(type: OscillatorType, freq: number, start: number, dur: number, peak: number, endFreq?: number, lowpass?: number): void {
  const a = audio()
  const t0 = a.currentTime + start
  const osc = a.createOscillator()
  const gain = a.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur)
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  let node: AudioNode = osc
  if (lowpass) {
    const f = a.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = lowpass
    osc.connect(f)
    node = f
  }
  node.connect(gain).connect(a.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

/** Plays the sound of one waveform at `volume` (0..1). Unknown waveforms play nothing. */
export function playCue(waveform: Waveform, volume = soundVolume()): void {
  if (volume <= 0) return
  const v = 0.5 * volume
  switch (waveform) {
    case 'knock':
      tone('triangle', 1100, 0, 0.07, v, 600)
      tone('sine', 420, 0, 0.09, v * 0.7)
      break
    case 'angry_alert':
      tone('sawtooth', 220, 0, 0.16, v * 0.55, 180, 900)
      tone('sawtooth', 220, 0.22, 0.16, v * 0.55, 180, 900)
      break
    case 'completed':
      tone('sine', 660, 0, 0.14, v * 0.8)
      tone('sine', 990, 0.12, 0.22, v * 0.8)
      break
    case 'ringing':
      tone('sine', 1320, 0, 0.5, v * 0.4)
      tone('sine', 1320, 0.25, 0.5, v * 0.3)
      break
    case 'damp_state_change':
      tone('sine', 440, 0, 0.2, v * 0.35)
      break
    default:
      break
  }
}
