// Tap (B): runs on meet.google.com. 4× a second: read the tiles (name + speaking), send changes to the
// extension's background worker, which forwards them to Tap on 127.0.0.1. Reads the page only, changes nothing.
;(function () {
  const { pickName, speakingFrom, meetingCode, SPEAK_WINDOW_MS } = globalThis.TapMeetParse
  const SAMPLE_MS = 250
  const HEARTBEAT_MS = 2000
  const history = new Map() // participant id → { changes: [ms] }
  const nameVotes = new Map() // participant id → Map(name → times read): hover labels come and go, the name stays
  let lastSent = ''
  let lastSentAt = 0

  // Meet's voice indicator animates by changing classes while someone talks. A MutationObserver sees every change
  // as it happens (timers can be slowed down in a background tab; mutations are not missed).
  const lastMark = new Map() // tile id → last change counted (ms), at most one per 100 ms
  new MutationObserver((records) => {
    const now = Date.now()
    for (const r of records) {
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement
      if (!el || el.tagName === 'VIDEO' || el.tagName === 'CANVAS') continue
      const tile = el.closest('[data-participant-id]')
      if (!tile) continue
      let top = tile
      while (top.parentElement?.closest('[data-participant-id]')) top = top.parentElement.closest('[data-participant-id]')
      const id = top.getAttribute('data-participant-id') || ''
      if (now - (lastMark.get(id) ?? 0) < 100) continue
      lastMark.set(id, now)
      const h = history.get(id) || { changes: [] }
      h.changes.push(now)
      history.set(id, h)
    }
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] })

  function read() {
    const now = Date.now()
    // outermost tiles only (Meet nests elements with the same attribute)
    const tiles = [...document.querySelectorAll('[data-participant-id]')].filter((t) => !t.parentElement?.closest('[data-participant-id]'))
    const byId = new Map()
    for (const tile of tiles) {
      const id = tile.getAttribute('data-participant-id') || ''
      const info = pickName((tile.innerText || '').split('\n'))
      if (!id || !info || info.presenting) continue
      const votes = nameVotes.get(id) || new Map()
      votes.set(info.name, (votes.get(info.name) || 0) + 1)
      nameVotes.set(id, votes)
      info.name = [...votes].sort((a, b) => b[1] - a[1])[0][0]
      const h = history.get(id) || { changes: [] }
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
