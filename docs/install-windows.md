# Install and use Tap on Windows

Tap is a desktop app for Windows 10/11 (64-bit). It runs next to Zoom, Teams or Google Meet. A transparent overlay on the right of the screen shows live captions and alerts, and Tap keeps working from the system tray while the main window is closed.

## 1. Download
1. Open the repository on GitHub → **Actions** → **Windows build** → the latest green run.
2. Under **Artifacts**, download **Tap-Windows** (a zip) and unzip it. It contains two files:
   - `Tap-Setup-<version>.exe`: the installer (recommended).
   - `Tap-Portable-<version>.exe`: no installation. Double-click to run; it unpacks itself each time it starts, so it opens more slowly.

Tap is not code-signed. Windows SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**.

## 2. Install
Run `Tap-Setup-<version>.exe`. It installs for your user only (no admin rights needed), lets you choose the folder, and creates Start-menu and desktop shortcuts. To uninstall, use Windows Settings → Apps → Tap.

## 3. First start: settings
Tap needs a few settings that are never shipped inside the app, because API keys are private.
1. Start Tap. Its icon appears in the system tray, bottom-right; click the ^ arrow if it is hidden.
2. Right-click the tray icon → **Open settings file**. This opens `%APPDATA%\tap\.env` (full path: `C:\Users\<you>\AppData\Roaming\tap\.env`) in Notepad. Tap creates the file on first start.
3. Fill in:
   - `DEEPGRAM_API_KEY=`: **required for speech.** Live captions, name detection, contextual alerts and meeting summaries all need it. Get a key at deepgram.com.
   - `TAP_USER_NAMES=`: your first name, then nicknames or common misspellings, comma-separated. For example: `TAP_USER_NAMES=Thibaud,Thibault,Tibo`.
   - `ANTHROPIC_API_KEY=`: optional. Gives AI-written recaps and summaries. Without it, Tap builds them from the transcript itself.
4. Save, then tray icon → **Quit**, and start Tap again.

Without a Deepgram key Tap still opens. It then shows on the overlay and in Activity: "No speech-to-text: … need DEEPGRAM_API_KEY". There are no captions or name alerts until you add the key. The installer does **not** include a local speech model.

## 4. Use it in a meeting
1. Join your meeting in Zoom, Teams or Meet as usual. Leave your meeting app's microphone set to **Default**.
2. In Tap's main window, open **Check-up** and click **Start call audio**. Tap listens to what the meeting plays on your PC (Windows system audio). It never starts listening by itself. Tap transcribes **only this meeting audio**: your own microphone is never transcribed, and `Start mic` only feeds the microphone checks. If nothing is playing, there is nothing to caption, so test with a video or a real call.
3. Optional, and they do different things: **Start camera** enables look-away detection and the "talking while muted" card (it needs mouth movement); **Start mic** enables microphone quality and "your mic sends nothing". Windows' own microphone state (muted, volume, which device) is read automatically, without Start mic.
4. Close the main window. Tap keeps running in the tray, and the overlay stays on top of other windows:
   - live captions at the bottom of the overlay (turn them on or off in Settings → Live captions);
   - a knock and a card when someone says your name, with what was being discussed;
   - a card when someone says they can't hear you, with a fix button;
   - a meeting summary when the call ends ("bye" + 15 s of silence), or click **Summary** on the overlay pill.
   Clicks go through the overlay to your meeting app, except on Tap's cards and buttons.
5. Tray icon menu:
   - **Open Tap**: reopen the main window. Double-clicking the icon does the same.
   - **Stop Monitoring**: stop the call audio, mic and camera Tap is using.
   - **Open settings file**: edit `%APPDATA%\tap\.env`.
   - **Quit**: close Tap completely, including its background helpers.

Only one Tap runs at a time. Starting it again just reopens the running one.

> **Windows camera sharing (needed when the meeting app also uses the camera).** By default a webcam allows one app at a time: Zoom/Meet may lose the camera while Tap holds it. Windows 11 → Settings → Bluetooth & devices → Cameras → **<your camera>** → Advanced camera options → enable **"Allow multiple apps to use the camera at the same time"**. The Logi Gaze Tracker also opens the camera, so keep this on for gaze mode too. Details: `app/README.md` and `docs/team/A-vision.md`.

## 5. What needs what

| Feature | Needs |
|---|---|
| Live captions, name detection, contextual alerts, meeting summary text | `DEEPGRAM_API_KEY` |
| AI-written recaps and summaries | `ANTHROPIC_API_KEY` (optional; otherwise built from the transcript) |
| Your name recognised | `TAP_USER_NAMES` |
| "They can't hear you" fixes (unmute, switch mic, volume) | Windows (built in; uses PowerShell, no setup) |
| "You are talking but muted in Windows" card | `Start camera` (mouth movement) + Windows mic state (built in) |
| Vibrations on the mouse | Logitech MX Master 4 + Logi Options+ with the HapticWeb plugin (otherwise the screen flashes) |
| Look-away detection | A webcam; Logi Gaze Tracker optional (otherwise head pose from the webcam) |
| Real speaker names in Google Meet | Optional Chrome extension: `chrome://extensions` → Developer mode → **Load unpacked** → `<install folder>\resources\extension\meet-names` |

## 6. Limitations
- Speech-to-text needs a Deepgram key and an internet connection. No offline model is bundled (it would add about 640 MB).
- Not code-signed, so SmartScreen warns on first run.
- Windows 10/11, 64-bit only. Call-audio capture and the mic fixes rely on Windows.
- Settings are edited in a text file (there is no settings form for keys yet). Restart Tap after editing.

## 7. Test checklist (Windows)
Fill in ✅/❌ after testing on a real Windows PC.

| # | Check | ✅/❌ | Notes |
|---|---|---|---|
| 1 | The installer runs and installs Tap | | |
| 2 | The portable exe starts | | |
| 3 | Tap starts from the Start menu (no VS Code, no npm) | | |
| 4 | Main window opens; closing it hides Tap to the tray (one notice says so) | | |
| 5 | Call audio keeps working with the main window closed or minimised | | |
| 6 | Tray: Open Tap, Stop Monitoring (greyed out when nothing is running), Open settings file, Quit | | |
| 7 | Overlay stays above Meet/Teams/Zoom; clicks pass through except on cards | | |
| 8 | Live captions show real call speech (with a Deepgram key) | | |
| 9 | Your name said in the call → knock + card with the context | | |
| 10 | Meeting summary after "bye" + 15 s, and with the Summary button | | |
| 11 | "We can't hear you" → mic card with a working fix | | |
| 12 | Stop Monitoring stops the capture; Quit leaves no `Tap.exe` or `powershell.exe` in Task Manager | | |
