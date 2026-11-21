# A — Vision (webcam)

**Mission:** Tap's eyes. From the webcam, tell the rest of the app when the user looks away and back, when their mouth moves, whether the camera is healthy, and (P1) which face gesture they made.

> 📣 **Update from B (Sat 17:45):** `MOUTH_MOVING` flapped constantly on a real call. Please debounce it (≈300 ms on, ≈800 ms off). The mic-silent alert now only fires while "Start mic" is on. Details: [team README](README.md#-update-from-b-audio-sat-1745--read-this).

## Your files
- `app/src/renderer/src/vision.ts` (yours)
- New files you create under `app/src/renderer/src/vision/` (e.g. `gestures.ts`, `worker.ts`)
- **Don't edit:** `shared/events.ts` (ask first), anything in `src/main/`, the UI files (`main.ts`, `overlay.ts`, HTML/CSS: that's D).

## What you send (events, via `window.tap.emit`)
| Event | `data` | When |
|---|---|---|
| `USER_AWAY` | `{ reason: 'turned_away' \| 'no_face' }` | face turned > ~28° or missing for > 2 s |
| `USER_BACK` | — | face back towards the screen |
| `MOUTH_MOVING` | `{ active: boolean }` | **only when it changes** (talking starts/stops) |
| `FACE_OUT_OF_FRAME` | — | no face detected |
| `CAMERA_FROZEN` | — | frames identical for > 3 s |
| `LOW_LIGHT` | `{ brightness }` | mean brightness too low |
| `GESTURE_NOD` / `_SHAKE` / `_BROW_RAISE` / `_TILT_LEFT` / `_TILT_RIGHT` (P1) | `{ confidence }` | once per gesture, then ~1 s cooldown |

You also keep **`cameraHealth()`** (in `vision.ts`) up to date: `{ running, faceInFrame, frozen, brightness, fps }`. **D's check-up screen reads it**, so don't rename its fields.

Who uses your events: C's agent (away summary P0-3, mic-silent P0-4, gestures P1-1), D's check-up (P0-5).

## Tasks, in order
| When | Task | Done when |
|---|---|---|
| Sat 12:00–13:00 | `npm install`, `npm run dev`, click **Start camera**. Turn your head left/right/up/down and check the yaw/pitch/roll readout has sensible signs (fix `headPose()` if not). | Readout moves the right way |
| 13:00–15:00 **spike** | 1) Measure FPS (`cameraHealth().fps`) on the demo laptop **while Zoom/Meet runs**. 2) **Critical test: can Zoom and Tap use the webcam at the same time?** If not, tell C + D immediately (fallback: Tap opens the camera, OBS Virtual Camera feeds Zoom). | FPS ≥ 15 and camera-sharing answer known |
| 15:00–19:00 | Make away/back reliable: test with glancing at your phone, turning to a colleague, leaning back. Tune thresholds; no flicker (hysteresis). Tune `MOUTH_MOVING` so talking = active, smiling/yawning ≠ active. | 10 tries, ≥ 8 correct, no flicker |
| 20:00–02:00 | Camera health: `frozen` (compare consecutive frames on a 64×48 canvas), `brightness` (mean luma of the same canvas), `faceInFrame`. Emit `CAMERA_FROZEN` / `LOW_LIGHT`. Add a 10 s neutral-face calibration (store baseline blendshapes). | D's check-up shows real values |
| 02:00–09:00 (P1) | Gestures: nod = two pitch reversals of ±8–10° within ~1.2 s; shake = same on yaw; brow raise = `browInnerUp` ≈ +0.3 over baseline held 300–500 ms; tilt = ±15° roll held 400 ms. Cooldown ~1 s. | 8/10 correct per gesture after calibration |
| If UI stutters | Move the landmarker into a Web Worker. | UI smooth |

## How to test alone
- **Start camera** → watch events appear in the Activity log (`USER_AWAY`, `MOUTH_MOVING`…).
- Combine with the dev text box: look away, type a few lines "said in the call", type a line with the name → the "while you were away" card should appear.

## Pitfalls
- Head-pose signs depend on the matrix layout (column-major 4×4). Verify physically; compare with `vladmandic/human` `src/face/angles.ts` (MIT).
- Emit events **on change**, not every frame (the log and the agent will drown).
- Lighting at the venue differs from home: re-test on Saturday evening in the demo room.
- Research notes with thresholds and repos: `docs/research/build/face_gestures_and_glue.md`.

## Agent directives (paste to your AI coding agent)
```
I am person A (vision) on the Tap project. Read AGENTS.md and docs/team/A-vision.md first.
You may edit ONLY app/src/renderer/src/vision.ts and new files under app/src/renderer/src/vision/.
Do not edit app/src/shared/events.ts, anything in app/src/main/, or the UI files (main.ts, overlay.ts, *.html, style.css).
Use @mediapipe/tasks-vision (already installed; wasm and model are served locally from 'mediapipe/wasm' and 'models/face_landmarker.task').
Emit only event types that already exist in events.ts, via window.tap.emit(makeEvent(...)), and only when a state changes.
Keep the cameraHealth() fields exactly as they are (D reads them).
Thresholds must be named constants at the top of the file so I can tune them.
After each change run: cd app && npm run typecheck && npm test. Tell me what I must test by hand with the camera.
```
