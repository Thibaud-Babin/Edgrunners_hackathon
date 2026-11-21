# B — Audio (call audio, speech-to-text, detectors)

**Mission:** Tap's ears. Capture what the other participants say (system audio, what plays in your headphones) and the user's mic level, turn the call audio into text **on the laptop**, and detect the user's name, questions and "can you hear me?".

This is the **riskiest part** of the project. Do the risk spike first, decide fallbacks fast, and ask for help early (C and D can help after 19:00).

## Status (Sat 21 Nov, pre-hackathon spike) ✅
- **Capture:** Electron loopback works on Thibaud's laptop (~32 kB/s, level follows the sound).
- **Local STT:** sherpa-onnx streaming Zipformer (English, int8) — `npm run setup-stt`, `TAP_STT=sherpa`. ~7× faster than real time, model loads in ~5.5 s at startup.
- **Name:** hotwords (`TAP_HOTWORDS`) + name checked on partial results. Offline bench (`npm run stt-bench`, 20 TTS clips): **9/10 names, 0/10 false alerts**, trouble phrases 4/4. Live through the speakers: **4/4 names, ~1.2 s from sentence start to detection**.
- **Silence:** lone filler words ("and") dropped → 0 fake transcripts in 40 s of silence.
- **Next:** test with real human voices + a real Meet/Zoom call (accents!), the Sony WH-1000XM4 Bluetooth hands-free issue (see below), replay mode for the demo, `MIC_SILENT_RMS` tuning.
- **Limits:** English-only model: French meetings won't transcribe. Windows' French voice (Hortense) gave poor transcripts.
- **Bluetooth headsets:** if the meeting app uses the headset mic, Windows moves the call audio to "Headset (… Hands-Free)": make that the default output, or use the laptop mic in the meeting app.

## Your files
- `app/src/renderer/src/audio.ts`, `app/src/renderer/public/pcm-worklet.js`
- `app/src/main/audio/` (`pipeline.ts` + new engines, e.g. `sherpa.ts`, `deepgram.ts`)
- `app/src/main/detectors/` (`text.ts`, `text.test.ts`)
- `sidecar/` (only if you need the Python fallback), `demo/recordings/`
- **Don't edit:** `shared/events.ts` (ask first), `main/agent/`, UI files.

## What you send (published on the bus by `AudioPipeline`)
| Event | `data` | Notes |
|---|---|---|
| `TRANSCRIPT_PARTIAL` / `TRANSCRIPT_FINAL` | `{ text }` | `source: 'call_audio'` (others) or `'mic'` (user) |
| `NAME_MENTIONED` | `{ text, matched }`, `confidence` | **once** per mention (debounce partial + final) |
| `QUESTION_TO_YOU` / `QUESTION_TO_GROUP` | `{ text }` | |
| `OTHERS_CANT_HEAR` / `VIDEO_FROZEN_REPORTED` | `{ text }` | only from `call_audio` |
| `MIC_LEVEL` | `{ rms }` | every ~250 ms, from `startMic()` (already done) |

The STT engine just has to implement `SttEngine` in `pipeline.ts` and call `onText(text, final)`; detectors and events are already wired. Who uses your events: C's agent (everything P0).

Also yours: `startMic(deviceId)` is used by the "switch to laptop mic" fix (`SWITCH_MIC` command, handled in `main.ts`). Improve the headset/laptop detection there if labels on your laptops differ (agree with D, it's in D's file).

## Tasks, in order
| When | Task | Done when |
|---|---|---|
| Sat 12:00–13:00 | `npm run dev`. Join a real Meet/Zoom call (teammate on a phone), headphones on. Click **Start call audio** and check audio chunks arrive in main (add a temporary bytes/s log). Try it on **every team laptop**. | Chunks arrive on the demo laptop |
| 13:00–15:00 **spike** | Local STT: `npm i sherpa-onnx-node`, download a **streaming Zipformer English** model into `app/models/` (gitignored), implement `sherpa.ts` (`SttEngine`), return it from `createStt('sherpa')`, set `TAP_STT=sherpa`. **Measure** time from the name being spoken to `NAME_MENTIONED`. | Live transcript visible in the Activity log + latency number |
| 15:00 decision | Latency ≤ ~2 s and name found → keep local. Otherwise: `deepgram.ts` (WebSocket streaming, nova-3, one `keyterm=` param per name variant) behind `TAP_STT=deepgram`. Capture broken? fallbacks in order: `electron-audio-loopback` (MIT) → `sidecar/` with PyAudioWPatch → call on speakers. | One working path chosen, team told |
| 15:00–19:00 | Name on **partials** (faster), debounced so it fires once. Add sherpa-onnx **keyword spotting** for the name if the transcriber mangles it. Extend `text.test.ts` with what the STT actually outputs for the name. | 8/10 name hits, ≤ 1 false alert / 5 min |
| 20:00–02:00 | Record 3–4 demo clips (name, "can you hear me", 30 s of talk) into `demo/recordings/` and add a **replay mode** that feeds a WAV through the pipeline (demo works even if the call fails). Tune `MIC_SILENT_RMS` with a real headset mute switch (constant is in C's `agent.ts`: tell C the value). | Replay works offline |
| 02:00–09:00 | Help C/D; P1: user's own mic transcript, more trouble phrases. | — |

## How to test alone
- **Capture check:** `npm run dev -- --autostart-call` starts call-audio capture by itself; the terminal prints `[audio] call_audio: ~32000 B/s, peak N` every second (peak ≈ 0 in silence, rises with sound). Silence it with `TAP_DEBUG_AUDIO=0` in `.env`. ✅ Verified on Thibaud's laptop (Windows 11) with a system sound.
- `npm test` for detectors (add cases from real STT output!).
- Dev text box = fake STT output; real STT should produce the same events.

## Pitfalls
- Loopback captures **all** system sound: mute notifications/music during the demo.
- Native modules (`sherpa-onnx-node`) must match Electron's Node ABI. If it fails to load in Electron, try the package's Electron instructions, or run sherpa-onnx in the Python sidecar instead (don't lose more than 1 h on this).
- Deepgram: a comma-separated `keyterm` list counts as ONE term: repeat the parameter.
- Research notes: `docs/research/build/audio_stt_keyword_spotting.md`, `meeting_assistant_repos.md` (cheating-daddy is **GPL: don't copy**, reimplement).

## Agent directives (paste to your AI coding agent)
```
I am person B (audio) on the Tap project. Read AGENTS.md and docs/team/B-audio.md first.
You may edit ONLY: app/src/renderer/src/audio.ts, app/src/renderer/public/pcm-worklet.js,
app/src/main/audio/**, app/src/main/detectors/**, sidecar/**, demo/recordings/**.
Do not edit app/src/shared/events.ts, app/src/main/agent/**, or UI files.
New speech-to-text engines must implement the SttEngine interface in app/src/main/audio/pipeline.ts
and report results only through the onText(text, final) callback. Select engines with the TAP_STT env var.
Audio arrives as 16 kHz mono Int16 chunks of 100 ms.
Do not copy code from GPL projects (cheating-daddy, Pluely, Glass); MIT/Apache is OK, tell me what you used.
Keys only from process.env (app/.env). Add unit tests in text.test.ts for every detector change.
After each change run: cd app && npm run typecheck && npm test. Tell me what to test by hand with a real call.
```
