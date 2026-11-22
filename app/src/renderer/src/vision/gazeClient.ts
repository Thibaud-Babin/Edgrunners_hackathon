/**
 * OWNER: A. WebSocket client for the Logi Gaze Tracker (separate tray app).
 * Renderer-only: uses the global WebSocket; the CSP already allows ws:.
 *
 * Protocol: connect -> {"type":"start_stream","interval_ms":33} -> snapshot messages.
 * Reconnects on its own so Tap can start before or after the tracker.
 */
import { parseGazeSnapshot, type GazeSnapshot } from './gaze'

export interface GazeClientStatus {
  connected: boolean
  calibrated: boolean
  /** performance.now() of the last accepted snapshot, or null. */
  lastSnapshotAt: number | null
  /** performance.now() of the last snapshot with a face / with a gaze value. */
  lastFaceAt: number | null
  lastGazeAt: number | null
}

export interface GazeClientOptions {
  url?: string
  intervalMs?: number
  reconnectMs?: number
  onSnapshot: (snapshot: GazeSnapshot) => void
  onStatus?: (status: GazeClientStatus) => void
}

const DEFAULT_URL = 'ws://127.0.0.1:8964'

export function startGazeClient(opts: GazeClientOptions): () => void {
  const url = opts.url ?? DEFAULT_URL
  const intervalMs = opts.intervalMs ?? 33
  const reconnectMs = opts.reconnectMs ?? 2000

  let ws: WebSocket | null = null
  let stopped = false
  let retry: number | null = null
  let lastTimestamp = -1
  const status: GazeClientStatus = { connected: false, calibrated: false, lastSnapshotAt: null, lastFaceAt: null, lastGazeAt: null }

  const pushStatus = (patch: Partial<GazeClientStatus>): void => {
    Object.assign(status, patch)
    opts.onStatus?.({ ...status })
  }

  let connect: () => void

  const schedule = (): void => {
    if (stopped || retry !== null) return
    retry = window.setTimeout(() => {
      retry = null
      connect()
    }, reconnectMs)
  }

  connect = (): void => {
    if (stopped) return
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch {
      schedule()
      return
    }
    ws = socket

    socket.onopen = () => {
      pushStatus({ connected: true })
      try {
        socket.send(JSON.stringify({ type: 'start_stream', interval_ms: intervalMs }))
      } catch {
        socket.close()
      }
    }

    socket.onmessage = (ev: MessageEvent) => {
      let raw: unknown
      try {
        raw = JSON.parse(String(ev.data))
      } catch {
        return
      }
      const snapshot = parseGazeSnapshot(raw)
      if (!snapshot) return
      if (snapshot.timestampMs === lastTimestamp) return // the server re-sends the latest snapshot
      lastTimestamp = snapshot.timestampMs
      const now = performance.now()
      const patch: Partial<GazeClientStatus> = { calibrated: snapshot.calibrated, lastSnapshotAt: now }
      if (snapshot.facePresent) patch.lastFaceAt = now
      if (snapshot.gaze) patch.lastGazeAt = now
      pushStatus(patch)
      opts.onSnapshot(snapshot)
    }

    socket.onclose = () => {
      ws = null
      pushStatus({ connected: false, calibrated: false })
      schedule()
    }

    socket.onerror = () => {
      try {
        socket.close()
      } catch {
        // ignore
      }
      schedule()
    }
  }

  connect()

  return () => {
    stopped = true
    if (retry !== null) window.clearTimeout(retry)
    retry = null
    const socket = ws
    ws = null
    if (socket) {
      try {
        socket.send(JSON.stringify({ type: 'stop_stream' }))
      } catch {
        // ignore
      }
      try {
        socket.close()
      } catch {
        // ignore
      }
    }
    pushStatus({ connected: false, calibrated: false })
  }
}