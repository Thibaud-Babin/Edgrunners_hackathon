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
import type { OnText, SttEngine, SttMeta } from './pipeline'
import { sentenceDone } from './sentence'

const KEY = process.env.DEEPGRAM_API_KEY || ''
const TERMS = (process.env.TAP_HOTWORDS || process.env.TAP_USER_NAMES || 'Thibaud,Thibault,Tibo,Teebo').split(',').map((s) => s.trim()).filter(Boolean)

function url(): string {
  const p = new URLSearchParams({
    model: process.env.DG_MODEL || 'nova-3',
    language: process.env.TAP_STT_LANGUAGE || 'en', // 'multi' = English + French (+ others) in the same call
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    punctuate: 'true',
    smart_format: 'true',
    endpointing: process.env.DG_ENDPOINTING || '800', // ms of silence that ends a sentence
    utterance_end_ms: '1000',
    vad_events: 'true',
    diarize: process.env.TAP_DIARIZE === '0' ? 'false' : 'true' // speaker labels: "Speaker 2 asked you…"
  })
  for (const t of TERMS) p.append('keyterm', t)
  return `wss://api.deepgram.com/v1/listen?${p}`
}

interface DgMessage {
  type?: string
  is_final?: boolean
  speech_final?: boolean
  channel?: { alternatives?: Array<{ transcript?: string; words?: DgWord[] }> }
}
interface DgWord {
  word: string
  punctuated_word?: string
  start: number
  end: number
  speaker?: number
}

/** Most frequent speaker among the words (diarization). */
function mainSpeaker(words: DgWord[]): number | undefined {
  const n = new Map<number, number>()
  for (const w of words) if (w.speaker !== undefined) n.set(w.speaker, (n.get(w.speaker) ?? 0) + 1)
  let best: number | undefined
  for (const [sp, c] of n) if (best === undefined || c > (n.get(best) ?? 0)) best = sp
  return best
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
  onText: OnText,
  onDead?: (reason: string) => void
): SttEngine {
  let ws: WebSocket | null = null
  let open = false
  let failedConnects = 0
  let lastMsgAt = 0
  let lastSentAt = 0
  let dead = false
  let stopped = false
  let queue: Array<{ buf: ArrayBuffer; wall: number }> = []
  let stable = '' // is_final pieces of the current sentence
  let stableWords: DgWord[] = []
  // Audio clock of the current connection: Deepgram word times are seconds of audio since the connection opened.
  let sentSec = 0
  let clock: Array<{ sec: number; wall: number }> = [] // when each sent chunk was captured
  const wallAt = (sec: number): number => {
    let e = clock[0]
    for (const c of clock) {
      if (c.sec > sec) break
      e = c
    }
    return e ? e.wall + (sec - e.sec) * 1000 : Date.now()
  }
  const send = (buf: ArrayBuffer, wall: number): void => {
    ws?.send(buf)
    clock.push({ sec: sentSec, wall })
    if (clock.length > 1200) clock.shift() // keep 2 min
    sentSec += buf.byteLength / 2 / 16000
  }
  const meta = (words: DgWord[]): SttMeta => ({ words, speaker: mainSpeaker(words), wallAt })
  let keepAlive: ReturnType<typeof setInterval> | null = null

  const flushSentence = (): void => {
    const text = stable.trim()
    const words = stableWords
    stable = ''
    stableWords = []
    if (text) onText(text, true, meta(words))
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
      sentSec = 0
      clock = []
      console.log(`[stt] deepgram connected (${source}), keyterms: ${TERMS.join(', ')}`)
      for (const q of queue) send(q.buf, q.wall)
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
      const alt = m.channel?.alternatives?.[0]
      const t = (alt?.transcript ?? '').trim()
      const words = alt?.words ?? []
      if (m.is_final) {
        if (t) {
          stable = `${stable} ${t}`.trim()
          stableWords = [...stableWords, ...words]
        }
        // B: also at the sentence's own punctuation (speech_final can take 30 s in a monologue)
        if (m.speech_final || sentenceDone(stable)) flushSentence()
        else if (stable) onText(stable, false, meta(stableWords))
      } else if (t) {
        onText(`${stable} ${t}`.trim(), false, meta([...stableWords, ...words]))
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
      if (open && ws?.readyState === WebSocket.OPEN) send(buf, lastSentAt)
      else if (queue.length < 50) queue.push({ buf, wall: lastSentAt }) // keep ≤ 5 s while connecting
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
