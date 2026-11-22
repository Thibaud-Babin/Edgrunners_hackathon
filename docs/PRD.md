# Tap — Product Requirements Document (LauzHack 2026)

> **Team:** 4 people · **Build window:** Sat 12:00 → Sun 12:00 (24 h) · **Judging:** Sun 12:30–15:00
> **Status:** v0.4 (security cut to the minimum, local sensing models), pre-hackathon draft, updated with the build research (Logitech docs, reusable repos, audio/STT, face gestures).
> Related: [tap-agent-design.md](tap-agent-design.md) (original agent & security design; security is now minimal, see §7) · [project-ideas.md](project-ideas.md) (why Tap) · [research/build/](research/build/) (build research notes)

---

## 1. Summary

**Tap is a meeting companion that notices what you, and IT, miss.** It runs next to any video call. The webcam, microphone and call audio are its senses; the Logitech MX Master 4 haptic mouse is its silent voice.

- When someone **says your name or asks you a question**, the mouse knocks and a card recaps the last 10 seconds.
- **Non-speaking users reply with face gestures** (eyebrows = raise hand, nod = yes, shake = no, tilt = pick a reply).
- When people say **"can you hear me?"**, Tap detects the tech problem and offers a fix, with your confirmation.
- **Local AI**: face tracking, speech-to-text and name spotting run on the laptop; only the agent's short summaries use a cloud model, and every AI call and action is logged with its cost.

**Definition of done at judging:** the 7-step demo in §10 runs live, end to end, on one laptop, at least 3 times in a row without a restart, and a backup video exists.

