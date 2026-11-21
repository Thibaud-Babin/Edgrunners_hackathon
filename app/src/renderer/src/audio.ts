/**
 * OWNER: B. Audio capture in the renderer.
 *  - Call audio: getDisplayMedia() → main process answers with system loopback (what plays in your headphones).
 *  - Mic: getUserMedia() → used for MIC_LEVEL (P0-4); later also for the user's own transcript.
 * Both are resampled to 16 kHz mono Int16 by the AudioWorklet and sent to main over IPC.
 */
import type { Source } from '../../shared/events'
import { makeEvent } from '../../shared/events'

async function pipe(stream: MediaStream, source: Source, onRms?: (rms: number) => void): Promise<() => void> {
  const ctx = new AudioContext({ sampleRate: 16000 })
  await ctx.audioWorklet.addModule('pcm-worklet.js')
  const src = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'pcm-worklet')
  node.port.onmessage = (m: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
    window.tap.sendAudio(source, m.data.pcm)
    onRms?.(m.data.rms)
  }
  src.connect(node) // not connected to ctx.destination: we don't play it back
  return () => {
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close()
  }
}

/** Call audio = system loopback. Video is required by the API, we drop it immediately. */
export async function startCallAudio(): Promise<() => void> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
  stream.getVideoTracks().forEach((t) => t.stop())
  if (stream.getAudioTracks().length === 0) throw new Error('No loopback audio track (see PRD §11 fallbacks)')
  return pipe(stream, 'call_audio')
}

/** Mic: emits MIC_LEVEL every ~250 ms. */
export async function startMic(deviceId?: string): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: false }
  })
  let last = 0
  return pipe(stream, 'mic', (rms) => {
    const t = performance.now()
    if (t - last < 250) return
    last = t
    window.tap.emit(makeEvent('MIC_LEVEL', 'mic', { rms }))
  })
}
