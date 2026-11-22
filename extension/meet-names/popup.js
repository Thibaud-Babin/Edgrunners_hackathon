// Live view, to check in a real meeting that names and "speaking" are read correctly.
function render({ last } = {}) {
  const st = document.getElementById('st')
  const ul = document.getElementById('people')
  ul.replaceChildren()
  if (!last || Date.now() - last.at > 6000) {
    st.className = 'st'
    st.textContent = 'No Meet call open in a tab (or it was just opened: wait 2 s).'
    return
  }
  st.className = `st ${last.tap === 'connected' ? 'ok' : 'bad'}`
  st.textContent = `Meeting ${last.meeting || '?'} · Tap: ${last.tap}`
  if (!last.people.length) {
    const li = document.createElement('li')
    li.textContent = 'No video tiles found yet.'
    ul.append(li)
  }
  for (const p of last.people) {
    const li = document.createElement('li')
    const n = document.createElement('span')
    n.textContent = p.name + (p.self ? ' (you)' : '')
    const s = document.createElement('span')
    s.textContent = p.speaking ? 'speaking' : ''
    s.className = 'talk'
    li.append(n, s)
    ul.append(li)
  }
}
const refresh = () => chrome.storage.session.get('last').then(render)
refresh()
setInterval(refresh, 300)
