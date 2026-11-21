# Team plan — who does what

Read your own sheet, then this page. Product spec: [PRD](../PRD.md). Code guide: [app/README.md](../../app/README.md).

| Person | Sheet | Mission in one line |
|---|---|---|
| **A** | [A-vision.md](A-vision.md) | The webcam sees you: away/back, mouth moving, camera health, gestures |
| **B** | [B-audio.md](B-audio.md) | Tap hears the call: audio capture, local speech-to-text, name & trouble detection |
| **C** | [C-agent-haptics.md](C-agent-haptics.md) | Tap decides and acts: agent, AI summaries, mouse haptics — **and joins everyone's work** |
| **D** | [D-ui.md](D-ui.md) | Tap looks great: overlay cards, main window, check-up, IT view, demo script |

> Change from the earlier plan: **D is pure UI** (our UI enthusiast). **C owns integration** because the agent is where everything meets.

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
