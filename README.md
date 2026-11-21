# LauzHack 2026 — Project name TBD

> Our team's project for [LauzHack 2026](https://lauzhack.com) (Lausanne).
> **Status:** idea phase. This README will be updated during the hackathon.

## The idea (in one line)

Turn an ordinary webcam into the **eyes and ears of an accessibility assistant**, so that deaf, hard-of-hearing and non-speaking people can take part fully in video calls and everyday conversations.

## Candidate projects (to vote on)

Full analysis, build plans and sources: **[docs/project-ideas.md](docs/project-ideas.md)**. Research notes are in [docs/research/](docs/research/).

| Rank | Project | What it does | Main challenges |
|---|---|---|---|
| ⭐ 1 | **Tap**: meeting shoulder-tap | When someone says your name or asks you a question in a call, the MX Master 4 mouse vibrates, the screen flashes and a card recaps the last 10 seconds. Non-speaking users answer with face gestures (eyebrows = raise hand, nod = yes). A daily camera/mic check runs before each call. | Logitech, IMC, AXA, Nexthink |
| 2 | **First Signs**: sign-language coach | Teaches hearing people their first 15–20 signs in Swiss French Sign Language (LSF-CH) with live webcam feedback on hands *and* face, plus haptic "you got it" feedback. | Scholé, IMC, AXA, (Logitech) |
| 3 | **Intent Ring**: hands-free actions | Face gestures and short voice commands trigger whole actions (join call, mute, next slide) through Logitech's Actions Ring. | Logitech, IMC, AXA, Nexthink |
| 4 | **Platform Ears**: train disruptions for deaf travellers | Transcribes station announcements, matches them to your own journey and gives a simple reroute with a vibration alert. | SBB, IMC, AXA |

**Recommendation:** Tap. Choose First Signs *instead* only if we want Scholé and can find a Deaf LSF-CH signer to check the signs.

**Tap's extended design** (Nexthink "silent tech pain" detection, agent security, activity log and IT view): **[docs/tap-agent-design.md](docs/tap-agent-design.md)**.

**To check on Saturday morning:**
- Does a meeting tool already alert deaf users when they are addressed? (Ask the Logitech booth and a deaf or hard-of-hearing attendee.)
- Can the Logitech mentors help us with the MX Master 4 haptics SDK?

## Challenges we are targeting

| Challenge | Why it fits |
|---|---|
| **LauzHack Main Ranking** | All projects take part |
| **Logitech**: the webcam as the intelligent eyes and ears of AI | Webcam + mic as the AI's senses, the haptic mouse as its output |
| **IMC**: IMChange, Tech for Good | Inclusion for people with hearing or speech disabilities |
| **AXA**: frugal multimodal AI | Vision and speech run on the laptop; the AI model is only called on events |
| **Nexthink**: digital employee experience | Daily "is my camera and mic working?" check before calls |

LauzHack rules allow one project to win several prizes (top overall + challenge prizes).

## Tech stack (tentative)

- App: TypeScript + Vite, running in the browser
- Face and hand landmarks: MediaPipe (`@mediapipe/tasks-vision`), in a web worker
- Captions: Web Speech API (Chrome/Edge), Deepgram as fallback
- AI summaries: a small, cheap LLM behind a tiny proxy, called only when an event fires
- Haptics: Logitech Actions SDK plugin (C#) for the MX Master 4; HapticWeb plugin for early prototyping
- Into Zoom/Meet/Teams: OBS browser source + virtual camera

## Repository structure

TBD

## Getting started

TBD — setup and run instructions will be added once the stack is chosen.

## Team

| Name | Role |
|---|---|
| Thibaud | TBD |
| | |
| | |

## License

TBD
