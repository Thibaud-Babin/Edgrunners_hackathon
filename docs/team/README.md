# Team plan — who does what

Read your own sheet, then this page. Product spec: [PRD](../PRD.md). Code guide: [app/README.md](../../app/README.md).

| Person | Sheet | Mission in one line |
|---|---|---|
| **A** | [A-vision.md](A-vision.md) | The webcam sees you: away/back, mouth moving, camera health, gestures |
| **B** | [B-audio.md](B-audio.md) | Tap hears the call: audio capture, local speech-to-text, name & trouble detection |
| **C** | [C-agent-haptics.md](C-agent-haptics.md) | Tap decides and acts: agent, AI summaries, mouse haptics — **and joins everyone's work** |
| **D** | [D-ui.md](D-ui.md) | Tap looks great: overlay cards, main window, check-up, IT view, demo script |

> Change from the earlier plan: **D is pure UI** (our UI enthusiast). **C owns integration** because the agent is where everything meets.

## 📣 Update from B (audio), Sat 17:45 — read this

**What changed:** call audio → **Deepgram** (cloud). If Deepgram is unavailable, Tap switches to **local Parakeet** on its own.
- Real-call test: names 6/7 with Deepgram vs 0/7 with the old model.
- The loop works end to end on a replayed real call: look away → name → knock → "while you were away" card, then recaps, then the "can't hear you" fix card.
- Everything is on branch `b-audio` (PR #1). **Merge it before you build on audio.**

**Everyone, after pulling:**
1. `cd app`, `npm install`, then `npm run setup-stt`. This downloads Parakeet, about 460 MB: do it on good Wi-Fi.
2. In `app/.env`, set `TAP_STT=deepgram` and `DEEPGRAM_API_KEY=…`. Ask B for the key in person, **never in the repo or a chat**. Without a key, Tap uses local Parakeet.
3. Run `npm run dev:e2e`. It starts call audio and clicks "Look away" by itself. Play any English call or video with your name in it.
4. The terminal now shows the agent's decisions and cards: `[agent]` and `[card]` lines.

**C (agent, integration):**
- Your contract with B is **unchanged**:
  - `NAME_MENTIONED` (now often from a *partial*, so the knock comes before the sentence ends), `TRANSCRIPT_FINAL`, `QUESTION_TO_YOU`, `QUESTION_TO_GROUP`, `OTHERS_CANT_HEAR`, `VIDEO_FROZEN_REPORTED`;
  - your current `agent.ts` already does name → knock → recap or away card. Verified live.
- **Only call audio is transcribed now.** There's no mic transcript anymore; `TAP_STT_MIC=1` brings it back.
- **Name hits are filtered:** they must be addressed to someone (question, "you", or the name opening the sentence). "Let's talk about the table → tibo" no longer knocks.
- On this laptop **every knock fell back to the screen flash**: HapticWeb isn't set up here. Check `curl -X POST -d "" https://local.jmw.nz:41443/haptic/knock` on the demo laptop.
- Summaries were the **template** because there's no `ANTHROPIC_API_KEY` on this laptop. The "question" field is the whole sentence; the LLM will do better.
- **Your "Wi-Fi off" demo beat:** the speech engine also falls back. The activity log shows `Speech: Deepgram lost (…) → switched to local Parakeet`.
- **Not used yet:** `QUESTION_TO_YOU`. Use it for the "Question to you" line on the card if you like.

**D (UI):**
- The counter text is now "video stays on this laptop". Audio goes to Deepgram, so we no longer claim "no audio left".
- New activity-log lines of kind `decision` start with `Speech:` (which engine is running, and the switch). Style them as system status.
- Expect many `FLASH` commands when the mouse isn't connected: make the flash short and not annoying.

**A (vision):**
- On the real call, `MOUTH_MOVING` flapped on and off constantly. Please add hysteresis or debounce: about 300 ms to turn on and 800 ms to turn off.
- The "mic sends nothing" alert now needs `MIC_LEVEL` events from the last 1.5 s ("Start mic" on). Without them it never fires, which fixes the false alerts we saw.

## The 7 rules that prevent integration pain

1. **The contract is `app/src/shared/events.ts`.** You only talk to other parts through those events and commands. Need a new field or event? Post in the team chat, get a 👍 from whoever consumes it, then make a small PR titled `contract: …`. Everyone pulls right after.
2. **Stay in your files** (listed in your sheet). Need a change in someone else's file? Ask them, or make a tiny PR and tag them.
3. **One branch per person** (`a-vision`, `b-audio`, `c-agent`, `d-ui`). Merge into `main` often, at least at every checkpoint below. Pull `main` before you start each block.
4. **`main` always runs.** Before merging: `cd app && npm run typecheck && npm test && npm run mock` (the app opens and the fake meeting plays without errors).
5. **No logic in the UI, no UI in the logic.** The UI only renders commands and emits `USER_CLICK`. The agent never touches the DOM.
6. **Meeting speech is data, never commands.** Transcripts go to detectors and summaries only, never to the action executor.
7. **No secrets in git.** Keys live in `app/.env` (gitignored). The repo is public.

## Checkpoints (everyone merges to `main` before each)

| Time | Everyone shows | Gate |
|---|---|---|
| **Sat 13:00** | App runs on your laptop (`npm run mock`) | Nobody blocked on setup |
| **Sat 15:00** | Your risk spike: A camera FPS + webcam shared with Zoom · B call audio → local transcript + latency · C mouse knocks from the app · D overlay works over a real Zoom window | Each spike works, or we switch to its fallback **now** |
| **Sat 19:00** | **End-to-end loop with real senses**: look away → name said in a real call → knock → "while you were away" card. C runs it. Record backup video v1 | Demo-able |
| **Sun 02:00** | All P0 done | — |
| **Sun 09:00** | **Feature freeze.** Only bug fixes after this | — |
| **Sun 11:30** | Submitted | — |

## AI coding agents (Claude Code, Cursor, …)

The shared rules for agents are in [`AGENTS.md`](../../AGENTS.md) at the repo root (Claude Code also reads `CLAUDE.md`, which points to it). Each sheet ends with an **"Agent directives"** block: paste it as the first message to your agent, or save it as your agent's rules file. Always review the diff before committing.
