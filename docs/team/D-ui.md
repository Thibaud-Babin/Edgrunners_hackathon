# D — UI (overlay, main window, check-up, IT view) + demo script

**Mission:** everything the judges **see**. The overlay cards that float over Zoom, the main window (check-up, activity, IT view), and how Tap looks and feels in a 3-minute demo. You also own the demo script.

You have full freedom on design, as long as you keep the two plugs below unchanged.

> 📣 **Update from B (Sat 17:45):**
> - The counter text is now "video stays on this laptop".
> - New `decision` log lines start with `Speech:` (which engine is running, and switches).
> - Expect frequent `FLASH` commands when the mouse is absent.
> - `npm run dev:e2e` runs the whole loop without a webcam.
>
> Details: [team README](README.md#-update-from-b-audio-sat-1745--read-this).

> 📣 **Update from A (gaze is the default away source):**
> - Away decisions come from the Logi Gaze Tracker; MediaPipe head pose is the automatic fallback. MediaPipe still drives mouth, gestures, and camera health.
> - **Implemented in `main.ts`:** a **Check-up** row (`Away detection`: Gaze Tracker / pose fallback + fix hint), a **one-time non-blocking toast** when `activeSource` becomes `'pose'` in gaze mode, and a **Settings → Attention → Use the Gaze Tracker** toggle. **No haptic** for tracker status — that channel is for meeting problems.
> - Import from `./vision` (do not edit it): `getAwayMode()`, `setAwayMode('gaze' | 'pose')`, and `gazeStatus()` → `{ mode, activeSource, fallbackReason, connected, calibrated, lastSnapshotAt, lastFaceAt, lastGazeAt }`.
> - Force pose for testing: `localStorage.setItem('tap:awayMode','pose'); location.reload()`.
>
> Details: [A-vision](A-vision.md).

## Your files
- `app/src/renderer/index.html`, `overlay.html`, `src/style.css`, `src/main.ts`, `src/overlay.ts`
- New UI files under `app/src/renderer/src/ui/` (components, icons, fonts in `public/`)
- `demo/` script and IT-view data (`demo/it-data.json`)
- **Don't edit:** `shared/events.ts` (ask C), `vision.ts` (A), `audio.ts` (B), anything in `src/main/` (C).

## The two plugs (don't change them, everything else is yours)
1. **In:** `window.tap.onUi(cmd => …)` — render each `UiCommand` from `events.ts`:
   | Command | Where | What it should look like |
   |---|---|---|
   | `SHOW_AWAY_SUMMARY` | overlay | **the hero card**: "While you were away (25 s)", the question to you big and highlighted, 1–3 line summary, full transcript collapsible |
   | `SHOW_RECAP` | overlay | "You were addressed" + question + summary |
   | `SHOW_FIX` | overlay | problem + one big fix button |
   | `SHOW_REPLY` (P1) | overlay | "You answered: Yes" confirmation |
   | `FLASH` | overlay | screen-edge flash (fallback when the mouse can't vibrate) |
   | `LOG_ENTRY`, `COUNTERS` | main window | activity panel + "AI calls · cost · video stays on this laptop" |
   | `SWITCH_MIC` | main window | already handled in `main.ts` (keep it working) |
2. **Out:** user clicks → `window.tap.emit(makeEvent('USER_CLICK', 'ui', { action_id, args }))` with an `action_id` from `ALLOWED_ACTIONS`. Card buttons: `dismiss_card`, the fix's `action_id`.

Overlay rule: the overlay window ignores the mouse **except over cards** — keep calling `window.tap.setOverlayInteractive(true/false)` on card mouseenter/mouseleave, or Zoom underneath stops receiving clicks.

## Tasks, in order
| When | Task | Done when |
|---|---|---|
| Sat 12:00–13:00 | `npm install`, `npm run mock`: watch the fake meeting play, see both windows and the cards. Decide the look (dark cards, big readable text from 2 m away / on a projector, one accent colour, calm motion). | Design direction chosen |
| 13:00–15:00 **spike** | Overlay over a **real Zoom/Meet window**: cards readable, clicks pass through to Zoom when not on a card, overlay visible in screen share. | Works over Zoom |
| 15:00–19:00 | Redesign the cards (hero = away summary). Main window → tabs or sections: **Check-up · Activity · IT view · Dev tools** (keep dev tools, the team needs them). Write the **demo script v1** (PRD §10) with C. 19:00: record backup video v1 with C. | Cards look demo-ready |
| 20:00–02:00 | **Check-up screen (P0-5)**: pass/fail rows for camera running, face in frame, frozen, lighting (from A's `cameraHealth()`), mic level (from `MIC_LEVEL`), input device list; a fix hint per failed row. **Activity panel** judges can read (icons per kind, cost column, newest on top). | Check-up shows real values |
| 02:00–09:00 (P1) | **IT view (P1-4)**: one screen for the company's IT team: time lost in meetings by problem type, problems fixed, small "agent health" box (alerts dismissed, AI calls/cost, commands blocked). Use simulated data from `demo/it-data.json`, **clearly labelled "simulated"**, plus our live counters on top. | IT view ready for Nexthink |
| Sun 09:00–11:30 | Freeze. Slides with everyone, final video, rehearsals. | Submitted |

## How to test alone
`npm run mock` (plays `demo/mock-events.json`) + the dev buttons/text box. Ask C to add mock lines for any card you want to see.

## Framework?
Plain TypeScript + CSS is set up. If you really want React/Svelte/Tailwind, add it **in the first hour only**, inside `src/renderer/` (Vite plugin in `electron.vite.config.ts` → tell C), and keep the two plugs above identical.

## Pitfalls
- The overlay is transparent: anything with a background in `body.overlay` blocks the view of Zoom.
- Test at the projector/demo screen resolution; text that is fine on your laptop may be tiny on stage.
- No business logic in the UI: decide nothing, only render commands and emit clicks.
- Never hide the overlay from screen share (no content protection): Tap is an accessibility tool, not a stealth tool.

## Agent directives (paste to your AI coding agent)
```
I am person D (UI) on the Tap project. Read AGENTS.md and docs/team/D-ui.md first.
You may edit ONLY: app/src/renderer/index.html, app/src/renderer/overlay.html, app/src/renderer/src/style.css,
app/src/renderer/src/main.ts, app/src/renderer/src/overlay.ts, new files under app/src/renderer/src/ui/ and app/src/renderer/public/, and demo/ (script, it-data.json).
Do not edit app/src/shared/events.ts, vision.ts, audio.ts, or anything in app/src/main/.
The UI only renders UiCommand messages received with window.tap.onUi() and sends USER_CLICK events with window.tap.emit(makeEvent('USER_CLICK','ui',{action_id,args})) using action_ids from ALLOWED_ACTIONS. No decision logic in the UI.
In the overlay, keep calling window.tap.setOverlayInteractive(true/false) on card mouseenter/mouseleave so clicks pass through to the meeting app.
Design goals: readable from 2 m / on a projector, dark translucent cards, one accent colour, calm animations, accessible contrast.
Ask me before adding any framework or dependency.
After each change run: cd app && npm run typecheck && npm run mock and describe what I should look at.
```
