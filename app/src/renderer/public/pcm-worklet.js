// AudioWorklet: converts Float32 audio (already at the AudioContext's 16 kHz) to Int16 chunks of ~100 ms,
// and reports the RMS level. Runs off the main thread.
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super()
    this.chunk = new Int16Array(1600) // 100 ms at 16 kHz
    this.pos = 0
    this.sumSq = 0
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]))
      this.sumSq += s * s
      this.chunk[this.pos++] = s < 0 ? s * 0x8000 : s * 0x7fff
      if (this.pos === this.chunk.length) {
        const rms = Math.sqrt(this.sumSq / this.chunk.length)
        this.port.postMessage({ pcm: this.chunk.buffer, rms }, [this.chunk.buffer])
        this.chunk = new Int16Array(1600)
        this.pos = 0
        this.sumSq = 0
      }
    }
    return true
  }
}

registerProcessor('pcm-worklet', PcmWorklet)
