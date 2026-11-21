# Tap: reusable open-source code for face/head gestures, camera/mic health checks, and UI/integration glue

Scope: LauzHack 2026, team of 4, 24-hour build, Windows laptops, TypeScript in browser/Electron with optional Python. Current as of 2026-11-21. Version numbers come from live `npm view`, the PyPI JSON API and the GitHub REST API, all queried on 2026-11-21. Hour estimates are my own and are labelled as inferences.

## Q1. MediaPipe Face Landmarker on the web (@mediapipe/tasks-vision): blendshapes, head pose, workers, performance, nod/shake/eyebrow detection, calibration

### Takeaway
`@mediapipe/tasks-vision` (Apache-2.0, v1.2.3, published 2026-11-20) gives 52 blendshape scores and a 4x4 facial transformation matrix per frame from a single `detectForVideo` call. Eyebrow raise, jaw-open and blink come straight from the blendshapes. Nod, shake and tilt have no off-the-shelf JS library, so Tap needs a small hand-written classifier on pitch/yaw/roll taken from the matrix. That classifier is about 3 to 5 hours of work. The rotation-to-Euler code in `@vladmandic/human` (MIT) can be reused for it.

### Cited Findings
- **Package and version.** `@mediapipe/tasks-vision` is at version 1.2.3, licence Apache-2.0, registry entry last modified 2026-11-20 (from `npm view` on 2026-11-21). Older third-party snapshots disagree: Socket lists 0.10.20 and unpkg indexes 0.10.35. The 0.10.x line is superseded. — [npm](https://npmjs.com/package/@mediapipe/tasks-vision); [unpkg 0.10.35](https://app.unpkg.com/@mediapipe/tasks-vision@0.10.35/files/README.md); [jsDelivr 1.2.3 README](https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/README.md)
- **Python package.** `mediapipe` on PyPI is also at 1.2.3 (PyPI JSON API, 2026-11-21). — [PyPI](https://pypi.org/project/mediapipe/)
- **Configuration options:**
  - `runningMode` takes `IMAGE` or `VIDEO`; use `VIDEO` for a live camera.
  - `outputFaceBlendshapes` outputs 52 expression scores (default false).
  - `outputFacialTransformationMatrixes` outputs the 4x4 matrix from canonical face coordinates to the detected face (default false).
  - The examples set `baseOptions: { modelAssetPath, delegate: "GPU" }` and `numFaces: 1`.
  - Source: [MediaPipe Face Landmarker web guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)
- **Render loop pattern.** Call `faceLandmarker.detectForVideo(video, performance.now())` inside `requestAnimationFrame`. Only process when `video.currentTime !== lastVideoTime` and `video.readyState >= 2`. Timestamps must increase monotonically. — [web guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)
- **Assets:**
  - WASM CDN: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm`.
  - Model: `https://huggingface.co/litert-community/MediaPipe-FaceLandmarker/resolve/main/face_landmarker.task`. The old storage.googleapis.com path has been replaced by Hugging Face in the docs.
  - Source: [web guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)
- **Official demos:**
  - Live demo: https://google-ai-edge.github.io/mediapipe-samples-web/#/vision/face_landmarker
  - Runnable StackBlitz: https://stackblitz.com/github/google-ai-edge/mediapipe-samples-web?file=src/tasks/face-landmarker.ts
  - Repo `google-ai-edge/mediapipe-samples-web` is Apache-2.0 and was last pushed 2026-11-21, so it is actively maintained. The current web guide does not link a CodePen.
  - Sources: [web guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js); [GitHub API metadata](https://github.com/google-ai-edge/mediapipe-samples-web)
- **Other samples.** Android and Python (Colab) samples live in `google-ai-edge/mediapipe-samples/examples/face_landmarker/`. — [mediapipe-samples](https://github.com/google-ai-edge/mediapipe-samples/tree/main/examples/face_landmarker/android)
- **Web workers.** GitHub issue #5169 asks for an "Example of using Web Worker for FaceLandmarker", which suggests there is no official worker sample. I could not confirm whether it has been resolved. — [mediapipe issue #5169](https://github.com/google-ai-edge/mediapipe/issues/5169)
- **Head pose from the matrix.** `@vladmandic/human` has `src/face/angles.ts`, which contains `rotationMatrixToEulerAngle(r)`. It computes `thetaZ = atan2(r10, cosThetaZ)`, `thetaY = atan2(-r20, r00)` and `thetaX = atan2(-r12, r11)`, with gimbal-lock branches. It also has `calculateFaceAngle(face, imageSize)`. An earlier version multiplied the angles by 2, so check sign and scale on real data. — [human angles.ts v3.3.6](https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/src/face/angles.ts); [search summary noting the x2 change](https://unpkg.com/@vladmandic/human@2.6.1/src/face/angles.ts)
- **Euler convention caveat.** Many papers "failed to provide clear definitions of the coordinate systems and Euler angle orders", and yaw/pitch/roll values depend on the order the rotations are applied in. — [arXiv 2403.18104](https://arxiv.org/abs/2403.18104)
- **Older approach without the matrix.** A 2022 write-up estimated pose with OpenCV.js `solvePnP`, then Rodrigues, then Euler angles, because the legacy JS Solution API lacked `enableFaceGeometry`. The tasks-vision matrix makes this unnecessary. — [Medium, Thierfelder](https://medium.com/@susanne.thierfelder/head-pose-estimation-with-mediapipe-and-opencv-in-javascript-c87980df3acb)
- **Nod/shake: Nodding Pigeon** (`bhky/head-gesture-detection`, now redirects to `bhky/nodding-pigeon`):
  - Licence MIT, last push 2025-01-24, Python 3.8 to 3.10, needs TensorFlow.
  - Model: a "very simple 1D-convolutional model" over MediaPipe landmarks with a 60-frame window.
  - Outputs: `has_motion`, `nodding` and `turning` probabilities, giving labels nodding / turning / stationary / undefined.
  - API: `predict_video(..., motion_threshold=0.5, gesture_threshold=0.9)`; install with `pip install noddingpigeon`.
  - Sources: [repo](https://github.com/bhky/head-gesture-detection); [GitHub API](https://api.github.com/repos/bhky/head-gesture-detection)
- **Nod/shake: simple heuristic.** A Hugging Face Space (Python) tracks the nose-tip coordinates and compares vertical against horizontal frame-to-frame motion to classify nod or shake. — [HF Space headnod main.py](https://huggingface.co/spaces/Shees7/headnod/blob/main/main.py)
- **No JS nod/shake repo found.** A search turned up no maintained JavaScript repo that does nod/shake with tasks-vision. — [search result set](https://github.com/bhky/head-gesture-detection)
- **Blendshape behaviour:**
  - `browInnerUp` sits near zero at rest in the docs example output.
  - Left/right blendshapes refer to the subject's own face, and a mirrored input image inverts them.
  - One tutorial suggests 0.6 for `eyeBlink` and decaying values to zero when no face is detected.
  - I found no official guidance on brow thresholds.
  - Sources: [web guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js); [Three.js From Zero facial capture article](https://masterallarts.pages.dev/learn/threejs-from-zero/s3-09-facial-capture/)
- **Kalidokit.** Its FaceSolver derives brow and mouth values from MediaPipe landmarks and is a possible helper. I did not verify its licence or calibration code. — [kalidokit fork](https://github.com/AUFEfzx/kalidokit)

### Inferences
- **Pipeline.** One `FaceLandmarker` running in VIDEO mode on the GPU delegate, with `numFaces: 1` and both outputs enabled. Read the 3x3 rotation block of `facialTransformationMatrixes[0].data`, which is column-major, so verify the layout. Convert it to pitch/yaw/roll with the human `rotationMatrixToEulerAngle` code (MIT, keep the attribution).
- **Suggested starting thresholds.** These are my own guesses, not sourced, and should be tuned during a 3 to 5 second neutral calibration.
  - Eyebrow raise (raise hand): `browInnerUp` minus its calibrated baseline above roughly 0.3, plus the mean of `browOuterUpLeft/Right` rising, held for 300 to 500 ms. The 500 ms matches Gameface's `hold_trigger_ms`.
  - Nod (yes): within a 1 to 1.5 s window, pitch crosses ±8 to 10° from baseline at least twice in alternating directions, while yaw stays under half the pitch amplitude.
  - Shake (no): the same rule on yaw, with pitch kept small.
  - Tilt left/right (option pick): roll beyond ±15° held for 400 ms, with yaw and pitch near neutral.
  - Mouth moving: the variance of `jawOpen` (or `mouthClose`) over a 1 s window exceeds a threshold. This feeds the "mouth moving but mic silent" check.
  - Looking away: |yaw| above about 25 to 30° or |pitch| above about 20° for more than 2 s, or no face detected. The `eyeLookOut*` / `eyeLookIn*` blendshapes can add gaze direction.
- **Signal processing.** Use an EMA or the Gameface-style smoothing kernel. Add hysteresis (enter above T, exit below 0.7T) and a refractory period of about 1 s after each gesture so a nod is not also read as an eyebrow raise. Suppress gesture output while the user is talking (high `jawOpen` variance).
- **Python models.** Nodding Pigeon needs TensorFlow, which is heavy to run beside Electron on Windows. Use it only as an algorithm reference. The heuristic is faster to build and easier to demo.
- **Performance.** Run on the main thread or renderer at 30 fps with the GPU delegate and only try a worker if frames drop. With no official worker sample (issue #5169), a worker costs an estimated 2 to 3 extra hours (OffscreenCanvas/ImageBitmap transfer).
- **Effort estimates:**
  - Landmarker plus blendshape and pose readout: 2 h.
  - Gesture state machine plus calibration: 4 to 6 h.
  - Tuning and testing on 4 team members: 2 to 3 h.

### Gaps
- I found no published FPS or latency benchmark for Face Landmarker web on Windows laptops; measure it on the team's machines.
- I could not confirm the memory layout (row- or column-major) of the facial transformation matrix in the JS API from the fetched docs.
- I did not verify release notes for what changed between 0.10.x and 1.x of tasks-vision, so check for API breaks before copying 0.10-era code.
- No MediaPipe CodePen link was found on the current docs page; the old CodePen may still exist, but I did not verify it.

## Q2. Google Project Gameface: licence, gesture-to-action mapping, thresholds, reusable code

### Takeaway
Gameface is Apache-2.0 but was archived on 2025-09-05. Its Windows folder is a Python 3.9 app with a clean pattern worth copying: per-gesture thresholds from 0 to 1, a "single" or "hold" trigger type, latched state, and blendshape smoothing over a ring buffer. Port the pattern to TypeScript (about 1 to 2 h) rather than running the code.

### Cited Findings
- **Status and structure.** Licence Apache-2.0; repo archived (read-only) on 2025-09-05; folders `Android/` and `Windows/`; uses MediaPipe Face Landmarker, BlazeFace, FaceMesh V2 and Blendshape V2. — [google/project-gameface](https://github.com/google/project-gameface)
- **Windows app.**
  - Python 3.9 with `run_app.py`, `build.spec` (PyInstaller), `configs/`, `assets/` and `src/`.
  - Bindings use the format `gesture_name: [device_name, action_name, threshold, trigger_type]`, where the device is mouse or keyboard, the threshold runs from 0.0 to 1.0, and the trigger type is "single" or "hold".
  - Sources: [Windows README](https://github.com/google/project-gameface/tree/main/Windows)
- **Defaults.**
  - `configs/default/cursor.json` holds `fix_width` 640, `fix_height` 480, `tracking_vert_idxs` [8], `spd_*` 40, `pointer_smooth` 6, `shape_smooth` 10, `tick_interval_ms` 16, `hold_trigger_ms` 500 and `use_transformation_matrix` false.
  - The default `mouse_bindings.json` and `keyboard_bindings.json` are empty `{}`, so there are no shipped default thresholds.
  - Sources: [cursor.json](https://raw.githubusercontent.com/google/project-gameface/main/Windows/configs/default/cursor.json); [mouse_bindings.json](https://raw.githubusercontent.com/google/project-gameface/main/Windows/configs/default/mouse_bindings.json)
- **`src/shape_list.py`** maps the 52 blendshapes to friendly names with left and right swapped: "Raise left eyebrow", "Raise right eyebrow", "Open mouth" for jawOpen, "Mouth left/right", and so on. It also lists available actions: mouse left/right/middle click, pause, reset to center, and cycle monitors. — [shape_list.py](https://raw.githubusercontent.com/google/project-gameface/main/Windows/src/shape_list.py)
- **`src/controllers/keybinder.py`.**
  - `act(blendshape_values)` iterates the bindings. A trigger fires when `val > thres` and the latched state is False; it releases when `val < thres`.
  - `mouse_action` implements hold mode by timing `start_hold_ts` against `hold_trigger_ms`.
  - Source: [keybinder.py](https://github.com/google/project-gameface/blob/main/Windows/src/controllers/keybinder.py)
- **`src/detectors/facemesh.py`.**
  - Enables `output_face_blendshapes` and `output_facial_transformation_matrixes`.
  - Keeps a rolling `blendshapes_buffer` smoothed by `utils.calc_smooth_kernel(shape_smooth)`.
  - When `use_transformation_matrix` is set, it computes the head direction by taking the SVD of `M[:3,:3]` to get a rotation and multiplying by [0,0,1].
  - Source: [facemesh.py](https://github.com/google/project-gameface/blob/main/Windows/src/detectors/facemesh.py)

### Inferences
- **What to reuse.**
  - The binding schema `{gesture: [action, threshold, single|hold]}` as Tap's gesture config format.
  - The friendly names in shape_list.py for the settings UI.
  - The SVD orthonormalisation trick, which makes the rotation robust before Euler conversion.
- **Licensing.** Apache-2.0 allows copying with NOTICE/attribution. Because the repo is archived, do not expect fixes.
- **Gaps in the Gameface approach.** Gameface uses a single threshold with no hysteresis and no temporal gestures (nod/shake), so those still have to be added.

### Gaps
- I did not inspect the Android code or `utils.calc_smooth_kernel` in detail.
- There is no official recommended threshold for any blendshape in Gameface's defaults.

## Q3. Other accessibility face-control projects (Enable Viacam/eViacam, Handsfree.js, vladmandic/human, FaceMouse)

### Takeaway
`vladmandic/human` (MIT, active, last push 2025-12) is the only one worth borrowing code from, specifically its head-angle maths. eViacam is GPL-3.0 and dormant since 2023, so treat it as inspiration only and do not copy its code. Handsfree.js is stale (npm last modified 2022). Tap should build on raw tasks-vision.

### Cited Findings
- **`vladmandic/human`:** MIT, about 3.4k stars, not archived, last push 2025-12-13. npm `@vladmandic/human` is at 3.3.6 (modified 2025-08-26). It contains `src/face/angles.ts` with `calculateFaceAngle` and `rotationMatrixToEulerAngle`. — [GitHub API](https://github.com/vladmandic/human); [angles.ts](https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/src/face/angles.ts)
- **`cmauri/eviacam` (Enable Viacam):** GPL-3.0, about 175 stars, last push 2023-02-22. — [GitHub API](https://github.com/cmauri/eviacam)
- **Handsfree.js:**
  - The npm package `handsfree` is at v8.5.1, last modified 2022-05-04.
  - GitHub forks such as `midiblocks/handsfree` are Apache-2.0 and were last pushed 2024-09.
  - The original `handsfreejs/handsfree` repo returned 404 from the GitHub API.
  - Sources: [npm handsfree](https://www.npmjs.com/package/handsfree); [midiblocks/handsfree](https://github.com/midiblocks/handsfree)

### Inferences
- **GPL.** Avoid copying any eViacam code into a MIT/Apache project. Its ideas (dwell click, adjustable sensitivity) are fine to reimplement.
- **Handsfree.js** wraps old MediaPipe/legacy models, so integrating it would cost more than writing directly against tasks-vision.

### Gaps
- FaceMouse: no reliable repo found in this pass.
- I did not evaluate other face-control repos (e.g. Talon or Precision Gaze Mouse) for licence or relevance.

## Q4. Camera/mic health checks in the browser

### Takeaway
webrtc/samples (BSD-3-Clause, actively maintained, last push 2026-11-04) provides a copy-ready mic RMS meter in two files, `soundmeter.js` and `volume-meter-processor.js` (AudioWorklet), plus device-enumeration samples. There is no library for frozen-frame detection; the accepted method is downscaled canvas frame differencing combined with track `mute`/`ended` events. Low light and face-out-of-frame checks are a few lines on the same downscaled canvas plus the landmarker result. Total effort is about 3 to 4 h.

### Cited Findings
- **webrtc/samples:** BSD-3-Clause, about 14.6k stars, last push 2026-11-04. — [GitHub API](https://github.com/webrtc/samples)
  - `src/content/getusermedia/` has `audio`, `canvas`, `exposure`, `gum`, `resolution`, `source` and `volume`.
  - `src/content/devices/` has `input-output` and `multi`.
  - Source: [GitHub contents API](https://github.com/webrtc/samples/tree/gh-pages/src/content)
- **Mic meter code** (`volume/js/volume-meter-processor.js`):
  - An `AudioWorkletProcessor` computes `instant = sqrt(sum(x^2)/N)` over each 128-sample block.
  - It reports `clip = count(|x|>0.99)/N`.
  - `soundmeter.js` keeps `slow = 0.95*slow + 0.05*instant` and connects with `context.createMediaStreamSource(stream)`, then `new AudioWorkletNode(context,'volume-meter-processor')`.
  - Sources: [soundmeter.js](https://github.com/webrtc/samples/blob/gh-pages/src/content/getusermedia/volume/js/soundmeter.js); [volume-meter-processor.js](https://github.com/webrtc/samples/blob/gh-pages/src/content/getusermedia/volume/js/volume-meter-processor.js)
- **Frozen frames: track state is not enough.** A WebKit bug describes video that looks frozen while the track is enabled, unmuted and live. The reporter suggests checking canvas `getImageData()` for changing RGBA. — [WebKit bug 194802](https://bugs.webkit.org/show_bug.cgi?id=194802)
- **Frozen frames: pixel sampling in practice.** A Zoom developer forum post samples fixed pixel positions over time to detect freezes. — [Zoom devforum](https://devforum.zoom.us/t/is-there-a-way-to-detect-canvas-video-freezes/134123)
- **Frame differencing.** Tutorials use a downscaled canvas (for example 64x48) with the `difference` composite mode, plus a per-pixel threshold and a changed-pixel count, to suppress sensor noise. — [codersblock motion detection](https://codersblock.com/blog/motion-detection-with-javascript/); [Tim Taubert getUserMedia part 3](https://timtaubert.de/blog/2013/02/getusermedia-part-3-simple-motion-detection-in-a-live-video/)
- **Muted tracks.** Per the W3C Media Capture spec, tracks can become `muted`, for example when overconstrained. Listen to the track `mute`/`unmute`/`ended` events as a separate health signal. — [W3C mediacapture-streams](https://www.w3.org/TR/2017/CR-mediacapture-streams-20171003)

### Inferences
- **Frozen camera.**
  - Use `video.requestVideoFrameCallback` if available, otherwise a 250 ms timer.
  - Draw each frame to a 64x48 canvas and compute the mean absolute difference from the previous frame.
  - Flag "frozen" if the difference stays near 0 (for example below 0.5 on a 0 to 255 scale) for at least 3 s, or if the frame callback stops firing, while `track.readyState === 'live'`.
  - Also flag a frozen camera when MediaPipe landmarks stay bit-identical. A real face is never perfectly still, so this is a strong signal.
- **Low light / backlight.**
  - Compute mean luminance, Y = 0.299R + 0.587G + 0.114B, on the 64x48 frame. Warn when it is under about 50/255.
  - For backlight, compare the luminance inside the face bounding box (from landmarks) with the whole frame. A face more than 40 to 50 points darker than the frame suggests backlight.
  - These thresholds are suggestions to tune.
- **Face out of frame.** Flag no `faceLandmarks` for more than 1.5 s, or a landmark bounding box touching the frame edges.
- **Mouth moving but mic silent.**
  - Condition: `jawOpen` variance is high over 1 to 2 s while the RMS `slow` value stays below a calibrated noise floor (for example under 0.01), or `track.muted`/`enabled === false`.
  - Prompt "You seem to be talking but your mic is silent" after 2 to 3 s.
  - Caveat: Tap's own capture of the mic is separate from Zoom's. Zoom's in-app mute is not visible to Tap, so this can only detect a silent device, not a Zoom mute.
- **Device changes.** Listen to `navigator.mediaDevices.ondevicechange`, re-run `enumerateDevices()` and log the change in the activity log. The webrtc `devices/input-output` sample shows the enumeration pattern.

### Gaps
- I did not fetch the code of the `devices/input-output` sample itself.
- I found no source quantifying luminance thresholds for "too dark" on webcams.
- I did not confirm whether Chrome on Windows still allows the same camera to be opened by both Tap and Zoom at once. Usually it does, but this needs a test on the team's machines.

## Q5. UI glue: always-on-top overlay, recap card/toasts, WebSocket bridge, OBS Virtual Camera, TTS into calls, starter templates

### Takeaway
- **Starter and overlay.** Use electron-vite (MIT, v6.0.0) or electron-vite-react (MIT) on Electron 45.4.1. Create a frameless, transparent `BrowserWindow`, call `setAlwaysOnTop(true, 'screen-saver')`, and pair `setIgnoreMouseEvents(true, {forward:true})` with hover toggling. This takes about 2 to 3 h.
- **Haptics bridge.** Use the `ws` package (v8.23.0) in the Electron main process, or `websockets` (v17.4) in Python.
- **In-call display.** An OBS Browser Source with Virtual Camera shows the recap inside Zoom/Meet. The page needs a fully transparent background, and the browser source can add noticeable CPU load.
- **TTS into a call.** VB-CABLE is donationware and redistributable with attribution.

### Cited Findings
- **Live versions** (`npm view` / PyPI, 2026-11-21):
  - `electron` 45.4.1
  - `electron-vite` 6.0.0 (MIT)
  - `ws` 8.23.0
  - `@tauri-apps/api` 2.12.5
  - `sonner` (toast library) 2.0.8 (MIT)
  - Python `websockets` 17.4
  - Sources: [npm electron](https://www.npmjs.com/package/electron); [npm electron-vite](https://www.npmjs.com/package/electron-vite); [npm ws](https://www.npmjs.com/package/ws); [npm sonner](https://www.npmjs.com/package/sonner); [PyPI websockets](https://pypi.org/project/websockets/)
- **Starter templates.**
  - `alex8088/electron-vite`: MIT, about 5.6k stars, last push 2026-10-14.
  - `electron-vite/electron-vite-react`: MIT, about 2.4k stars, last push 2026-09-01.
  - Sources: [alex8088/electron-vite](https://github.com/alex8088/electron-vite); [electron-vite-react](https://github.com/electron-vite/electron-vite-react)
- **Click-through limits.** Electron docs say you cannot click through the transparent area of a transparent window (issue #1335). `win.setIgnoreMouseEvents(true)` ignores all mouse events. With `{forward: true}` on Windows and macOS, mouse-move events still reach the page, so `mouseenter`/`mouseleave` can toggle ignoring off over interactive regions. — [Electron window customization](https://www.electronjs.org/docs/latest/tutorial/window-customization); [electron#1335](https://github.com/electron/electron/issues/1335)
- **Stacking level.** `setAlwaysOnTop(true, 'screen-saver', 1)` is a commonly used level that stays above full-screen apps. — [gist example](https://gist.github.com/clytras/8c8e01f4132991df15f1f5e3f2619135); [levelup write-up](https://levelup.gitconnected.com/how-i-made-a-desktop-app-invisible-to-screen-sharing-electron-os-level-tricks-5734513c1e67)
- **Unverified regression report.** One informal note reports that `forward` click-through was unreliable and that a GPU-disable workaround broke around Electron 38 (Chromium 139, June 2025). This is unverified and should be tested on Electron 45. — [click-through research note](https://tangled.org/burrito.space/peek/blob/main/notes/click-through-research.md)
- **Hiding from screen share.** A write-up shows how to keep the overlay out of screen shares using OS-level tricks (`setContentProtection`). — [levelup write-up](https://levelup.gitconnected.com/how-i-made-a-desktop-app-invisible-to-screen-sharing-electron-os-level-tricks-5734513c1e67)
- **OBS route.**
  - Add a Browser Source with the URL, start the Virtual Camera, then select "OBS Virtual Camera" in Zoom, Meet or Teams.
  - Source: [OBS virtual camera guide](https://www.obsbot.com/blog/camera/obs-virtual-camera); [UT Austin wiki](https://cloud.wikis.utexas.edu/wiki/spaces/comm/pages/33425602/Install+OBS+as+a+virtual+video+switcher+feeding+Zoom)
  - **Transparency:** both the OBS custom CSS background and the HTML page must have no background, or the overlay hides the video. — [OBS forum](https://obsproject.com/forum/threads/translucent-transparent-browser-source.59549)
  - **CPU:** one report saw OBS CPU rise from 4-5% to 35-40% after adding a simple browser source. — [OBS forum](https://obsproject.com/forum/threads/adding-one-brower-source-multiplies-the-cpu-usage.132195/)
  - **Mirroring:** calling apps mirror only your own preview, so text in the overlay reads correctly to other participants. — [search summary, Duo Labs](https://duo.com/labs/tech-notes/leveling-up-your-video-conferencing-with-obs)
- **VB-CABLE:**
  - It is a Windows virtual audio driver and donationware; users choose the price.
  - It may be distributed with free or commercial apps if it stays identified as a VB-Audio product, the user can donate, and the origin www.vb-cable.com is cited.
  - Licences are non-exclusive and personal.
  - Sources: [VB-Audio licensing](https://www.vb-audio.com/Services/licensing.htm); [VB-CABLE page](https://vb-audio.com/Cable/); [terms of use](https://shop.vb-audio.com/en/content/3-Terms-of-use)

### Inferences
- **Overlay window recipe.**
  - Options: `new BrowserWindow({ transparent:true, frame:false, alwaysOnTop:true, skipTaskbar:true, focusable:false, resizable:false })`.
  - Then call `win.setAlwaysOnTop(true,'screen-saver')` and `win.setVisibleOnAllWorkspaces(true)`.
  - Toggle `setIgnoreMouseEvents(true,{forward:true})` from the renderer over IPC on `mouseenter`/`mouseleave` of the card.
  - Keep the recap card small (for example 360x160 px) and anchor it bottom-right using `screen.getPrimaryDisplay().workArea`.
  - Effort: about 2 h, plus 1 h for click-through bugs.
- **Tauri** (v2) is an alternative with a smaller binary. It needs Rust on Windows laptops, and the team is TypeScript-first, so Electron is the safer 24-hour choice.
- **Recap card and toasts.** Use a React component with Sonner (MIT) for transient toasts ("Hand raised", "Yes sent"). Show a persistent recap card with the last N events and the current health state. The activity log is a virtualised list with timestamp, source (gesture/health/agent), action and result, persisted to JSON in `app.getPath('userData')`.
- **WebSocket bridge to the Logitech haptics plugin.**
  - Run a `ws` server in the Electron main process, bound to 127.0.0.1 only, never 0.0.0.0, on a fixed port.
  - Use JSON messages `{type, id, ts, payload}` with a heartbeat ping every 5 s and auto-reconnect with backoff on the client side.
  - Check the `Origin` header and use a shared token to reject other local web pages; any website can open a WebSocket to localhost.
  - If the Logitech plugin is the server, Tap connects as a client instead. The protocol shape stays the same.
- **TTS into the call.**
  - Use `speechSynthesis` in the browser, or render audio and play it via an `<audio>` element.
  - Route it with `HTMLMediaElement.setSinkId(deviceId_of_"CABLE Input")` and select "CABLE Output" as the mic in Zoom.
  - The user then loses their real mic unless they also use Voicemeeter or Zoom's "original sound"; this is an important UX caveat.
  - Web Speech API voices cannot be routed with `setSinkId`, because `speechSynthesis` goes to the default output. Generate audio another way (a TTS service or local engine into an AudioBuffer) if routing is required. This is unverified and needs a test.
- **Choosing between OBS and the overlay.** The always-on-top overlay is for the user, and OBS Virtual Camera is for other participants to see Tap's reactions. OBS adds setup friction, so for the demo prefer one pre-configured laptop.
- **Effort estimates:**
  - Electron overlay plus recap card: 3 to 4 h.
  - WebSocket bridge: 1 to 2 h.
  - OBS demo setup: 1 h.
  - VB-CABLE TTS: 2 h, plus testing.

### Gaps
- I did not verify, on Electron 45, whether `setIgnoreMouseEvents` forwarding is stable on Windows 11.
- I found no source confirming whether `setSinkId` can target VB-CABLE from Electron, or whether `speechSynthesis` output can be routed.
- The Logitech haptics plugin's WebSocket protocol is out of scope here and covered by other notes.

## Q6. Agent safety: allowlisted tool execution, prompt-injection defence for voice/transcript input, audit log UI

### Takeaway
No mature OSS library cleanly provides tool allowlisting; that part is best hand-rolled as a static map of permitted actions with schema validation and user confirmation. Detection libraries exist: prompt-shield-ai (Python) and StackOne Defender (npm). LLM Guard was reportedly archived in July 2026. These are optional extras, not substitutes for structural controls.

### Cited Findings
- **prompt-shield-ai** (PyPI, v0.7.x) is a "prompt injection firewall" with a DeBERTa classifier and tool-result injection scanners (code injection, prompt leakage, PII, schema validation, jailbreak). — [PyPI prompt-shield-ai](https://pypi.org/project/prompt-shield-ai/0.7.3/)
- **StackOne Defender** is an npm library that scans tool responses for injection. It claims 88.7% detection accuracy on CPU, which is a vendor self-benchmark. — [StackOne changelog](https://www.stackone.com/changelog/announcing-stackone-defender-against-prompt-injection/)
- **Other frameworks.** Guardrails AI (output/schema validation) and NeMo Guardrails (policy/dialog flows) are general guardrail frameworks. A 2026 review says LLM Guard was archived in July 2026. — [Lyzr blog (vendor)](https://www.lyzr.ai/blog/best-tools-for-prompt-injection-defense/)
- **PromptArmor** uses a guardrail LLM to detect and remove injected content from agent inputs. — [arXiv 2507.15219](https://arxiv.org/pdf/2507.15219)
- **AutoDojo** is a 2026 generative benchmark for prompt-injection defences in LLM agents. — [arXiv 2606.15057](https://arxiv.org/pdf/2606.15057)

### Inferences
- **Reference design for Tap**, which I recommend over adding a library in 24 h:
  - Treat transcript and voice text strictly as data. Wrap it in delimiters and never let it pick tools freely.
  - The LLM may only output one of an enum of intents (`suggest_reply`, `summarise`, `none`), validated with zod or JSON schema. Anything else is dropped.
  - Side-effecting actions (sending chat, TTS, haptics) run only after a user gesture confirms them; the human stays in the loop.
  - Rate-limit actions (for example at most 1 per 3 s).
  - Write every proposed and executed action to the activity log with its source and any rejection reason. This doubles as the audit log UI from Q5.
- **Optional detector.** StackOne Defender (npm) could screen transcript chunks. Its accuracy figures are self-reported, so treat it as a signal, not a gate.
- **Effort estimates:** allowlist, schema validation and confirmation take 2 to 3 h; the audit log UI is shared with the activity log (1 to 2 h).

### Gaps
- I found no OSS library dedicated to tool allowlisting for agents, nor one aimed specifically at speech-transcript injection.
- I did not verify the licences for prompt-shield-ai or StackOne Defender.
- I did not independently confirm that LLM Guard is archived; the only source is a vendor blog.