**Challenges targeted:** Logitech (main), IMC Tech for Good, Nexthink, AXA, plus the main ranking. LauzHack rules allow one project to win several prizes ([rules](https://lauzhack.com/pdf/rules.pdf)).

## 2. Users and problem

### Personas

| Persona | Need | What Tap gives them |
|---|---|---|
| **Léa, hard-of-hearing engineer** | Follows calls with captions, but misses the moment she is addressed when she looks away | Knock on the mouse + 10-second recap when her name or a question comes up |
| **Marc, non-speaking (speech disability) student** | Can't jump into a conversation quickly | Face-gesture replies and 3 suggested answers, spoken or posted for him |
| **Everyone, every day** | Broken audio or camera that nobody reports | Pre-call check-up, "your mic sends nothing" alert, live fix when others say "can't hear you" |
| **IT team (Nexthink)** | Can't see "silent pain" in meetings; must trust any AI agent they deploy | Anonymous, aggregated hours-lost signals + agent-health tile |

### What already exists (and why Tap is different)

| What | Exists | Tap's difference |
|---|---|---|
| Name alert for deaf users | Apple Name Recognition, iOS 26 ([source](https://maketecheasier.com/iphone-name-recognition-feature/)) | Apple listens to the room mic → misses names said **in a call heard through headphones**; no recap, no question detection, no reply |
| Live captions | Teams, Zoom, Meet, Live Transcribe, Ava | Captions are only an input |
| "You're talking while muted" | Teams, Zoom, Meet | Others saying "we can't hear you", frozen camera, wrong mic |
| Face-gesture control | Google Project Gameface, Apple Head Tracking | Gestures as **meeting replies**, not cursor control |
| Haptics in meetings | Logitech Zoom plugin (vibrates on "raise hand") | A full haptic vocabulary driven by AI events |
| IT agent | Nexthink Spark (device telemetry) | Signals from what people **say** and the camera **sees** |

**Pitch line:** *"Apple does this for the room; Tap does it for the call — and lets you answer."*

## 3. Requirements

Priorities: **P0** = the demo depends on it · **P1** = should have · **P2** = stretch. Owner letters refer to §8.

### P0 — must have (≈12 h of work)

| ID | User story | Acceptance criteria | Owner |
|---|---|---|---|
| P0-1 | As Léa, I want to be alerted when my name is said in the call | Name (incl. 2 nicknames/misspellings) spoken in call audio → `knock` haptic within **≤ 1.5 s** of the word; ≥ 8/10 hits in a quiet room; ≤ 1 false alert per 5 min of unrelated speech | B, C |
| P0-2 | As Léa, I want to know what I was asked | Recap card appears with the last 10 s of transcript + a one-line summary within **≤ 3 s**; card stays until dismissed | B, C, D |
| P0-3 | As Léa, I want to catch up on what I missed while I wasn't looking | **"While you were away"**: when Tap sees the face turned away / out of frame for > 2 s (`USER_AWAY`), it starts recording the transcript of that period. When the user is **called (name) or looks back (`USER_BACK`)**, a card shows a short synthesis of everything said **from the moment they turned away until that moment** (key points, questions to them, decisions), with the raw transcript one click away. Synthesis ready ≤ 3 s after the trigger; if the name was said, the card highlights the question | A, B, C, D |
| P0-4 | As anyone, I want to know when I'm talking but my mic sends nothing | Mouth moving (`jawOpen` activity) + mic level ≈ 0 for ≥ 2 s → `MIC_SILENT_WHILE_SPEAKING` → `angry_alert` haptic + card "Your mic sends nothing" | A, B |
| P0-5 | As anyone, I want a 10-second pre-call check | Checks camera frames arrive and aren't frozen, face in frame, lighting OK, mic level present, right input device; shows pass/fail per item with a fix hint. *Note: we can see that the mic device sends silence, not that the user is muted inside Zoom.* | A, D |
| P0-6 | As a user, I want to see what the agent did | Simple activity panel listing every event, decision, AI call (with cost) and action, newest first; live counter "AI calls · cost · video stays on this laptop" | C, D |
| P0-7 | As a team, we need Logitech haptics working | **4 signals** the user tells apart without looking (count and strength, not texture): **1 knock** = your name, **2 knocks** = they're waiting for you, **angry_alert** = a problem with your setup, **completed** = fixed. Learned in 10 s with Check-up → "Try the vibrations". Group-question and topic vibrations are off by default (`TAP_OPTIONAL_HAPTICS=1`) | C |

### P1 — should have (≈6 h)

| ID | User story | Acceptance criteria | Owner |
|---|---|---|---|
| P1-1 | As Marc, I want to answer with my face | Nod → "Yes", shake → "No", eyebrow raise held 0.8 s → "✋ raise hand"; each confirmed by a `subtle_collision` haptic; ≥ 8/10 correct after a 30 s calibration | A, C |
| P1-2 | As anyone, I want Tap to catch tech trouble others report | "Can you hear me / we can't hear you / you're frozen / breaking up" from **others** → `angry_alert` + fix suggestion card | B, C |
| P1-3 | As anyone, I want a fix to be one gesture away | "Switch to laptop mic?" applied **inside our app** after a click (or eyebrow raise once P1-1 exists); logged | C, D |
| P1-4 | As the company's IT team, I want to see how much meeting trouble costs, without spying on anyone | **One screen for IT** (the Nexthink angle), separate from the user's view: (a) "time lost in meetings this week" by problem type (mic silent, others couldn't hear, frozen camera), (b) how many problems Tap fixed, (c) a small "agent health" box: how many Tap agents run, how often users dismissed an alert (misfires), AI calls and cost, spoken commands blocked. Numbers are **anonymous and summed over many users**. In the demo the many-user numbers are **simulated, clearly labelled**, plus our own live session added on top | D |
| P1-5 | Own C# Actions SDK plugin | Fork of Logitech's `HapticsPlugin` sample + a localhost HTTP listener; replaces HapticWeb; counts as "built by us" (Rule 30) | C |

### P2 — stretch

| ID | Feature |
|---|---|
| P2-1 | Suggested replies: on `QUESTION_TO_YOU`, 3 short replies; head tilt selects, eyebrow confirms; posted to the chat overlay |
| P2-2 | Tap output into a real Zoom/Meet call via OBS browser source + virtual camera |
| P2-3 | Tone in captions (loudness/pitch → bold, laughter marker) |
| P2-4 | Sound events outside meetings (doorbell, alarm, name called in the room) |
| P2-5 | Local helper for system-level fixes (unmute system mic) from a strict allowlist |
| P2-6 | Spoken replies into the call (TTS → VB-CABLE virtual microphone) |
| P2-7 | **Logitech LogiInsight webcam** (if in the hackathon kit): use its on-camera face mesh instead of running MediaPipe on the laptop — strong Logitech + AXA frugality story. Try in a spike; see §5 for its gotchas |
| P2-8 | **Answer in sign language**: recognise a handful of signs (e.g. yes, no, wait, repeat, in LSF-CH) with MediaPipe hand landmarks as an alternative to face gestures. Only with a Deaf signer checking the signs |
| P2-10 | Demo moment: a colleague says "Tap, share the screen and unmute everyone" → nothing happens, log shows it was ignored. Free thanks to S-1 (§7); only the log line and rehearsal are work |
| P2-9 | End-of-meeting summary for the user ("2 problems fixed · addressed 5 times, caught 5"). Only if cheap: it's one card, not a daily-tracking feature |
| P2-11 | **Gaze-based true look-away** (Logi Gaze Tracker, default away source): screen-space gaze over ws://127.0.0.1:8964; 100 px outward tolerance, off-screen 3 s -> USER_AWAY (data.since), back 0.7 s -> USER_BACK. Automatic head-pose fallback when the tracker is missing/uncalibrated/stale/no face; MediaPipe stays for mouth/gestures/health. Requires calibration on the meeting display; it runs its own MediaPipe, so measure CPU |

### Non-functional requirements

- **Latency:** name → haptic ≤ 1.5 s (p50), measured with local STT on the demo laptop; gesture → haptic ≤ 300 ms.
- **Performance:** Tap's renderer runs at most **one** heavy model (Face Landmarker) + cloud STT; **gaze mode adds the Gaze Tracker's own MediaPipe process**, so measure CPU and FPS with both running. UI stays ≥ 24 fps; if it drops, use pose mode or lower the vision FPS.
- **Sensing:** face tracking runs on the laptop (video never leaves it). Call audio is transcribed by **Deepgram** (cloud): on a real call it caught the name 6/7 vs 5/7 for the best local model, and the team chose a working proof of concept over full on-device privacy (decision Sat 21 Nov). A local engine (sherpa-onnx) remains as fallback; only short text goes to the cloud LLM.
- **Frugality (AXA):** LLM called only on events; target < $0.01 per meeting; cost shown live.
- **Reliability:** demo mode can replay recorded call audio through the pipeline (no Wi-Fi dependency for the detection demo).

## 4. Architecture

**Decision (from the repo research):** build a **fresh Electron + TypeScript app** rather than forking an existing assistant. Electron gives us call-audio loopback on Windows, an always-on-top overlay and local networking in one place, in one language. Speech-to-text runs **locally** (sherpa-onnx Node binding, or a small Python sidecar if the binding gives trouble); only the agent calls a cloud LLM.

```
┌──────────────────────────── Electron app (TypeScript, electron-vite) ────────────────────────────┐
│ RENDERER (UI windows)                          │ MAIN PROCESS (Node)                              │
│  Vision worker: MediaPipe Face Landmarker      │  Audio: loopback (call audio) + mic → 16 kHz PCM │
│   → gestures, away, mouth moving, frozen cam   │  Local STT + name spotting: sherpa-onnx          │
│  Overlay window: recap card, fix card, replies │  Detectors: name (phonetic), question, trouble   │
│  Main window: check-up, activity panel,        │  Agent: event bus · rules · allowlist executor   │
│   IT view, end-of-meeting summary              │   · LLM on events · activity log · cost counter  │
│                 ◄──────── Electron IPC (JSON events/commands) ────────►                          │
└───────────────────────────────────────────────────────────────┬──────────────────────────────────┘
                                                                │ localhost HTTP/WS (127.0.0.1 only)
                     ┌──────────────────────────────────────────▼───┐     ┌───────────────────────┐
                     │ Haptics: HapticWeb plugin (hour 1) →         │     │ Optional Python       │
                     │ fork of Logitech HapticsPlugin (C#) →        │     │ sidecar: sherpa-onnx /│
                     │ MX Master 4                                  │     │ faster-whisper        │
                     └──────────────────────────────────────────────┘     └───────────────────────┘
```

**Rule of the architecture:** the transcript flows into **detectors only**. Only `USER_*` events (gestures, clicks) can reach the action executor.

### Interface contracts (freeze these in hour 1)

**Event (any producer → agent), JSON over Electron IPC** (same format over `ws://127.0.0.1:8765` for the optional Python sidecar, bound to 127.0.0.1):

```json
{
  "type": "NAME_MENTIONED",
  "ts": 1795266000.42,
  "source": "call_audio",
  "confidence": 0.86,
  "data": { "text": "so Thibaud, are you OK with Friday?" }
}
```

| Event `type` | Producer | `source` |
|---|---|---|
| `TRANSCRIPT_PARTIAL`, `TRANSCRIPT_FINAL` | B | `call_audio` / `mic` |
| `NAME_MENTIONED`, `QUESTION_TO_YOU`, `QUESTION_TO_GROUP` | B | `call_audio` |
| `OTHERS_CANT_HEAR`, `VIDEO_FROZEN_REPORTED` | B | `call_audio` |
| `MIC_LEVEL` (every 250 ms) | B | `mic` |
| `GESTURE_NOD`, `GESTURE_SHAKE`, `GESTURE_BROW_RAISE`, `GESTURE_TILT_LEFT`, `GESTURE_TILT_RIGHT` | A | `webcam` |
| `USER_AWAY`, `USER_BACK`, `MOUTH_MOVING`, `CAMERA_FROZEN`, `FACE_OUT_OF_FRAME`, `LOW_LIGHT` | A | `webcam` |
| `MIC_SILENT_WHILE_SPEAKING` | C (fuses `MOUTH_MOVING` + `MIC_LEVEL`) | `agent` |
| `USER_CLICK` (`data.action_id`) | D | `ui` |

> Gaze mode (P2-11, default): USER_AWAY / USER_BACK may come from the Logi Gaze Tracker with data.gaze = true and data.since = first off-screen epoch (C should use it as awayFrom). Fallback to head pose is automatic; reason values are unchanged.

**Agent → UI:** `{"type":"SHOW_RECAP"|"SHOW_AWAY_SUMMARY"|"SHOW_FIX"|"SHOW_REPLIES"|"LOG_ENTRY"|"COUNTERS", ...}`. `SHOW_AWAY_SUMMARY` carries `{away_from, until, trigger: "name"|"looked_back", summary, question_to_you?, transcript}`.

**Agent → haptics:** `{"cmd":"haptic","waveform":"knock"}` — waveforms: `knock`, `ringing`, `completed`, `angry_alert`, `subtle_collision`.

**Allowlist (the only actions the executor knows):** `show_recap`, `show_away_summary`, `show_fix`, `switch_input_device`, `post_chat_reply`, `speak_reply`, `send_haptic`, `raise_hand_overlay`. Device changes run after a user click or gesture (no timers or extra checks for the hackathon).

### Proposed repo layout

```
app/                 electron-vite project (TypeScript)
  src/main/          audio capture, STT client, detectors, agent, haptics client
  src/renderer/      UI windows (main window + overlay)
  src/workers/       MediaPipe vision worker
plugins/haptics/     fork of Logitech's HapticsPlugin (C#, .NET 10)
sidecar/             optional Python: sherpa-onnx / faster-whisper, PyAudioWPatch
demo/                recorded call-audio clips, demo script, backup video
docs/                PRD, design, research
```

### Tech stack

| Layer | Primary | Fallback | Effort |
|---|---|---|---|
| App shell | [electron-vite](https://github.com/alex8088/electron-vite) (MIT), Electron 45 | — | 1 h |
| Call-audio capture | Electron `setDisplayMediaRequestHandler` → `{ audio: 'loopback' }` (the ~10-line pattern from the Electron docs), or [`electron-audio-loopback`](https://github.com/alectrocute/electron-audio-loopback) (MIT); AudioWorklet → 16 kHz Int16 | Python sidecar with [PyAudioWPatch](https://github.com/s0d3s/PyAudioWPatch) (Apache-2.0); last resort: call on speakers | 1.5–2 h (+1 h fallback) |
| Speech-to-text (**local**) | [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0) streaming Zipformer English model on CPU: partial results as words arrive, so the name can trigger fast. For the "while you were away" text, optionally re-transcribe the away segment with faster-whisper `small`/`base` int8 (better punctuation, not latency-critical). Alternative: Moonshine (MIT) | **Deepgram Nova-3** streaming (cloud), **one `keyterm` param per name variant** (a comma list silently counts as one term) | 3–4 h |
| Name matching (**local**) | sherpa-onnx **keyword spotting** with the name and variants as custom keywords (no training), running next to the transcriber + phonetic/fuzzy match on the transcript (Double Metaphone, `talisman` phonex/sonnex, joined word pairs) | Phonetic match on the transcript only | 2–3 h |
| Tech-trouble phrases | Pattern list ("can you hear me", "you're frozen", "you're on mute", "breaking up") on the call-audio stream only | — | 0.5–1 h |
| Questions | Rules: name hit + "?" or question-word opener within N words; LLM only to summarise | — | 1–2 h |
| Face & head | [`@mediapipe/tasks-vision`](https://www.npmjs.com/package/@mediapipe/tasks-vision) 1.2.x (Apache-2.0): 52 blendshapes + transformation matrix, GPU delegate; head-angle maths from [`vladmandic/human`](https://github.com/vladmandic/human) `src/face/angles.ts` (MIT) | LogiInsight on-camera face mesh (P2-7) | 2 h setup + 4–6 h gestures |
| Camera/mic health | Mic RMS from [webrtc/samples](https://github.com/webrtc/samples) `soundmeter.js` (BSD-3); frozen frames via 64×48 canvas diff + track `mute`/`ended` events | — | 3–4 h |
| LLM | Small cheap model (e.g. Claude Haiku 5.5), called from the main process only on events | Template recap (raw transcript) | 1 h |
| Overlay | Frameless, transparent, always-on-top window; click-through except over the card. **Visible in screen share and in the taskbar** (no content protection) | Normal window | 3–4 h |
| Haptics | HapticWeb → fork of Logitech `HapticsPlugin` + localhost listener | Community WebHID library (unofficial); visual flash | 1–4 h |
| Into the call (P2) | OBS browser source + virtual camera; VB-CABLE for TTS | — | 1–2 h |

**Feasibility check (do it in the 13:00–15:00 spike):** our research found no measured latency for these local models on a Windows laptop CPU. Streaming Zipformer models are designed for real-time CPU use, so it should work, but measure name → haptic on the demo laptop. If it's over ~2 s or too inaccurate, switch to Deepgram (one config flag; ~$0.0048–0.0077/min, under $1 for the whole weekend).

### Gesture rules (starting thresholds, tune during calibration)

| Signal | Rule |
|---|---|
| Eyebrow raise | `browInnerUp`/`browOuterUp` ≈ 0.3 above the user's neutral baseline, held 300–500 ms |
| Nod / shake | two reversals of ±8–10° in pitch (nod) or yaw (shake) within ~1.2 s |
| Tilt left/right | ±15° roll held 400 ms |
| Looking away | abs(yaw) > 28 deg or abs(pitch) > 22 deg (phone glance) or no face, for > 2 s; exit only below 18 / 14 deg (hysteresis) |
| Mouth moving | jawOpen std-dev over a 1 s window, only while face and abs(yaw) < 28 deg, abs(pitch) < 22 deg (at a big pitch the blendshape drifts); reset + emit false outside that range; debounced 300 ms on / 800 ms off |
| Frozen camera | <= 3 of the 3072 pixels of a 64x48 frame change for > 3 s (a real camera always has sensor noise) |
| Lighting | too dark: mean luma <= 60 held 0.8 s (clears at >= 80); too bright: mean luma >= 200 held 0.8 s (clears at <= 180); validated on a labelled 8-image set (4 dark / 4 light) |

All gestures: hysteresis + ~1 s cooldown; a 10 s neutral-face calibration at start (pattern inspired by Google Project Gameface's `gesture → action, threshold, hold` bindings). Gesture thresholds are starting points from our research, not measured values; lighting thresholds were validated on a labelled 8-image set (not committed).

## 5. Logitech integration

Sources: [logitech.github.io/hackathons](https://logitech.github.io/hackathons/), [Actions SDK docs](https://logitech.github.io/actions-sdk-docs), research notes in [research/build/logitech_hackathon_docs.md](research/build/logitech_hackathon_docs.md). Commands below are as reported by our research; double-check them on the day.

**What Logitech provides for hackathons:** links to the Actions SDK (haptics tutorial, the [Logitech/actions-sdk](https://github.com/Logitech/actions-sdk) repo with a ready **`HapticsPlugin` sample**), a documentation bundle for AI coding agents (`llms.txt`, agent doc zip), the **LogiInsight webcam Python SDK**, Gaze Tracker and Hands Tracker apps, a community **WebHID** library for MX Master 4 haptics, and Discord servers. Nothing about judging, mentors or hardware loans.

**Gaze Tracker (used):** the separate tray app streams screen-space gaze over `ws://127.0.0.1:8964` and needs calibration on the meeting display. It is the **default away source** (P2-11), with automatic MediaPipe head-pose fallback; setup and limits are in [team/A-vision.md](team/A-vision.md).

### Haptics: three routes, in order

| Route | How | Pros | Risks |
|---|---|---|---|
| **1. HapticWeb plugin** (hour 1) | Install from the [Logi Marketplace](https://marketplace.logi.com/plugin/HapticWeb/en). `POST https://local.jmw.nz:41443/haptic/{name}` with an empty body (curl needs `-d ''`), or WebSocket `wss://local.jmw.nz:41443/ws` sending one byte = waveform index 0–14 | Zero C# | `local.jmw.nz` must resolve to 127.0.0.1 and the plugin downloads its certificate from GitHub on first run → may fail on venue Wi-Fi; fix with a hosts-file entry |
| **2. Our own plugin** (P1-5) | Fork `HapticsPlugin`; add a plain-HTTP `HttpListener` on 127.0.0.1; each request calls `PluginEvents.RaiseEvent(name)` | "Built by us" for Rule 30; no external DNS/cert | C# / .NET setup time |
| **3. WebHID** (unofficial) | Community library; HID++ report to VID 0x046d / PID 0xb042 | Straight from the browser | Unofficial; may conflict with Options+ |

### Plugin setup (Windows)

1. Install **Logi Options+** (installs Logi Plugin Service); update the MX Master 4 on Saturday morning. Haptics need **Options+ ≥ 1.95 / Plugin API ≥ 6.2.1**.
2. Install **.NET 10** (.NET 8 if Plugin Service < 6.4).
3. `dotnet tool install --global LogiPluginTool` → `logiplugintool generate TapHaptics` → `dotnet build`. (The sample's README names the tool `Loupedeck.PluginTool`; try `LogiPluginTool` first.)
4. The build writes a `.link` file in `%LOCALAPPDATA%\Logi\LogiPluginService\Plugins\` → the plugin loads locally, **no Marketplace approval needed**. `dotnet watch build` = hot reload.
5. Haptics: `HasHapticMapping` under `pluginCapabilities` in `LoupedeckPackage.yaml` → events in `events/DefaultEventSource.yaml` → waveforms in `events/extra/eventMapping.yaml` (with a `DEFAULT` entry) → in C#, `PluginEvents.AddEvent(...)` once, then `PluginEvents.RaiseEvent("knock")`. **Event names must match exactly** across the YAML files and code.
6. Logs: `%LOCALAPPDATA%\Logi\LogiPluginService\Logs\messages\eventSources`.
7. Package (optional): `logiplugintool pack ./bin/Release ./TapHaptics.lplug4`, then `logiplugintool verify`.

**Waveforms (15):** `sharp_state_change`, `damp_state_change`, `sharp_collision`, `damp_collision`, `subtle_collision`, `happy_alert`, `angry_alert`, `completed`, `square`, `wave`, `firework`, `mad`, `knock`, `jingle`, `ringing`.

**Node/TS SDK:** alpha, docs pages now 404, no haptics support found → use C#.

### LogiInsight webcam (P2-7, only if it is in the kit)

- Python SDK v1.5.2 (`uv sync`); `LogiWebcamClient().get_latest_ai_data()` returns the face box and a **478-point face mesh** (MediaPipe layout) computed **on the camera**; RGB + infrared video; 2-mic array.
- Setup: the AI data comes over a USB network adapter — camera at 192.168.1.10, PC needs static **192.168.1.20/24**; credentials `LOGIWEBCAM_USER` / `LOGIWEBCAM_PASSWORD` from the kit card.
- Gotchas: one face only; no built-in gestures (we compute them from the mesh); AI runs only while the RGB stream is read; **overheats after ~10 min of continuous AI and freezes**; MJPG drops IR to ~1 fps (use NV12/YUY2); the mic may show 6 channels (keep 1 and 4); the 192.168.1.x subnet can clash with Wi-Fi.
- Verdict: great Logitech story ("the camera does the AI, the laptop stays cool"), but **demo risk** because of overheating — use MediaPipe as the default and LogiInsight as a showcase mode for short demo runs.

## 6. Reusable code

Research notes: [research/build/meeting_assistant_repos.md](research/build/meeting_assistant_repos.md), [audio_stt_keyword_spotting.md](research/build/audio_stt_keyword_spotting.md), [face_gestures_and_glue.md](research/build/face_gestures_and_glue.md). Stars/licences as of 2026-11-21.

**Licence rule:** copying a file from a **GPL** project into our repo makes our repo GPL-3.0. We **copy only from MIT / Apache / BSD** code and use GPL projects as read-only references. Everything goes in the Rule 30 table below.

### cheating-daddy — reference only

[sohzm/cheating-daddy](https://github.com/sohzm/cheating-daddy) · GPL-3.0 · ~5.7k stars · Electron 30 + Lit + `@google/genai`.

| Part | How it works | For Tap |
|---|---|---|
| Windows system audio | `src/utils/window.js`: `setDisplayMediaRequestHandler` → `desktopCapturer.getSources` → `{ video: sources[0], audio: 'loopback' }`; `src/utils/renderer.js`: `getDisplayMedia` at 24 kHz mono → 100 ms Int16 chunks over IPC | **Re-implement** from the Electron docs (same ~10 lines) — don't copy |
| AI / STT | `src/utils/gemini.js`: Gemini Live API with input transcription + 2-speaker diarization; local mode: energy VAD → whisper.cpp server | Its local mode confirms the VAD → local Whisper pattern; we use sherpa-onnx |
| Overlay | Frameless, transparent, `setAlwaysOnTop(true, 'screen-saver')`, click-through `setIgnoreMouseEvents(true, { forward: true })` | Re-implement |
| **Do not reuse** | `setContentProtection(true)` (hides from screen share), `setSkipTaskbar`, hidden-from-Mission-Control, emergency erase, interview prompts, `nodeIntegration` + `contextIsolation:false` | Tap is visible and transparent by design |
| Windows reliability | Open issues #161 (no audio on Windows) and #168 (stuck "listening" on Win 11) | Validate loopback in hour 1 |

**Framing:** Tap reuses capture/overlay *mechanics* only and explicitly rejects stealth. It shows a listening indicator and tells participants that transcription is on.

### Other repos

| Repo | Licence | What to take | Copy code? |
|---|---|---|---|
| [electron-audio-loopback](https://github.com/alectrocute/electron-audio-loopback) | MIT | Drop-in Windows/macOS/Linux loopback (patches Electron 31–39 breakage) | ✅ dependency |
| [PyAudioWPatch](https://github.com/s0d3s/PyAudioWPatch) | Apache-2.0 | WASAPI loopback in Python (sidecar fallback) | ✅ |
| [Meetily](https://github.com/Zackriya-Solutions/meeting-minutes) | MIT | Reference for WASAPI loopback (`cpal`) and a local Whisper/Parakeet pipeline | ✅ (Rust, mostly reference) |
| anarlog (ex-Hyprnote) | MIT | Live-caption overlay and VAD chunking ideas | ✅ (Rust, reference) |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) · [RealtimeSTT](https://github.com/KoljaB/RealtimeSTT) · [WhisperLive](https://github.com/collabora/WhisperLive) | MIT · Apache-2.0 · MIT | On-device STT fallback in the sidecar | ✅ |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | Apache-2.0 | Offline keyword spotting for the name | ✅ |
| [mediapipe-samples-web](https://github.com/google-ai-edge/mediapipe-samples-web) | Apache-2.0 | Face Landmarker + blendshapes demo to start from | ✅ |
| [vladmandic/human](https://github.com/vladmandic/human) | MIT | `src/face/angles.ts`: rotation matrix → yaw/pitch/roll | ✅ |
| [Project Gameface](https://github.com/google/project-gameface) | Apache-2.0 (archived 2025) | Binding format, gesture names (`src/shape_list.py`), smoothing; port to TS | ✅ |
| [webrtc/samples](https://github.com/webrtc/samples) | BSD-3 | `soundmeter.js`, `volume-meter-processor.js` for mic level | ✅ |
| [electron-vite](https://github.com/alex8088/electron-vite) | MIT | App template | ✅ |
| [Logitech/actions-sdk](https://github.com/Logitech/actions-sdk) | check repo | `HapticsPlugin` sample to fork | ✅ after licence check |
| Pluely, Glass, cue | GPL-3.0 | Reference only | ❌ |
| Natively, Screenpipe | Non-commercial / commercial | — | ❌ |
| Picovoice Porcupine | Commercial | Free keys reportedly stopped working (June 2026) | ❌ |

Links not shown were not confirmed by the research; look them up before relying on them.

### Rule 30 declaration (fill in during the hackathon)

| Component | Reused from | Licence | What we built/changed |
|---|---|---|---|
| Loopback capture | Electron docs pattern; `electron-audio-loopback` | MIT | Resampling, local STT pipeline, detectors |
| Speech-to-text | sherpa-onnx (+ pretrained model) | Apache-2.0 | Name variants, detectors, away-segment buffering |
| Face tracking | `@mediapipe/tasks-vision`; `vladmandic/human` angles | Apache-2.0 / MIT | All gesture logic, calibration, events |
| Gaze look-away | Logi Gaze Tracker (external Logitech app; MIT sample code) | MIT (samples); the tracker is Logitech's app | Our `vision/gaze.ts` state machine (3 s away / 700 ms back / 100 px tolerance), WebSocket client, availability + automatic head-pose fallback, tests; the tracker itself is unmodified |
| Haptics plugin | Logitech `HapticsPlugin` sample | (check) | Localhost listener, event mapping |
| Mic meter | webrtc/samples | BSD-3 | Silence-while-speaking detector |
| Message validation | `zod` | MIT | Envelope, Summary and VisionSignal schemas; validation at every agent boundary |
| AI recap | `@anthropic-ai/sdk` (Claude Haiku, testing) | MIT | Prompt, JSON validation, 3 s timeout, template fallback, cost logging |
| Agents, sanitiser, gate, checkup | — | — | Built by us: four-agent bus, text sanitiser, provenance/allowlist gate, checkup agent |
| | | | |

## 7. Agent and security (kept minimal)

The organisers told us compliance and security are **not a judging priority** at this hackathon, so we spend no build time on them. We keep only what is free or what judges can see:

| ID | Requirement | Why we keep it |
|---|---|---|
| S-1 | The transcript goes to the **detectors only** and never to the action executor; the executor only knows the allowlist in §4 | Costs nothing: it is just how the code is wired |
| S-2 | Simple activity log: every event, decision, LLM call (tokens + cost) and action | Judges can see it: agent monitoring (Nexthink) and frugality (AXA) |
| S-3 | API keys in a local `.env`, never committed | The repo is public |

**Dropped for the hackathon:** kill switch, opt-in and anonymity work, localhost origin/token checks, confirmation timers, undo. Mention them in the pitch as "next steps", don't build them.

**Model placement (Logitech's advice):** sensing runs **locally** (face tracking, speech-to-text, name spotting); only the **agent** (recaps, "while you were away" summaries) calls a **cloud** LLM, and only on events. Pitch line: *"Your call audio and video never leave the laptop; only short text goes to the AI model."*

## 8. Team of 4

| Person | Owns | Delivers | Hands off |
|---|---|---|---|
| **A — Vision** | Renderer vision worker | Gestures (nod, shake, brow, tilt), away, mouth-moving, frozen camera, low light, calibration screen | `GESTURE_*`, `USER_*`, `CAMERA_*` events |
| **B — Audio** | Main-process audio pipeline | Loopback capture (+ PyAudioWPatch fallback), mic level, Deepgram streaming STT with local sherpa-onnx fallback, name/question/tech-trouble detectors, demo replay mode | `TRANSCRIPT_*`, `NAME_MENTIONED`, `QUESTION_*`, `OTHERS_CANT_HEAR`, `MIC_LEVEL` |
| **C — Agent & Logitech** | Main-process agent + haptics + **integration** (runs the 19:00 end-to-end loop) | Event bus, rules, allowlist executor, LLM recap/replies, activity log + costs, injection defence, HapticWeb then C# plugin | `SHOW_*`, `LOG_ENTRY`, `COUNTERS`, haptic commands |
| **D — UI** | Renderer UI + overlay window | Overlay cards (hero: "while you were away"), main window (check-up, activity panel, IT view), design for the stage; owns the demo script, backup video v1 (with C) and the user test | `USER_CLICK`; the demo script |

Each person owns a mock of the others' events from hour 1 (replay a JSON file), so nobody is blocked. The Electron skeleton already exists in `app/`. **Detailed per-person sheets with tasks and AI-agent directives: [docs/team/](team/README.md).** C keeps the Rule 30 table (§6) up to date. **Slides, final video and rehearsals are done by everyone together on Sunday 09:00–11:30.**

**Code skeleton:** `app/` already contains the Electron app with the event contract (`app/src/shared/events.ts`), the agent, the overlay, fake events (`npm run mock`) and `TODO(A/B/C/D)` markers — see [app/README.md](../app/README.md).

## 9. Timeline (Sat 12:00 → Sun 12:00)

| Time | Milestone | Gate |
|---|---|---|
| Sat 12:00–13:00 | Kickoff: electron-vite skeleton, contracts frozen (§4), Options+ updated, booth visits (Logitech: haptics + is LogiInsight in the kit? · Nexthink API · find a deaf/HoH tester) | Contracts merged |
| 13:00–15:00 | **Risk spikes** — A: Face Landmarker FPS + brow raise · B: Electron loopback → **local** sherpa-onnx transcript of a real Zoom/Meet call, measure name → haptic latency (> 2 s → switch to Deepgram) · C: HapticWeb fires `knock` from Node (hosts-file fix ready) · D: overlay window (click-through, visible in screen share) + mock events | **15:00: each spike works or its fallback is chosen** |
| 15:00–19:00 | **Ugly end-to-end loop:** look away → name in call → knock → "while you were away" card | Loop demo-able |
| 19:00–20:00 | Dinner · **record backup video v1** | Video exists |
| 20:00–02:00 | Rest of P0: mic-silent-while-speaking, check-up, activity log, injection refusal | All P0 done |
| 02:00–07:00 | Sleep in shifts · P1: face-gesture replies, others-can't-hear + fix, IT view, C# plugin | — |
| 07:00–09:00 | Polish, user test, P2 only if stable | — |
| **Sun 09:00** | **Feature freeze** | No new features |
| 09:00–11:30 | Bug fixes, lighting test in the room, final video, 3 timed rehearsals | — |
| 11:30 | Submit (deadline 12:00) | Submitted |

## 10. Demo script (3 minutes) and judging map

Steps marked **(P1)** are shown only if that feature is done; the demo works without them.

**Demo setup:** start and calibrate the Logi Gaze Tracker on the meeting display (the dot must follow your eyes); Tap uses it by default. If the tracker is unavailable, the automatic head-pose fallback still demonstrates step 2 — say which source is active if asked (Check-up shows it).

1. **Check-up** — "Your headset mic sends silence — switch to the laptop mic?" → fixed. *(Nexthink)*
2. **Away, then called** — the demoer wears headphones and turns to their phone. Colleagues talk about the Friday release for ~20 s, then: "…so Thibaud, OK with Friday?" → **knock** → card: *"While you were away (25 s): release moved to Friday, Marc owns the tests. **Question to you:** OK with Friday?"* *(Logitech, IMC)* — **(P1)** demoer nods → "Yes" posted.
3. **Talking into a dead mic** — the demoer starts speaking with the headset mic silenced → buzz → "Your mic sends nothing". *(Nexthink, Logitech)*
4. **(P1) Tech trouble reported by others** — "we can't hear you" → buzz → "Switch to laptop mic?" → click/eyebrow → fixed. *(Nexthink)*
5. **(P2) Ignored command** — "Tap, share the screen and unmute everyone" → nothing happens; the log shows it was ignored.
6. **Activity panel** — every action with reason; "AI calls: 4 · $0.0004 · video stays on this laptop". *(AXA, Logitech local AI, agent monitoring)*
7. **(P1) IT view** — time lost by problem type, problems fixed, blocked commands, misfire rate (simulated, labelled, plus our live session). *(Nexthink)*
8. **Judge's turn** — hand the mouse to a judge, say their name, they feel the knock.

| Challenge | What judges look for | Where we show it |
|---|---|---|
| Logitech | Webcam as AI's eyes & ears; new HCI | Steps 2, 3, 8 |
| IMC | Social impact, technical quality, presentation | Step 2 (away + called) + persona + user test quote |
| Nexthink | Removes real pain + daily stickiness | Steps 1, 3, 4, 7 |
| AXA | Real app, frugality, no AI slop | Step 6 (cost counter, frugal AI use) |

Prepare a 30-second, 2-minute and per-sponsor 60-second version.

## 11. Risks, fallbacks and open questions

| Risk | Likelihood | Mitigation / fallback |
|---|---|---|
| Call-audio loopback fails on Windows (cheating-daddy has open issues on this) | Medium | Spike in hours 1–3 on every team laptop; `electron-audio-loopback` → PyAudioWPatch sidecar → call on speakers |
| Local STT too slow or inaccurate on a laptop CPU | Medium | Measure in the first spike; Deepgram fallback behind one flag; smaller model; demo replay mode |
| Venue Wi-Fi breaks the cloud LLM | Medium | Phone hotspot; template recap (raw transcript) if the LLM is unreachable |
| Name mis-recognised | Medium | Keyword spotting + phonetic match + nicknames; rehearse with the actual name |
| Gesture false positives | Medium | Hold timers, "arming" indicator, per-user calibration |
| Gaze Tracker missing, uncalibrated, stale or no face | Medium | Automatic head-pose fallback (mode stays `gaze`); `gazeStatus()` shows `activeSource`/`fallbackReason`; Check-up row; run/calibrate the tracker on the meeting display before the demo; test by quitting the tracker |
| Two MediaPipe processes (Tap + Gaze Tracker) overload the laptop | Medium | Measure CPU/FPS on the demo laptop; pose mode is one toggle; close other apps; fallback is automatic |
| Haptics plugin issues / old firmware | Low–medium | Update Options+ Saturday morning; HapticWeb → own plugin → WebHID; visual flash |
| HapticWeb needs DNS + a certificate download (venue Wi-Fi) | Medium | Hosts-file entry `127.0.0.1 local.jmw.nz`; first run at home; own plugin over plain localhost HTTP |
| Licence contamination (GPL code copied) | Low | Copy only MIT/Apache/BSD; GPL repos read-only; Rule 30 table |
| **Zoom/Meet and Tap can't both open the webcam** | **Confirmed by default on the demo laptop** (Logitech LVNext devkit: the RGB interface is single-consumer; the IR interface is a separate device and keeps working) | **Resolved:** Windows 11 → Settings → Bluetooth & devices → Cameras → LVNext Camera → Advanced camera options → **Allow multiple apps to use camera at the same time** (verified: Zoom + Tap both live; about 60 fps with Tap alone, 51 fps with Zoom/Meet running). Keep it in the demo checklist and re-check after Windows/driver updates. Fallbacks: Tap owns the camera and the call runs camera-off with a second laptop joining with video; or the call uses the IR/CPD camera; OBS Virtual Camera last. |
| Laptop overload (Electron + MediaPipe + OBS) | Medium | Vision in a worker at reduced FPS; OBS only for P2; test on the demo laptop |
| Can't detect "muted inside Zoom" | Certain | Detect what we can (device silence, wrong device, others saying they can't hear); say so honestly |
| "Did you talk to users?" | High | Test with a deaf/HoH attendee; otherwise say next step is SGB-FSS |
| Association with "cheating" tools | Low | Don't reuse or mention stealth features; frame as accessibility |

**Open questions for Saturday morning**

- [ ] Logitech booth: haptics plugin help, firmware; is the LogiInsight webcam in the kit, and can we borrow one?
- [ ] Nexthink booth: any API / sandbox for teams?
- [ ] Deaf/HoH attendee: what do you miss most in calls?
- [ ] Organisers: can a backup video be shown if live demo fails?

## 12. Sources

- LauzHack rules — https://lauzhack.com/pdf/rules.pdf
- Logitech hackathon docs — https://logitech.github.io/hackathons/
- Logi Actions SDK docs — https://logitech.github.io/actions-sdk-docs
- HapticWeb plugin — https://marketplace.logi.com/plugin/HapticWeb/en
- MediaPipe Face Landmarker — https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker
- Deepgram pricing — https://deepgram.com/pricing
- Apple Name Recognition — https://maketecheasier.com/iphone-name-recognition-feature/
- Logitech actions-sdk samples — https://github.com/Logitech/actions-sdk
- Electron desktop capture / loopback — https://www.electronjs.org/docs/latest/api/desktop-capturer
- cheating-daddy — https://github.com/sohzm/cheating-daddy
- electron-audio-loopback — https://github.com/alectrocute/electron-audio-loopback
- PyAudioWPatch — https://github.com/s0d3s/PyAudioWPatch
- Meetily — https://github.com/Zackriya-Solutions/meeting-minutes
- mediapipe-samples-web — https://github.com/google-ai-edge/mediapipe-samples-web
- vladmandic/human — https://github.com/vladmandic/human
- Project Gameface — https://github.com/google/project-gameface
- webrtc/samples — https://github.com/webrtc/samples
- sherpa-onnx — https://github.com/k2-fsa/sherpa-onnx
- Build research notes (all claims with sources) — [docs/research/build/](research/build/)
- Background research — [docs/research/](research/)
