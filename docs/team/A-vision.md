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
| `USER_AWAY` | `{ reason: 'turned_away' \| 'no_face' }` | yaw > 28 deg or pitch > 22 deg (phone glance) or no face, for > 2 s; exit only below 18 / 14 deg (hysteresis) |
| `USER_BACK` | — | face back towards the screen |
| `MOUTH_MOVING` | `{ active: boolean }` | only when it changes; only while face and abs(yaw) < 28 deg, abs(pitch) < 22 deg; forced false outside that range |
| `FACE_OUT_OF_FRAME` | — | no face detected — **baseline: only emitted together with `USER_AWAY` (reason `no_face`)** |
| `CAMERA_FROZEN` | — | frames identical for > 3 s — **not implemented in the baseline** |
| `LOW_LIGHT` | `{ brightness }` | mean brightness too low — **not implemented in the baseline** |
| `GESTURE_NOD` / `_SHAKE` / `_BROW_RAISE` / `_TILT_LEFT` / `_TILT_RIGHT` (P1) | `{ confidence }` | once per gesture, then ~1 s cooldown |

You also keep **`cameraHealth()`** (in `vision.ts`) up to date: `{ running, faceInFrame, frozen, brightness, fps }`. **D's check-up screen reads it**, so don't rename its fields.

> **Baseline today:** `frozen` is always `false` and `brightness` is always `null` — the frozen-frame and low-light detectors are **not implemented** (they are parked, with the other vision hardening, in a local stash). D's check-up must not present those two as "pass".

Who uses your events: C's agent (away summary P0-3, mic-silent P0-4, gestures P1-1), D's check-up (P0-5).

## Spike result — camera & performance (Sat, demo laptop)

**Hardware:** Logitech LVNext devkit, USB `046D:094F`: one composite device with RGB (`MI_00`), Windows Hello IR (`MI_02`), CPD (`MI_04`), microphone (`MI_06`), HID (`MI_08`) and a USB network interface (`MI_09`). That layout *resembles* the LogiInsight-class camera described in PRD section 5 / P2-7, but **do not assume it is the same product** - confirm with the Logitech booth.

**Performance:** **about 60 fps (58-63) with Tap alone, 51 fps with Zoom running, 51 fps with Google Meet** (`cameraHealth().fps`; the value is recomputed every second, so it moves a little). Face in frame, GPU delegate active (no `GPU delegate unavailable` warning). That is more than 3x the 15 fps gate; UI fps was not measured separately. The camera advertises YUY2/MJPG/NV12 from 640x480 up to 4K (up to 240 fps at 640x480); throttling to ~30 fps is possible later to save heat, but nothing needs it today.

**Camera sharing (the Block-2 answer):** out of the box the RGB interface is **single-consumer** — Zoom/Meet/Windows Camera fail while Tap holds it, and the IR interface keeps working because it is a separate USB interface. **Fixed** with Windows 11 → Settings → Bluetooth & devices → Cameras → **LVNext Camera** → Advanced camera options → **"Allow multiple apps to use camera at the same time"**. Verified: Zoom + Tap live at the same time. Keep this setting on the demo laptop and re-check after Windows/driver updates.
If it ever resets: (1) Tap owns the RGB camera and the call runs camera-off (a second laptop joins with video), (2) the call uses the IR or CPD camera, (3) OBS Virtual Camera as last resort (not installed — avoid).

**Demo consequence:** the current (baseline) away detector only watches **yaw** — rehearse PRD §10 step 2 by turning the head **sideways** (not just glancing down) until `USER_AWAY` fires.

## Tasks, in order
| When | Task | Done when |
|---|---|---|
| Sat 12:00–13:00 | `npm install`, `npm run dev`, click **Start camera**. Turn your head left/right/up/down and check the yaw/pitch/roll readout has sensible signs (fix `headPose()` if not). | Readout moves the right way |
| 13:00-15:00 **spike** (done) | 1) Measure FPS (`cameraHealth().fps`) on the demo laptop **while Zoom/Meet runs**: **about 60 fps with Tap alone, 51 fps with Zoom/Meet running** - more than 3x the 15 fps gate. 2) **Critical test: can Zoom and Tap use the webcam at the same time?** - **done**: RGB is single-consumer by default, fixed by the Windows 11 multi-app camera setting (verified: Zoom + Tap live together). | FPS >= 15 (verified under Zoom/Meet load) and camera-sharing answer known (done) |
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
- Looking down at a phone/keyboard: yaw alone misses it; the pitch rule (> 22 deg) catches it. `jawOpen` drifts at large pitch, so `MOUTH_MOVING` is gated to abs(yaw) < 28 deg and abs(pitch) < 22 deg and forced false outside.
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
