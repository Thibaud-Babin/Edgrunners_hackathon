# Handoff: make the agent react to the audio events again

**Goal:** C's new agent (branch `c/agent-split`) keeps "look away → look back → recap", but it ignores your name and the other audio events. This task adds those reactions back **inside C's new architecture**, so Tap has both C's recap and the features below.

**Who:** one teammate. Pair with **C** (agent owner) for the design and with **D** for the cards. B answers questions about the events.
**Time:** about 3–4 h for F1–F8. F9–F12 are optional.

## What already exists (don't rebuild it)
- **B's audio (on `main`) already sends every event below.** They are listed in `app/src/shared/events.ts`, and the `[stt]` lines in the terminal show them live.
- **C's gate already allows audio detectors to trigger actions** (`MAY_TRIGGER.detector = true` in `executor.ts`), and the haptic action `send_haptic` still exists.
- **A reference implementation exists:** the OLD single-file agent on `main` (`app/src/main/agent/agent.ts`) does F1–F10 and was tested live on a real call. Port its behaviour; don't copy its structure.

## The four places to change in C's code
1. **`agent/schemas.ts`**, `DetectorHit`: add the event types to the `type` enum, and the fields you need (`partial`, `latency_s`, `question`, `topic`, `level`, …).
2. **`agent/audio-agent.ts`**, `DETECTOR_EVENTS`: add the same event types, so they're forwarded to the agent bus as `detector` envelopes. The comment there says name events are "not needed anymore"; change it.
3. **`agent/rules.ts`**, `decide()`: add `else if (env.kind === 'detector') onDetector(d, …)`. Rules stay pure functions and return `ActionRequest`s.
4. **`agent/schemas.ts`** `ActionRequest` + **`agent/executor.ts`**: add the actions that show cards (`show_recap`, `show_nudge`, `show_fix`) and run them. They are notify-only (T0), like `show_away_summary`.

Add a test in `rules.test.ts` / `executor.test.ts` for each feature, using the same style as C's away/back tests.

## The features

| # | Feature | Trigger (B's event) | What Tap must do | Priority |
|---|---|---|---|---|
| **F1** | **Name knock** | `NAME_MENTIONED` (often `partial: true`, i.e. before the sentence ends) | Fire `send_haptic knock` **immediately**, once per sentence. Target: the knock within ~1.5 s of the name being said. | **P0, demo core** |
| **F2** | **Recap card when named** | `NAME_MENTIONED` then the next `TRANSCRIPT_FINAL` (or 4 s timeout) | Ask the audio agent for a summary of the **last ~10 s**, then show a recap card: summary + "question to you". Reuse C's `summary.request` flow. | **P0** |
| **F3** | **Called while away** | `NAME_MENTIONED` while `state.awayFrom !== null` | Don't wait for the user to look back: knock + show the **away summary right away** (from `awayFrom` to now, `trigger: 'name'`), then reset `awayFrom`. | **P0, demo step 2** |
| **F4** | **"They're waiting for you"** | `WAITING_FOR_YOU` `{question, silent_s, mic_monitored}` | `knock` twice (~250 ms apart) + nudge card "They're waiting for your answer" + the question. Close the card after ~12 s. | P1 |
| **F5** | **Knock-speed log** | `NAME_MENTIONED.latency_s` + `latency_ref` | Log line: "knock 1.4 s after your name was said". It's a number for the pitch. | P1 (10 min) |
| **F6** | **Question to the group** | `QUESTION_TO_GROUP` | `send_haptic ringing` + log | P1 |
| **F7** | **Others can't hear you → fix** | `OTHERS_CANT_HEAR` (already reaches C's agent, but only for the check-up) | `angry_alert` + fix card "Switch to laptop mic". **Clicking** it runs `switch_input_device`, which must be a `user`-triggered action, never automatic. | P1, demo step 4 |
| **F8** | **Topic heads-up** | `TOPIC_MENTIONED` `{topic}` (words come from `TAP_TOPICS`) | `send_haptic damp_state_change` + log "topic X mentioned" | P2 |
| **F9** | **Mic quality advice** | `MIC_QUALITY` `{level: ok / too_quiet / clipping / noisy}` | If the level isn't `ok` for more than 10 s, show a fix card suggesting the laptop mic, at most once every 2 min. B only measures; this is the decision. | P2 |
| **F10** | **Speech cost in the counter** | `STT_USAGE` `{engine, seconds, cost_usd}` every 30 s | Add `cost_usd` to the cost counter (it's the running total, so add the difference). AXA: every cent visible. | P2 (10 min) |
| **F11** | **Speaker names in summaries** | `speaker: "Speaker 2"` on `TRANSCRIPT_FINAL` | Prefix transcript lines with the speaker **only once 2+ voices were heard**, so a card can say "Speaker 2 asked you…". | P2 |
| **F12** | **Live captions** | `CAPTION` UI command, sent by `index.ts` (not by the agent) | Make sure it survives the merge of `index.ts`. **D** renders it (big, high-contrast strip with the name highlighted). | P1, D's side |

*Already done in C's branch, nothing to do:* instruction-like speech is logged as ignored (`looksLikeInstruction` in `audio-agent.ts`).

## Cards D must render (UI commands, in `shared/events.ts`)
- `SHOW_RECAP {id, transcript, summary, question?}`: F2
- `SHOW_AWAY_SUMMARY {…, trigger: 'name' | 'looked_back'}`: F3 (already rendered)
- `SHOW_NUDGE {id, text, question?}`: F4
- `SHOW_FIX {id, problem, fix_label, action_id}`: F7 and F9, with a button that emits `USER_CLICK {action_id}`
- `CAPTION {text, final, speaker?, highlight?}`: F12

D's redesign (`devin-omama`) may have removed the fix and recap cards on C's advice. They need to come back.

## Haptic vocabulary (in `shared/events.ts`, `HAPTIC`)
| Meaning | Waveform |
|---|---|
| your name | `knock` |
| they're waiting for you | `knock` × 2 |
| question to everyone | `ringing` |
| problem | `angry_alert` |
| fixed | `completed` |
| topic | `damp_state_change` |

## How to test (no webcam or call needed)
1. `cd app`, `npm install`, `npm run setup-stt`. In `.env`, set `TAP_STT=deepgram` and the keys; ask B in person.
2. `npm run dev:e2e`: starts call audio and clicks "Look away".
3. Play B's real-call recording through the speakers. Ask B for `session-2026-11-21T15-58-43-call_audio.wav`; it isn't in git.
4. In the terminal, check the lines in order: `NAME_MENTIONED … s after the name` → `[agent] action: send_haptic knock` → `[card] WHILE YOU WERE AWAY …`, then `[card] RECAP …`, a `NUDGE`, `FIX` after "we can't hear you", and the topic "budget".
5. Without audio: type sentences in the dev text box ("So Thibaud, are you OK with Friday?").

**Done when:** on the replayed call, the knock and away card come on the first name, recaps come on later names, the nudge fires after "are you ready for Friday?", the fix card fires on "we can't hear you", and C's existing away → back recap still works (C's tests stay green).

## Order of work
1. **First, the team agrees on the product** (see the comparison: `main` = accessibility + name knock, C's branch = attention recap only). This handoff assumes **both**.
2. **C merges `main` into `c/agent-split`**, resolving the conflicts by keeping C's split. B's old handlers in `agent.ts` go away; this handoff replaces them.
3. **Teammate:** F1 → F3 → F2 (demo core), then F7, F4, F5, F6, then the rest.
4. **D:** renders the cards and captions in the new UI.
