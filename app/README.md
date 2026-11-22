# Tap app (Electron + TypeScript)

## Run it

```bash
cd app
npm install          # also copies MediaPipe wasm + downloads the face model (offline afterwards)
copy .env.example .env   # then fill in ANTHROPIC_API_KEY (optional) and TAP_USER_NAMES
npm run setup-stt    # once: local speech-to-text (Parakeet ~460 MB + Silero VAD + old Zipformer)
npm run dev          # the app
npm run dev:call     # the app + starts call-audio capture
npm run dev:e2e      # the app + call audio + clicks "Look away": the whole loop without a webcam
npm run mock         # the app + replays demo/mock-events.json (no camera/mic/call needed)
npm test             # detector unit tests
npm run typecheck
```

**Speech-to-text (`TAP_STT` in `.env`):**
- `deepgram` (recommended): needs `DEEPGRAM_API_KEY`, and falls back to local Parakeet automatically if Deepgram can't connect or stops answering.
- `parakeet`: local only.
- `sherpa`: old local model, poor on real calls.
- `none`: dev text box only.

**Debug options:** `TAP_RECORD=1` saves the call audio to `demo/recordings/` (compare models with `node --experimental-strip-types scripts/stt-compare.mts`). `TAP_DEBUG_AUDIO=0` silences the terminal trace.

If you see `Error: Electron uninstall`: `node node_modules/electron/install.js`.

**Camera sharing (Windows 11):** by default the demo laptop's Logitech LVNext camera allows one app at a time — Zoom/Meet/Windows Camera fail while Tap holds it. Enable **Settings → Bluetooth & devices → Cameras → LVNext Camera → Advanced camera options → "Allow multiple apps to use camera at the same time"**. Verified: Zoom + Tap both live at the same time (see `docs/team/A-vision.md`).

**Gaze mode (default, P2):** true look-away with the Logi Gaze Tracker. Run/calibrate the tracker on the meeting display; Tap uses it by default and **falls back to head pose automatically** if it is missing, uncalibrated, stale or sees no face. `gazeStatus()` reports `activeSource`/`fallbackReason`; the Settings → Attention toggle calls `setAwayMode/getAwayMode/gazeStatus`. MediaPipe still runs for mouth/gestures/camera health, so keep the Windows multi-app camera setting on. To force pose: `localStorage.setItem('tap:awayMode','pose'); location.reload()` (back with `'gaze'`).

Two windows open:
- **Main window**: start camera / mic / call audio, check-up, **dev tools** (type what someone in the call says, fake any event), activity log + counters.
- **Overlay**: transparent, always on top, on the right of the screen. Cards appear here, over Zoom/Meet/Teams. Clicks go through it except on cards.

## Installer (Windows)

```
npm run dist        # → dist/Tap-Setup-0.1.0.exe (~600 MB: includes the local Parakeet speech model)
```

- No API key is ever put in the installer (the repo is public). After installing, put the keys in
  `%APPDATA%\Tap\.env` (same lines as `app/.env`). Without keys Tap still works: local Parakeet speech,
  template summaries.
- Installed, Tap reads `models/`, `scripts/win-mic.ps1` and `extension/meet-names` from its resources
  folder (`src/main/packaged-setup.ts`). The Meet extension is in `<install folder>\resources\extension\meet-names`.
- Not signed: Windows SmartScreen shows "Windows protected your PC" → **More info → Run anyway**.

## How the pieces connect

```
A  renderer/src/vision.ts ──┐  window.tap.emit(event)        ┌─► renderer (main window): log, counters
B  renderer/src/audio.ts  ──┤  ── IPC ──► main/index.ts      │
   main/audio/pipeline.ts ──┼──► EventBus ──► main/agent ────┼─► renderer (overlay): cards
   main/detectors/text.ts   │                                └─► main/haptics.ts ──► MX Master 4
D  dev tools, card clicks ──┘
```

**The contract is `src/shared/events.ts`.** Everyone emits/receives only those types. Change it only after telling the team.

## Who owns what

| Person | Files | Produces | Test without the others |
|---|---|---|---|
| **A** vision | `src/renderer/src/vision.ts`, `src/renderer/src/vision/` | `USER_AWAY/BACK`, `MOUTH_MOVING`, `FACE_OUT_OF_FRAME`, `CAMERA_FROZEN`, `LOW_LIGHT`, `cameraHealth()`, gaze mode (default, P2), gestures (P1) | "Start camera" -> pose/blendshape readout + events in the log |
| **B** audio | `src/renderer/src/audio.ts`, `src/main/audio/`, `src/main/detectors/` | transcripts, `NAME_MENTIONED`, `QUESTION_*`, `OTHERS_CANT_HEAR`, `MIC_LEVEL` | `npm test`; "Start call audio"; plug STT into `createStt()` |
| **C** agent + haptics | `src/main/agent/`, `src/main/haptics.ts`, `plugins/haptics/` | cards, log, counters, haptics | `npm run mock` or the dev text box |
| **D** integration + UI | `src/main/index.ts`, `src/renderer/*.html`, `main.ts`, `overlay.ts`, `style.css` | windows, cards, `USER_CLICK` | `npm run mock` |

Search the code for `TODO(A)`, `TODO(B)`, `TODO(C)`, `TODO(D)` to find your starting points.

## What works already

- Name typed/said in the call → `knock` → recap card (template summary without an API key, Claude with one).
- Look away (fake button or real camera) → talk → name or look back → "while you were away" card with everything said since you turned away.
- Mouth moving + mic silent ≥ 2 s → `angry_alert` + "Your mic sends nothing" card.
- Camera health on a 64x48 canvas: `CAMERA_FROZEN`, `LOW_LIGHT`, `cameraHealth().tooBright`, live `brightness` / `frozen` / `fps` for the check-up.
- "Can you hear me?" in the call → fix card. Unknown actions → blocked and logged.
- Haptics through HapticWeb (screen flash if the plugin isn't reachable).

## Not done yet (by owner)

- **A**: calibration, gestures, Web Worker.
- **B**: speech-to-text engine (Deepgram live, local sherpa-onnx fallback), partial-result name detection, latency measurement.
- **C**: gesture → reply actions, real device switch, own C# haptics plugin, pricing constants.
- **D**: check-up screen, IT view (P1), card design, packaging for the demo laptop.
