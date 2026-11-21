/**
 * OWNER: B. Cloud speech-to-text (Deepgram nova-3, live WebSocket) — TAP_STT=deepgram, key in DEEPGRAM_API_KEY.
 * Chosen after the real-call test (2026-11-21): name 7/7 with keyterms vs 5/7 for the best local model.
 * One keyterm per name variant (TAP_HOTWORDS) biases recognition toward the user's name.
 *
 * Deepgram sends interim results (partials) while the person speaks; `is_final` pieces are stable,
 * `speech_final` marks the end of a sentence (pause). We emit partial = stable pieces + current interim,
 * and final = all stable pieces when the sentence ends.
 */
import type { Source } from '../../shared/events'
import type { SttEngine } from './pipeline'

const KEY = process.env.DEEPGRAM_API_KEY || ''
const TERMS = (process.env.TAP_HOTWORDS || process.env.TAP_USER_NAMES || 'Thibaud,Thibault,Tibo,Teebo').split(',').map((s) => s.trim()).filter(Boolean)

function url(): string {
  const p = new URLSearchParams({
    model: process.env.DG_MODEL || 'nova-3',
    language: 'en',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    punctuate: 'true',
    smart_format: 'true',
    endpointing: process.env.DG_ENDPOINTING || '800', // ms of silence that ends a sentence
    utterance_end_ms: '1000',
    vad_events: 'true'
  })
  for (const t of TERMS) p.append('keyterm', t)
  return `wss://api.deepgram.com/v1/listen?${p}`
}

interface DgMessage {
  type?: string
  is_final?: boolean
  speech_final?: boolean
  channel?: { alternatives?: Array<{ transcript?: string }> }
}

export function deepgramAvailable(): boolean {
  return KEY.length > 10
}

/**
 * onDead is called (once) when Deepgram is unusable: 2 failed connections in a row (no internet / bad key),
 * or no message from the server for 6 s while we are sending audio (connection silently dropped).
 * The pipeline then switches to the local Parakeet engine.
 */
export function createDeepgramEngine(
  source: Source,
  onText: (text: string, final: boolean) => void,
  onDead?: (reason: string) => void
): SttEngine {
  let ws: WebSocket | null = null
  let open = false
  let failedConnects = 0
  let lastMsgAt = 0
  let lastSentAt = 0
  let dead = false
  let stopped = false
  let queue: ArrayBuffer[] = []
  let stable = '' // is_final pieces of the current sentence
  let keepAlive: ReturnType<typeof setInterval> | null = null

  const flushSentence = (): void => {
    const text = stable.trim()
    stable = ''
    if (text) onText(text, true)
  }

  const die = (reason: string): void => {
    if (dead || stopped) return
    dead = true
    stopped = true
    console.warn(`[stt] deepgram unusable (${reason})`)
    if (keepAlive) clearInterval(keepAlive)
    clearInterval(watchdog)
    try {
      ws?.close()
    } catch {
      /* ignore */
    }
    onDead?.(reason)
  }

  const watchdog = setInterval(() => {
    const t = Date.now()
    if (open && t - lastSentAt < 2000 && t - lastMsgAt > 6000) die('no answer from Deepgram for 6 s')
  }, 2000)

  const connect = (): void => {
    // Node's WebSocket can't set headers: Deepgram accepts the key as the "token" subprotocol.
    ws = new WebSocket(url(), ['token', KEY])
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      open = true
      failedConnects = 0
      lastMsgAt = Date.now()
      console.log(`[stt] deepgram connected (${source}), keyterms: ${TERMS.join(', ')}`)
      for (const b of queue) ws?.send(b)
      queue = []
      keepAlive = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'KeepAlive' })), 8000)
    }
    ws.onmessage = (ev) => {
      lastMsgAt = Date.now()
      if (typeof ev.data !== 'string') return
      let m: DgMessage
      try {
        m = JSON.parse(ev.data) as DgMessage
      } catch {
        return
      }
      if (m.type === 'UtteranceEnd') return flushSentence()
      if (m.type !== 'Results') return
      const t = (m.channel?.alternatives?.[0]?.transcript ?? '').trim()
      if (m.is_final) {
        if (t) stable = `${stable} ${t}`.trim()
        if (m.speech_final) flushSentence()
        else if (stable) onText(stable, false)
      } else if (t) {
        onText(`${stable} ${t}`.trim(), false)
      }
    }
    ws.onerror = (ev) => console.warn('[stt] deepgram error:', (ev as ErrorEvent).message ?? ev.type)
    ws.onclose = (ev) => {
      const wasOpen = open
      open = false
      if (keepAlive) clearInterval(keepAlive)
      flushSentence()
      if (stopped) return
      if (!wasOpen && ++failedConnects >= 2) return die(`cannot connect (${ev.code}${ev.reason ? ` ${ev.reason}` : ''})`)
      console.warn(`[stt] deepgram closed (${ev.code} ${ev.reason || ''}) — reconnecting in 1 s`)
      setTimeout(connect, 1000)
    }
  }
  connect()

  return {
    push(pcm: Int16Array): void {
      const buf = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer
      if (dead) return
      lastSentAt = Date.now()
      if (open && ws?.readyState === WebSocket.OPEN) ws.send(buf)
      else if (queue.length < 50) queue.push(buf) // keep ≤ 5 s while connecting
    },
    stop(): void {
      stopped = true
      if (keepAlive) clearInterval(keepAlive)
      clearInterval(watchdog)
      try {
        ws?.send(JSON.stringify({ type: 'CloseStream' }))
      } catch {
        /* already closed */
      }
      ws?.close()
    }
  }
}
