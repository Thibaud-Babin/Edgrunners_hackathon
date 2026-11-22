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
| `MOUTH_MOVING` | `{ active: boolean }` | only when it changes; only while face and abs(yaw) < 28 deg, abs(pitch) < 22 deg; forced false outside that range; debounced 300 ms on / 800 ms off (B's request); signal = jaw + lower lip, std > 0.03 over 1 s |
| `FACE_OUT_OF_FRAME` | — | no face detected — **baseline: only emitted together with `USER_AWAY` (reason `no_face`)** |
| `CAMERA_FROZEN` | - | <= 3 of the 3072 pixels of a 64x48 frame changed for > 3 s |
| `LOW_LIGHT` | `{ brightness }` | mean luma < 60 for 0.8 s (clears above 80) |
| `GESTURE_NOD` / `_SHAKE` / `_BROW_RAISE` / `_TILT_LEFT` / `_TILT_RIGHT` (P1) | `{ confidence }` | once per gesture, then ~1 s cooldown |

You also keep **`cameraHealth()`** (in `vision.ts`) up to date: `{ running, faceInFrame, frozen, brightness, tooBright, fps }`. **D's check-up screen reads it**, so don't rename its fields.

> **Camera health method (implemented):** mean luma (0.299R + 0.587G + 0.114B) on a 64x48 frame every 250 ms. Too dark <= 60 (clears >= 80), too bright >= 190 (clears <= 170), each held 0.8 s; frozen when <= 3 of 3072 pixels change for 3 s. Thresholds validated on a labelled 8-image set (4 dark, 4 light; not committed; means 10.9-31.5 and 202.3-206.8, also asserted in health.test.ts). Bright sets cameraHealth().tooBright (no event; contract unchanged).

Who uses your events: C's agent (away summary P0-3, mic-silent P0-4, gestures P1-1), D's check-up (P0-5).

## Spike result — camera & performance (Sat, demo laptop)

**Hardware:** Logitech LVNext devkit, USB `046D:094F`: one composite device with RGB (`MI_00`), Windows Hello IR (`MI_02`), CPD (`MI_04`), microphone (`MI_06`), HID (`MI_08`) and a USB network interface (`MI_09`). That layout *resembles* the LogiInsight-class camera described in PRD section 5 / P2-7, but **do not assume it is the same product** - confirm with the Logitech booth.

**Performance:** **about 60 fps (58-63) with Tap alone, 51 fps with Zoom running, 51 fps with Google Meet** (`cameraHealth().fps`; the value is recomputed every second, so it moves a little). Face in frame, GPU delegate active (no `GPU delegate unavailable` warning). That is more than 3x the 15 fps gate; UI fps was not measured separately. The camera advertises YUY2/MJPG/NV12 from 640x480 up to 4K (up to 240 fps at 640x480); throttling to ~30 fps is possible later to save heat, but nothing needs it today.

**Camera sharing (the Block-2 answer):** out of the box the RGB interface is **single-consumer** — Zoom/Meet/Windows Camera fail while Tap holds it, and the IR interface keeps working because it is a separate USB interface. **Fixed** with Windows 11 → Settings → Bluetooth & devices → Cameras → **LVNext Camera** → Advanced camera options → **"Allow multiple apps to use camera at the same time"**. Verified: Zoom + Tap live at the same time. Keep this setting on the demo laptop and re-check after Windows/driver updates.
If it ever resets: (1) Tap owns the RGB camera and the call runs camera-off (a second laptop joins with video), (2) the call uses the IR or CPD camera, (3) OBS Virtual Camera as last resort (not installed — avoid).

**Demo consequence:** the away detector watches **yaw AND pitch**, so the phone glance triggers it. Rehearse PRD section 10 step 2 (look down at the phone) and confirm `USER_AWAY` in about **3 s in gaze mode** (1–2 s in pose fallback).

## Gaze mode - true look-away (P2, default)

The **Logi Gaze Tracker** (separate Logitech tray app) drives `USER_AWAY`/`USER_BACK` from screen gaze instead of head pose. It streams over `ws://127.0.0.1:8964`; our client lives in `vision/gaze.ts` + `vision/gazeClient.ts`.

- **Default is `gaze`**; MediaPipe remains the head-pose fallback when the tracker is unavailable.
- **D's later toggle:** import `{ getAwayMode, setAwayMode, gazeStatus }` from `./vision`; `setAwayMode('gaze' | 'pose')`; `gazeStatus()` returns `{ mode, connected, calibrated, lastSnapshotAt, lastFaceAt, lastGazeAt, activeSource, fallbackReason }`.
- **Test now without UI:** it is on by default. If a previous session saved `'pose'`, run `localStorage.setItem('tap:awayMode','gaze'); location.reload()`; back with `'pose'`.
- **Requirements:** the tracker must be running and **calibrated**, on the display where the meeting is. It opens the camera too, so the Windows multi-app camera setting must stay on.
- **Profile backup:** the tracker's rig + calibrations live in `%APPDATA%\gaze-tracker-electron\Local Storage\leveldb` (keys `logiGazeElectron.rigConfig.v1`, `logiGazeWebLib.*Weights.*`). Quit the tracker, copy that folder; restore with the app closed. It is tied to the camera/display geometry - recalibrate on another laptop. Never commit it.
- **Behaviour:** smoothed gaze (EMA 0.25) with a **64 px outward tolerance** (looking just past the panel edge is still on-screen); off-screen (or `gaze: null` with a face present) for **3 s** -> `USER_AWAY` (`reason: 'turned_away'`, `data.gaze = true`, `data.since` = first off-screen epoch); back inside for **700 ms** -> `USER_BACK`. `gaze: null` with no face is **no signal** (a blocked tracker cannot fake an away). **Agent handoff:** C uses `data.since` as `awayFrom`, so the recap starts when the user actually left, not when the 3 s hold ended.
- **Zone:** the whole tracked display. Electron cannot read another app's window rect without native code, so the meeting window is not used; run the tracker on the meeting display (multi-monitor limitation).
- **Automatic fallback:** if the tracker is not connected, uncalibrated, stale (> 3 s), or has seen no face/gaze for 3 s, the **pose detector takes over automatically** (mode stays `gaze`). `gazeStatus()` reports `activeSource` and `fallbackReason`; `vision.ts` logs a one-time `[gaze] pose fallback (...)` in the console. For the user, show a Check-up row + a one-time toast in D's UI; **do not use a haptic** (that channel is for meeting problems). Face-loss is still reported by MediaPipe as `FACE_OUT_OF_FRAME`.
- MediaPipe still runs for mouth, gestures and camera health; `FACE_OUT_OF_FRAME` is still emitted in gaze mode.

## Tasks, in order
| When | Task | Done when |
|---|---|---|
| Sat 12:00–13:00 | `npm install`, `npm run dev`, click **Start camera**. Turn your head left/right/up/down and check the yaw/pitch/roll readout has sensible signs (fix `headPose()` if not). | Readout moves the right way |
| 13:00-15:00 **spike** (done) | 1) Measure FPS (`cameraHealth().fps`) on the demo laptop **while Zoom/Meet runs**: **about 60 fps with Tap alone, 51 fps with Zoom/Meet running** - more than 3x the 15 fps gate. 2) **Critical test: can Zoom and Tap use the webcam at the same time?** - **done**: RGB is single-consumer by default, fixed by the Windows 11 multi-app camera setting (verified: Zoom + Tap live together). | FPS >= 15 (verified under Zoom/Meet load) and camera-sharing answer known (done) |
| 15:00-19:00 | Make away/back reliable: test with glancing at your phone, turning to a colleague, leaning back. Tune thresholds; no flicker (hysteresis). `MOUTH_MOVING` is debounced (300 ms on / 800 ms off) and uses the **jaw + lower lip** signal (std > **0.03** over 1 s, B's real-call value in PR #21); tune so talking = active, smiling/yawning does not (yawns/laughs accepted). A held-open mouth is intentionally not "talking". | 10 tries, >= 8 correct, no flicker |
| 20:00-02:00 | Camera health: frozen (64x48 canvas diff), brightness, tooBright, faceInFrame, `CAMERA_FROZEN` / `LOW_LIGHT` - **done** (`vision/health.ts`). Next: 10 s neutral-face calibration (needed by P1 gestures). | D's check-up shows real values |
| 02:00–09:00 (P1) | Gestures: nod = two pitch reversals of ±8–10° within ~1.2 s; shake = same on yaw; brow raise = `browInnerUp` ≈ +0.3 over baseline held 300–500 ms; tilt = ±15° roll held 400 ms. Cooldown ~1 s. | 8/10 correct per gesture after calibration |
| P2-11 (done) | Gaze mode is the default away source. Install/calibrate the Logi Gaze Tracker on the meeting display; verify the dot; `setAwayMode('pose')` switches back. | off-screen 3 s -> USER_AWAY; return -> USER_BACK/card; missing tracker -> pose fallback + status |
| If UI stutters | Move the landmarker into a Web Worker. | UI smooth |

## How to test alone
- **Start camera** → watch events appear in the Activity log (`USER_AWAY`, `MOUTH_MOVING`…).
- Combine with the dev text box: look away, type a few lines "said in the call", type a line with the name → the "while you were away" card should appear.

## Pitfalls
- Head-pose signs depend on the matrix layout (column-major 4×4). Verify physically; compare with `vladmandic/human` `src/face/angles.ts` (MIT).
- Emit events **on change**, not every frame (the log and the agent will drown).
- Lighting at the venue differs from home: re-test on Saturday evening in the demo room.
- Frozen detection assumes real sensor noise: a perfectly static virtual camera looks frozen after 3 s. Do not test with an OBS test pattern and call it a bug.
- Lighting thresholds were validated on the labelled 8-image set; re-check the venue light before the demo.
- Looking down at a phone/keyboard: yaw alone misses it; the pitch rule (> 22 deg) catches it. The mouth blendshapes drift at large pitch, so `MOUTH_MOVING` is gated to abs(yaw) < 28 deg and abs(pitch) < 22 deg and forced false outside.
- Gaze mode is only valid if the tracker is calibrated on the meeting display; calibration drifts if you move. Both apps use the camera, so the Windows multi-app setting is required.
- Gaze is noisy: the 3 s / 700 ms hysteresis and the 64 px outward tolerance are deliberate. Tune them in `vision.ts`, not in the tracker; the tracker's accuracy comes from its rig + calibration.
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
Away mode defaults to 'gaze' with automatic pose fallback; expose setAwayMode/getAwayMode/gazeStatus (activeSource/fallbackReason) for D and never use a haptic for tracker status.
After each change run: cd app && npm run typecheck && npm test. Tell me what I must test by hand with the camera.
```
