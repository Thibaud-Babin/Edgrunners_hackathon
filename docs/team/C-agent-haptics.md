# C — Agent, AI summaries, haptics + integration

**Mission:** Tap's brain and voice. Turn everyone's events into decisions (recap, "while you were away", fixes), call the cloud AI only when needed, make the MX Master 4 vibrate, and **own the end-to-end integration** (you run the 19:00 demo loop).

## Your files
- `app/src/main/agent/` (`agent.ts`, `llm.ts`), `app/src/main/haptics.ts`, `app/src/main/bus.ts`, `app/src/main/mock.ts`
- `app/src/main/index.ts` (wiring; tell D if you change window setup)
- `plugins/haptics/` (own C# plugin, P1), `demo/mock-events.json`
- **Guardian of** `app/src/shared/events.ts`: you review every `contract:` PR.
- The Rule 30 table in `docs/PRD.md` §6 (keep it updated: what we reused vs built).

## What you receive / send
- **Receive:** every event (A, B, D).
- **Send to UI (D renders them):** `SHOW_RECAP`, `SHOW_AWAY_SUMMARY`, `SHOW_FIX`, `SHOW_REPLY` (P1), `SHOW_REPLIES` (P2), `SWITCH_MIC`, `DISMISS`, `FLASH`, `LOG_ENTRY`, `COUNTERS`.
- **Haptics:** `knock` = addressed · `ringing` = question to the group · `completed` = fix done · `angry_alert` = problem · `subtle_collision` = gesture seen.

Already done in `agent.ts`: name → knock → recap; away → name/back → away summary; mouth moving + silent mic → alert + fix card; others can't hear → fix card; allowlist executor; log + counters.

## Tasks, in order
| When | Task | Done when |
|---|---|---|
| Sat 12:00–13:00 | Update **Logi Options+** (≥ 1.95) and the MX Master 4. Install **HapticWeb** (Logi Marketplace). Test: `curl -X POST -d "" https://local.jmw.nz:41443/haptic/knock`. If it fails: add `127.0.0.1 local.jmw.nz` to `C:\Windows\System32\drivers\etc\hosts`. Create `app/.env` from `.env.example`. | The mouse knocks from curl |
| 13:00–15:00 **spike** | `npm run mock`: the mouse knocks on the name, buzzes on problems. Add `ANTHROPIC_API_KEY`; check summary quality and latency on the mock meeting (target ≤ 3 s; add a 3 s timeout → template fallback). Set real prices in `llm.ts` (`TAP_PRICE_IN/OUT`). | Real summaries in cards, cost in counters |
| 15:00–19:00 **integration** | Pull A's and B's branches as they land and make the **real loop** work: look away (A) → name said in a real call (B) → knock → away card (D). Fix timing (e.g. recap waits 1.5 s for the sentence to finish). Record **backup video v1** with D at 19:00. | Loop works live, video recorded |
| 20:00–02:00 | Make the activity log **readable for judges** (clear reasons: "Name heard → knocked → summarised 25 s while you were away"). Debounce: no double knocks, no card spam. Event timing rules (away < 2 s ignored, cooldowns). | Log reads like a story |
| 02:00–09:00 (P1) | Gestures → actions: nod → `SHOW_REPLY "Yes"`, shake → "No", brow raise → confirm the fix card. Own C# haptics plugin (see `plugins/haptics/README.md`) so we don't depend on HapticWeb's DNS/cert. | Gesture replies work |
| Sun morning | Freeze, help rehearse; check Rule 30 table is complete. | — |

## How to test alone
`npm run mock` (fake meeting) and the dev buttons/text box in the main window. Edit `demo/mock-events.json` to script new situations.

## Pitfalls
- HapticWeb downloads its certificate on first run and needs `local.jmw.nz` to resolve → do the first run at home, keep the hosts-file fix ready.
- Keep the AI prompt treating the transcript as quoted data (already in `llm.ts`); never let transcript text pick an action.
- The cloud AI needs Wi-Fi: the template fallback must keep the demo working (test with Wi-Fi off).
- Logitech research notes: `docs/research/build/logitech_hackathon_docs.md`.

## Agent directives (paste to your AI coding agent)
```
I am person C (agent, AI summaries, haptics, integration) on the Tap project. Read AGENTS.md and docs/team/C-agent-haptics.md first.
You may edit: app/src/main/agent/**, app/src/main/haptics.ts, app/src/main/bus.ts, app/src/main/mock.ts,
app/src/main/index.ts, plugins/haptics/**, demo/mock-events.json, and the Rule 30 table in docs/PRD.md §6.
Edit app/src/shared/events.ts only for additive changes I confirm the team agreed (never rename/remove).
Do not edit renderer/UI files (that's D) or audio/vision files (B, A) — tell me what they need instead.
Use the official Anthropic TypeScript SDK (@anthropic-ai/sdk) for the summaries; model from TAP_LLM_MODEL; keep the offline template fallback and a 3 s timeout.
Transcript text must never reach Agent.execute(); only USER_* events may trigger actions from the allowlist.
Every decision and action must produce a readable LOG_ENTRY.
After each change run: cd app && npm run typecheck && npm test && npm run mock (check the terminal for errors).
```
