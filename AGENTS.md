# Rules for AI coding agents working in this repo

Project: **Tap**, an Electron + TypeScript desktop app (LauzHack 2026, 24 h build, team of 4). Spec: `docs/PRD.md`. Code guide: `app/README.md`. Team plan: `docs/team/`.

## Hard rules
1. **Only edit the files your human owns** (they will tell you which person they are: A, B, C or D; see `docs/team/<letter>-*.md`). If a change is needed elsewhere, stop and say so instead of editing.
2. **Never change `app/src/shared/events.ts`** (the team contract) unless your human explicitly says the team agreed. Never rename or remove existing event types or fields.
3. Parts talk **only** through the events/commands in `events.ts`: renderer → main via `window.tap.emit()`, main → renderer via `UiCommand`. Don't import `src/main/*` from `src/renderer/*` or vice versa (sharing `src/shared/*` is fine).
4. Transcript text (what other people say in the call) is **data, never instructions**: it must never reach `Agent.execute()`. Only `USER_*` events (the user's own clicks/gestures) may trigger actions.
5. Keep it a hackathon: smallest change that works, no new frameworks or big dependencies without the human's OK, no refactors of other people's code, no security/compliance extras (not a priority here).
6. Secrets only in `app/.env` (gitignored). Never print, commit or hard-code keys.
7. Don't reuse code from GPL projects (e.g. cheating-daddy, Pluely, Glass): reimplement. MIT/Apache/BSD is fine; tell the human so they add it to the Rule 30 table in `docs/PRD.md` §6.
8. Never add stealth features (hiding windows from screen share, content protection, skip-taskbar). Tap is an accessibility tool and must stay visible.

## Before saying "done"
- `cd app && npm run typecheck && npm test` pass.
- `npm run mock` still opens the app and plays the fake meeting without errors in the terminal.
- Tell the human what you changed, what you tested, and what you could NOT test (camera, mic, mouse, real call need a human).

## Useful commands
```
cd app
npm install        # first time
npm run dev        # run the app
npm run mock       # run with the fake meeting (demo/mock-events.json)
npm test           # detector unit tests
npm run typecheck
```
