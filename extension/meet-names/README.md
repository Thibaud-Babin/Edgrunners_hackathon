# Tap: Meet names (Chrome extension)

Gives Tap real names instead of "Speaker 1, 2…" in Google Meet, and tells it who is speaking.

## Install (1 minute)

1. Chrome → `chrome://extensions` → turn on **Developer mode** (top right).
2. **Load unpacked** → pick this folder (`extension/meet-names`).
3. Start Tap, then open your Meet call. Click the extension's icon: you should see
   `Tap: connected` and the people in the call, with **speaking** next to whoever talks.

## How it works

- `content.js` reads the Meet page 4× a second: each video tile (`data-participant-id`), the name
  written on it, and whether its voice indicator is animating (= speaking). It changes nothing on the page.
- `background.js` sends that to Tap at `http://127.0.0.1:47811/meet`: this laptop only.
- Tap (`app/src/main/audio/meet-bridge.ts`) accepts only this extension: the browser sets the
  `Origin` header, and the extension's id is fixed by the public `key` in `manifest.json`
  (`gakbaekmaofiakidfecnepknjjgbjike`).
- Tap (`app/src/main/audio/speaker-names.ts`) matches each finished sentence with who Meet showed
  as speaking during it → "Sarah: …" instead of "Speaker 2: …".

## Privacy

Only names and speaking on/off leave the Meet tab, and only to Tap on this laptop. No audio, no video,
nothing saved. Your own tile is marked `self` and ignored by Tap.

## If names or "speaking" look wrong

Meet's page is undocumented and changes often. `parse.js` holds the rules (tested in
`app/src/main/meet-parse.test.ts`). If tiles stop being found, look in DevTools for the attribute Meet
now uses for participant tiles and update the selector in `content.js`.
