// Tap (B): runs on meet.google.com. 4× a second: read the tiles (name + speaking), send changes to the
// extension's background worker, which forwards them to Tap on 127.0.0.1. Reads the page only, changes nothing.
;(function () {
  const { pickName, speakingFrom, meetingCode, SPEAK_WINDOW_MS } = globalThis.TapMeetParse
  const SAMPLE_MS = 250
  const HEARTBEAT_MS = 2000
  const history = new Map() // participant id → { sig, changes: [ms] }
  let lastSent = ''
  let lastSentAt = 0

  // Everything in the tile but video / canvas (they don't carry the indicator) → a class signature
  function signature(tile) {
    let s = ''
    for (const el of tile.querySelectorAll('*')) {
      if (el.tagName === 'VIDEO' || el.tagName === 'CANVAS') continue
      s += (el.getAttribute('class') || '') + '|'
    }
    return s
  }

  function read() {
    const now = Date.now()
    // outermost tiles only (Meet nests elements with the same attribute)
    const tiles = [...document.querySelectorAll('[data-participant-id]')].filter((t) => !t.parentElement?.closest('[data-participant-id]'))
    const byId = new Map()
    for (const tile of tiles) {
      const id = tile.getAttribute('data-participant-id') || ''
      const info = pickName((tile.innerText || '').split('\n'))
      if (!id || !info || info.presenting) continue
      const h = history.get(id) || { sig: '', changes: [] }
      const sig = signature(tile)
      if (h.sig && sig !== h.sig) h.changes.push(now)
      h.sig = sig
      h.changes = h.changes.filter((t) => now - t <= SPEAK_WINDOW_MS * 2)
      history.set(id, h)
      const speaking = speakingFrom(h.changes, now)
      const prev = byId.get(id)
      byId.set(id, { id, name: info.name, speaking: speaking || !!prev?.speaking, self: info.self || !!prev?.self })
    }
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
  }

  function tick() {
    let people = []
    try {
      people = read()
    } catch (e) {
      console.debug('[Tap] could not read the Meet tiles', e)
    }
    const msg = { v: 1, meeting: meetingCode(location.pathname), people }
    const key = JSON.stringify(msg)
    const now = Date.now()
    if (key === lastSent && now - lastSentAt < HEARTBEAT_MS) return
    lastSent = key
    lastSentAt = now
    try {
      chrome.runtime.sendMessage({ type: 'tap-meet', msg })
    } catch {
      clearInterval(timer) // the extension was reloaded: this old copy of the script stops
    }
  }
  const timer = setInterval(tick, SAMPLE_MS)
})()
