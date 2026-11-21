# Tap app (Electron + TypeScript)

## Run it

```bash
cd app
npm install          # also copies MediaPipe wasm + downloads the face model (offline afterwards)
copy .env.example .env   # then fill in ANTHROPIC_API_KEY (optional) and TAP_USER_NAMES
npm run setup-stt    # once: downloads the local speech-to-text model (~310 MB download, ~75 MB kept)
npm run dev          # the app
npm run mock         # the app + replays demo/mock-events.json (no camera/mic/call needed)
npm test             # detector unit tests
npm run typecheck
```

If you see `Error: Electron uninstall`: `node node_modules/electron/install.js`.

Two windows open:
- **Main window**: start camera / mic / call audio, check-up, **dev tools** (type what someone in the call says, fake any event), activity log + counters.
- **Overlay**: transparent, always on top, on the right of the screen. Cards appear here, over Zoom/Meet/Teams. Clicks go through it except on cards.

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
| **A** vision | `src/renderer/src/vision.ts` | `USER_AWAY/BACK`, `MOUTH_MOVING`, `FACE_OUT_OF_FRAME`, gestures (P1) | "Start camera" → pose/blendshape readout + events in the log |
| **B** audio | `src/renderer/src/audio.ts`, `src/main/audio/`, `src/main/detectors/` | transcripts, `NAME_MENTIONED`, `QUESTION_*`, `OTHERS_CANT_HEAR`, `MIC_LEVEL` | `npm test`; "Start call audio"; plug STT into `createStt()` |
| **C** agent + haptics | `src/main/agent/`, `src/main/haptics.ts`, `plugins/haptics/` | cards, log, counters, haptics | `npm run mock` or the dev text box |
| **D** integration + UI | `src/main/index.ts`, `src/renderer/*.html`, `main.ts`, `overlay.ts`, `style.css` | windows, cards, `USER_CLICK` | `npm run mock` |

Search the code for `TODO(A)`, `TODO(B)`, `TODO(C)`, `TODO(D)` to find your starting points.

## What works already

- Name typed/said in the call → `knock` → recap card (template summary without an API key, Claude with one).
- Look away (fake button or real camera) → talk → name or look back → "while you were away" card with everything said since you turned away.
- Mouth moving + mic silent ≥ 2 s → `angry_alert` + "Your mic sends nothing" card.
- "Can you hear me?" in the call → fix card. Unknown actions → blocked and logged.
- Haptics through HapticWeb (screen flash if the plugin isn't reachable).

## Not done yet (by owner)

- **A**: gestures, frozen camera, low light, calibration, Web Worker.
- **B**: speech-to-text engine (sherpa-onnx local, Deepgram fallback), partial-result name detection, latency measurement.
- **C**: gesture → reply actions, real device switch, own C# haptics plugin, pricing constants.
- **D**: check-up screen, IT view (P1), card design, packaging for the demo laptop.
