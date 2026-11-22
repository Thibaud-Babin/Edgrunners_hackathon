// Tap (B): pure helpers to read a Google Meet tile. No DOM here, so it is unit-tested in Node
// (app/src/main/meet-parse.test.ts). Meet's page is undocumented and changes often, so nothing depends
// on its class names: a tile is any element with data-participant-id, its name is its first line that
// looks like a name, and "speaking" is the tile's voice indicator animating (its classes keep changing).
;(function (g) {
  // Material icon names show up as text in the tiles (mic_off, more_vert…): never a person's name.
  const UI_WORDS = new Set([
    'you', 'vous', 'more options', 'pin', 'unpin', 'mute', 'remove', 'presentation', 'more_vert', 'mic_off', 'mic',
    'keep', 'keep_off', 'frame_person', 'visual_effects', 'close', 'fullscreen', 'push_pin', 'more_horiz', 'pan_tool',
    'back_hand', 'reframe'
  ])

  /** From a tile's visible lines: its person's name, and whether it is you or a presentation. */
  function pickName(lines) {
    let self = false
    let presenting = false
    let name = null
    let named = null
    for (const raw of lines) {
      let line = String(raw).replace(/\s+/g, ' ').trim()
      if (!line) continue
      const low = line.toLowerCase()
      if (low === 'you' || low === '(you)' || low === 'vous' || low === '(vous)') {
        self = true
        continue
      }
      if (/\((you|vous)\)$/i.test(line)) {
        self = true
        line = line.replace(/\s*\((you|vous)\)$/i, '')
      }
      if (/\(presentation\)$|is presenting$|présentation/i.test(line)) {
        presenting = true
        continue
      }
      if (UI_WORDS.has(line.toLowerCase()) || line.includes('_') || line.length > 60 || !/\p{L}/u.test(line)) continue
      // Names usually start with a capital (Meet shows account names); other tile text is usually lowercase
      if (/^\p{Lu}/u.test(line)) {
        if (named === null) named = line
      } else if (name === null) name = line
    }
    name = named ?? name
    return name ? { name, self, presenting } : null
  }

  /**
   * "Speaking" from how often a tile's class signature changed recently: Meet's voice indicator animates
   * while someone talks and is still when they are silent. changes = times (ms) the signature changed.
   */
  const SPEAK_WINDOW_MS = 900
  const SPEAK_MIN_CHANGES = 2
  function speakingFrom(changes, now) {
    let n = 0
    for (const t of changes) if (now - t <= SPEAK_WINDOW_MS) n++
    return n >= SPEAK_MIN_CHANGES
  }

  /** Meeting code from the URL path (abc-defg-hij), or '' */
  function meetingCode(pathname) {
    const m = /^\/([a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4})/.exec(pathname || '')
    return m ? m[1] : ''
  }

  g.TapMeetParse = { pickName, speakingFrom, meetingCode, SPEAK_WINDOW_MS }
})(globalThis)
