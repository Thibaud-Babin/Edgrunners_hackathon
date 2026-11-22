// Tap (B): forwards the Meet tab's updates to Tap on this laptop (127.0.0.1 only) and keeps the last
// state for the popup. Nothing goes anywhere else, nothing is stored on disk.
const TAP_URL = 'http://127.0.0.1:47811/meet'

chrome.runtime.onMessage.addListener((m, sender) => {
  if (m?.type !== 'tap-meet' || !sender.tab) return
  fetch(TAP_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m.msg) })
    .then((r) => save(m.msg, r.ok ? 'connected' : `Tap refused it (${r.status})`))
    .catch(() => save(m.msg, 'Tap is not running'))
})

function save(msg, tap) {
  chrome.storage.session.set({ last: { at: Date.now(), tap, meeting: msg.meeting, people: msg.people } })
}
