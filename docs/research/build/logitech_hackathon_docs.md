# Logitech hackathon docs and Logi Actions SDK: what Tap can use (researched 2026-11-21)

Note: WebFetch returns pages condensed by a small model, so I could not copy long passages word for word. Commands, paths, YAML, and API names below are as the fetch tool reported them. Re-check anything marked UNVERIFIED.

## 1. What Logitech provides for hackathons (logitech.github.io/hackathons)

### Takeaway
The hub page links to SDKs only. It does not list hardware loans, mentors, or judging criteria. Two SDKs matter for Tap. The first is the Actions SDK, with a haptics tutorial, a demo template repo, and a doc zip for AI agents. The second is the LogiInsight webcam Python SDK, which does on-device face detection with a 478-point face mesh, gives IR video, and has a 2-mic array. Community WebHID libraries also exist for MX Master 4 haptics.

### Cited Findings
- PC Peripherals section, as listed on the hub page — [Hackathons hub](https://logitech.github.io/hackathons/):
  - **LogiInsight Webcam PC Python SDK**: "Build a PC app using the webcam's RGB and near-infrared video, microphone, and on-device face detection/mesh." Device: the LogiInsight hackathon webcam. Links: [Quick start](https://logitech.github.io/hackathons/logiinsight/), [API ref](https://logitech.github.io/hackathons/logiinsight/API), [SDK zip v1.5.2](https://github.com/Logitech/hackathons/releases/download/logiinsight-sdk-v1.5.2/logiinsight_api_sdk_v1.5.2.zip).
  - **Logi Gaze Tracker**: gaze tracking on Windows/Mac. Works with any Logitech webcam. [Setup](https://logitech.github.io/hackathons/logi-gaze-tracker/setup/), [sample code](https://logitech.github.io/hackathons/logi-gaze-tracker/sample-code/), [app release](https://github.com/Logitech/hackathons/releases/tag/logi-gaze-tracker).
  - **Logi Hands Tracker**: hand tracking. Device: the LogiInsight webcam (`LVNext CPD Camera`). [Quick start](https://logitech.github.io/hackathons/logi-hands-tracker/), [release](https://github.com/Logitech/hackathons/releases/tag/hands-tracker).
  - **Actions SDK**: "Build a plugin connecting your app or service to devices (MX Creative Console, Actions Ring, MX Master 4)". Links: [Haptics tutorial](https://logitech.github.io/actions-sdk-docs/csharp/haptics-tutorial/), [Docs](https://logitech.github.io/actions-sdk-docs/), [Demo Plugin Template](https://github.com/Logitech/actions-sdk), [SDK docs for Agents (zip)](https://logitech.github.io/hackathons/res/LogiActionSDK_agent_doc.zip), [Haptics overview](https://logitech.github.io/actions-sdk-docs/csharp/Haptics-Overview/).
  - **WebHID**: [MX Creative Console WebHID lib](https://github.com/mario-gutierrez/mx-creative-console-webhid), [MX Keypad Script Lab](https://github.com/mario-gutierrez/mx-cc-script), [MX Master 4 Haptic Effects WebHID library](https://github.com/mario-gutierrez/mx-master-4-webhid).
  - Lights: [LITRA CLI (JS)](https://github.com/timrogers/litra). Other: a Windows C# [input logger example](https://logitech.github.io/hackathons/res/InputLogger.zip) and input capture/injection docs.
  - Also listed but not relevant to Tap: XR (MX Ink, Muse) and the Gaming SDKs (LED, G-Key, ARX, LCD, wheel).
- Support: [MX collective Discord](https://discord.gg/eYGbhJdSu8) and [Actions SDK & MX devices Discord](https://discord.gg/8TWwHWuymm) — [Hackathons hub](https://logitech.github.io/hackathons/).
- Past events listed: LauzHack 2023, 2019, 2018, 2017 and HackZurich 2020 — [Hackathons hub](https://logitech.github.io/hackathons/).
- The docs ship AI-assistant aids: an `llms.txt` index and an "AI-friendly documentation setup" page (`/ai-friendly-documentation-setup.md`) — [llms.txt](https://logitech.github.io/actions-sdk-docs/llms.txt).

### Inferences
- The hackathon "kit" apparently includes a LogiInsight webcam. Its quick start mentions "the card in your kit" with SSH credentials. Tap should plan to use this camera and not only a laptop webcam: it does on-device face detection and mesh, has 2 mics, and gives IR video.
- Load the agent doc zip and `llms.txt` into Claude Code or Cursor at hour 0.

### Gaps
- I found nothing on hardware loan logistics, mentors, prizes, or judging criteria for LauzHack 2026. These are probably announced at the event or on Discord.
- I did not fetch the Gaze Tracker and Hands Tracker subpages or the agent doc zip contents (tool-call budget). Gaze could serve as a proxy for "is the user looking at the screen".

## 2. Actions SDK install, project creation, lifecycle, local loading, packaging (Windows)

### Takeaway
Install Options+ (it brings Logi Plugin Service) and the .NET SDK (10 now, 8 for Plugin Service before 6.4). Then run `dotnet tool install --global LogiPluginTool`, `logiplugintool generate Tap`, and `dotnet build`. The build writes a `.link` file that makes Plugin Service load the plugin locally with hot reload. No Marketplace approval is needed.

### Cited Findings
- Setup steps — [C# introduction](https://logitech.github.io/actions-sdk-docs/csharp/plugin-development/introduction.md):
  1. Install the latest [Logi Options+](https://www.logitech.com/software/logi-options-plus.html). It also installs **Logi Plugin Service**, which runs plugins.
  2. Install **.NET 10** ([download](https://dotnet.microsoft.com/download/dotnet/10.0)). Use **.NET 8 for Logi Plugin Service versions before 6.4**.
  3. `dotnet tool install --global LogiPluginTool`
  4. `logiplugintool generate Example` creates an `ExamplePlugin` folder.
  5. `cd ExamplePlugin` then `dotnet build`
  6. Check that `C:\Users\USERNAME\AppData\Local\Logi\LogiPluginService\Plugins\ExamplePlugin.link` exists. The link file "tells Logi Plugin Service where to load the plugin during development". Each build updates it.
  7. In Options+, open the customization view for Actions Ring / MX Creative Keypad / Dialpad, go to "All Actions", and find the plugin under "Installed Plugins". If it is missing, use **"Restart Logi Plugin Service"** in Options+ settings.
  - Hot reload: `cd ExamplePlugin\src\` then `dotnet watch build`.
- Debugging: switch to Debug config and use Debug > Start Debugging. The debugger is "pre-configured in the project file" and launches Logi Plugin Service — [Testing & debugging](https://logitech.github.io/actions-sdk-docs/csharp/plugin-development/testing-and-debugging-the-plugin.md).
- Generated layout: `src/package/metadata/LoupedeckPackage.yaml`, `src/package/events/...`, `src/Actions/*.cs` (e.g. `CounterAdjustment.cs`), and a `.sln` — [Haptics tutorial](https://logitech.github.io/actions-sdk-docs/csharp/haptics/haptics-tutorial.md).
- Lifecycle / API: Plugin API 6.4.2.3567. Classes include `Plugin`, `ClientApplication`, `PluginDynamicCommand`, `PluginDynamicAdjustment`, and `PluginDynamicAction`. `Plugin.Load()`/`Unload()` and the command `OnLoad()`/`RunCommand(String)` are the hooks — [llms.txt](https://logitech.github.io/actions-sdk-docs/llms.txt); [Haptics getting started](https://logitech.github.io/actions-sdk-docs/csharp/haptics/haptics-getting-started.md).
- Packaging: `logiplugintool pack ./bin/Release/ ./Example.lplug4` and `logiplugintool verify ./Example.lplug4`. A `.lplug4` is a zip and installs on double-click. The recommended name is `pluginName_version.lplug4`. Marketplace submission goes through marketplace.logitech.com/contribute — [Distributing](https://logitech.github.io/actions-sdk-docs/csharp/plugin-development/distributing-the-plugin.md).
- `logiplugintool install ./X.lplug4` and `logiplugintool uninstall X` are used in the HapticWeb README — [HapticWebPlugin](https://github.com/fallstop/HapticWebPlugin). The official distributing page does not document an install command.
- Sample repo [Logitech/actions-sdk](https://github.com/Logitech/actions-sdk) (MIT) contains:
  - `DemoPlugin` (.NET 8)
  - **`HapticsPlugin` (.NET 10)**: Press Counter and Tick Counter, with events registered in `OnLoad()` and mapped in `events/extra/eventMapping.yaml`
  - `SnakePlugin` (.NET 10)
  - Build with `dotnet build -c Debug` (hot-reloads) or `-c Release`. Requires Options+ installed, which provides `PluginApi.dll`.
  - Its README gives the tool install as `dotnet tool install -g Loupedeck.PluginTool`. This **conflicts** with the docs' `LogiPluginTool`. Try `LogiPluginTool` first.
- Node.js SDK: search snippets say it is **alpha**, supports **Windows** dev, and is created with `npx @logitech/plugin-toolkit create` (TypeScript by default). The Getting Started page calls it "limited features (expanding)" — [search result: nodejs/introduction](https://logitech.github.io/actions-sdk-docs/nodejs/introduction/). Direct fetches of `/nodejs`, `/nodejs/introduction/`, and `/nodejs/overview` returned **404**, so these pages may have moved or been removed. UNVERIFIED.

### Inferences
- First 2 hours: clone `Logitech/actions-sdk` and build `HapticsPlugin` unchanged. This is the fastest path to a known-good haptic. After that, add your own event and IPC.
- Check the installed Plugin Service version (Options+ About page or the logs folder) before choosing .NET 8 or 10. Install both SDKs to be safe.

### Gaps
- No documented sandbox or permission model for plugins (see section 4).
- Node.js SDK haptics support is not documented anywhere I could reach.

## 3. Haptics: exact steps, waveforms, versions

### Takeaway
Haptics run through the plugin event system. There are three steps: declare the `HasHapticMapping` capability, declare events in `DefaultEventSource.yaml`, and map them to waveforms in `events/extra/eventMapping.yaml`. Then call `PluginEvents.RaiseEvent("name")` from C#. Requirements: MX Master 4 only, Plugin API 6.2.1+ (Options+ 1.95+).

### Cited Findings
- Versions: haptics are "new in Plugin API 6.2.1", which corresponds to **Logi Options+ 1.95**. The only supported device is the **MX Master 4**, with Options+ — [Haptics overview](https://logitech.github.io/actions-sdk-docs/csharp/haptics/haptics-overview.md); [Supported devices](https://logitech.github.io/actions-sdk-docs/supported-devices.md). Firmware requirements are not stated.
- Steps — [Haptics tutorial](https://logitech.github.io/actions-sdk-docs/csharp/haptics/haptics-tutorial.md):
  ```yaml
  # src/package/metadata/LoupedeckPackage.yaml
  pluginCapabilities:
    - HasHapticMapping
  ```
  ```yaml
  # src/package/events/DefaultEventSource.yaml
  events:
    - name: buttonPress
      displayName: Button Press
      description: Triggered when the button is pressed
  ```
  ```yaml
  # src/package/events/extra/eventMapping.yaml
  haptics:
    buttonPress:
      DEFAULT: sharp_state_change
      MX Master 4: sharp_collision
  ```
  ```csharp
  // in a PluginDynamicCommand
  protected override Boolean OnLoad() {
      this.Plugin.PluginEvents.AddEvent("buttonPress", "Play Haptic", "Plays a haptic");
      return true;
  }
  protected override void RunCommand(String actionParameter) {
      this.Plugin.PluginEvents.RaiseEvent("buttonPress");
  }
  ```
  In a `Plugin` subclass, call `this.PluginEvents.AddEvent(name, displayName, description)` in `Load()`. The docs' example raises events from a `System.Timers.Timer`. That shows events can be raised **without any user button press**, which is what Tap needs — [Haptics getting started](https://logitech.github.io/actions-sdk-docs/csharp/haptics/haptics-getting-started.md).
- Naming rules: start with a letter or underscore, case-sensitive, unique per event source. `Default` is reserved for non-default sources — [Haptics getting started](https://logitech.github.io/actions-sdk-docs/csharp/haptics/haptics-getting-started.md).
- Waveforms (official) — [Haptics getting started](https://logitech.github.io/actions-sdk-docs/csharp/haptics/haptics-getting-started.md):
  - State change: `sharp_state_change`, `damp_state_change`
  - Collision: `sharp_collision`, `damp_collision`, `subtle_collision`
  - Alert: `happy_alert`, `angry_alert`, `completed`
  - Special: `square`, `wave`, `firework`, `mad`, `knock`, `jingle`, `ringing`
  - That is 15 in total. The docs recommend **Knock, Ringing, Jingle, Happy Alert, and Wave** for "incoming events".
- Logs:
  - `C:\Users\<user>\AppData\Local\Logi\LogiPluginService\Logs\messages\eventSources`
  - `...\Logs\testing\event_sources.txt`
  - Troubleshooting: names must match exactly, the mapping file must be in `extra/`, a `DEFAULT` entry is required, and a low battery weakens the effect.
  - [Haptics getting started](https://logitech.github.io/actions-sdk-docs/csharp/haptics/haptics-getting-started.md).
- Latency: no official figures. HapticWeb only says its WebSocket "keeps a warm connection for theoretically lower latency" — [HapticWebPlugin](https://github.com/fallstop/HapticWebPlugin).
- Alternative path without a plugin, WebHID (unofficial, "experimental and not officially supported by Logitech"), from the [mx-master-4-webhid README](https://github.com/mario-gutierrez/mx-master-4-webhid) and [driver source](https://raw.githubusercontent.com/mario-gutierrez/mx-master-4-webhid/main/app/logitech-haptic-driver.js):
  - Chromium only. `new LogitechHapticDriver()`, `await driver.connect()` (opens a user picker), then `await driver.triggerHaptic(id)`.
  - VID `0x046d`, PID `0xb042` (MX Master 4) / `0xb048` (Business).
  - HID++ long report `0x11`, 19 bytes: `[devIdx=2, 0x0b, 0x4e, effectId, 0...]`.
  - The README says effect IDs run 0–14. The code accepts 0–255. No name mapping is given.

### Inferences
- The WebHID byte layout could be reproduced from Python (`hidapi`) or Node (`node-hid`) with no plugin and no browser. This is untested. Options+ may hold the device or conflict with it, and over Bluetooth the device index of 2 may differ. Treat it as a fallback only.
- Map Tap's "you were addressed" event to `knock` or `ringing`, and "can you hear me?" to `jingle` or `happy_alert`. Reserve `angry_alert` for urgent cases.

### Gaps
- Firmware minimums, measured latency, and whether the user must toggle a haptics setting in Options+ were not found.
- Node.js SDK haptic support is unknown.

## 4. Plugin to external app communication; HapticWeb

### Takeaway
There is no official IPC mechanism in the docs. However, the Marketplace-approved HapticWeb plugin is built on the Actions SDK and hosts an HTTPS + WSS server on 127.0.0.1:41443 from inside the plugin. That shows a C# plugin can run a local server. Tap can install HapticWeb and POST to it from Python/TS. That gives haptics with zero C# work.

### Cited Findings
- HapticWeb Marketplace listing: "Haptic Web Plugin" v1.2 by Jasper M-W, Windows + macOS. "Web API for the MX Master 4 haptic motor". The server starts automatically after install — [Marketplace](https://marketplace.logi.com/plugin/HapticWeb/en).
- API — [haptics.jmw.nz/api](https://haptics.jmw.nz/api):
  - Base URL `https://local.jmw.nz:41443`, bound to `127.0.0.1`.
  - `GET /` is a health check (`{"success":true,"service":"HapticWebPlugin",...}`).
  - `GET /waveforms` lists the waveforms.
  - `POST /haptic/{waveform}` takes an **empty body**: `curl -X POST https://local.jmw.nz:41443/haptic/knock -d ''`. Without `-d ''`, curl hangs because no Content-Length is sent.
  - WebSocket `wss://local.jmw.nz:41443/ws`: send a binary single byte holding the waveform index. There is no reply.
    ```js
    const ws = new WebSocket('wss://local.jmw.nz:41443/ws');
    ws.onopen = () => ws.send(new Uint8Array([0])); // sharp_collision
    ```
  - Index table:
    - 0 sharp_collision, 1 sharp_state_change, 2 knock, 3 damp_collision, 4 mad
    - 5 ringing, 6 subtle_collision, 7 completed, 8 jingle, 9 damp_state_change
    - 10 firework, 11 happy_alert, 12 wave, 13 angry_alert, 14 square
  - The site says "16 waveforms" and a WS range of 0–15. The GitHub README says 15. Index 15 is undocumented, so assume 0–14.
- Implementation — [HapticWebPlugin GitHub](https://github.com/fallstop/HapticWebPlugin) (MIT):
  - The server is "NetCoreServer-based HTTPS/WSS" and CORS allows any origin.
  - `local.jmw.nz` resolves to 127.0.0.1, which lets the plugin serve a valid certificate. The cert is downloaded from the repo's `certs` branch on first run, cached, and refreshed every 24 h.
  - Build/pack/install: `logiplugintool pack ./bin/Release ./HapticWeb.lplug4` and `logiplugintool install ./HapticWeb.lplug4`.
  - If the cert or port fails, restart Logi Plugin Service.
  - The README describes no sandbox restrictions.
- Playground: https://haptics.jmw.nz/playground — [Marketplace](https://marketplace.logi.com/plugin/HapticWeb/en).
- Another option is Sensurf, a browser extension plus Logi plugin for web haptics — [Mozilla add-ons](https://addons.mozilla.org/addon/sensurf/).

### Inferences
- Python one-liner: `requests.post("https://local.jmw.nz:41443/haptic/knock", data=b"")`. Node: `fetch(url, {method:"POST", body:""})`.
- Risks: it needs DNS resolution of `local.jmw.nz`, plus internet on first run to fetch the cert. Hackathon Wi-Fi or captive DNS could break this. Mitigations: add `127.0.0.1 local.jmw.nz` to the hosts file, or call `https://127.0.0.1:41443` with cert verification turned off.
- Plan B is Tap's own plugin. Fork `HapticsPlugin`, add an `HttpListener` on `http://localhost:PORT/` (plain HTTP on localhost avoids the cert problem), and call `PluginEvents.RaiseEvent` for each route. HapticWeb shows that networking from inside a plugin works.

### Gaps
- No official Logitech statement on plugin sandboxing, networking, or IPC.
- CORS/error formats are partly undocumented, and latency is unmeasured.

## 5. Webcam / AI guidance (LogiInsight SDK and others)

### Takeaway
The LogiInsight SDK (Python 3.9+, v1.5.2) streams RGB and IR video through OpenCV. It reads on-device face box and 478-point MediaPipe-topology mesh JSON over SSH, and records the 2-mic array. It has no built-in expression or blink/nod detection. Tap must compute face gestures from the mesh itself, or run MediaPipe on the RGB frames.

### Cited Findings
- Install: unzip the SDK, then in `logiinsight_api` run `uv sync` and `uv run python example_IR.py`, or use venv + `pip install -r requirements.txt`.
  - Deps: `paramiko numpy opencv-python` (not the headless build); for audio, `sounddevice scipy matplotlib`.
  - Conda is not supported.
  - [LogiInsight quick start](https://logitech.github.io/hackathons/logiinsight/).
- Connection details — [LogiInsight quick start](https://logitech.github.io/hackathons/logiinsight/):
  - Video works over USB right away. The camera shows up as `… Camera` (RGB), `… CPD Camera` (IR), and `… Hello Camera` (ignore it).
  - Mic name: `LVNext Microphone`.
  - The AI data needs a USB NCM Ethernet adapter. The camera is at `192.168.1.10`. Set the PC to static `192.168.1.20/24` via `ncpa.cpl`. If needed, install the "UsbNcm Host Device" driver in `devmgmt.msc`.
  - If Wi-Fi uses 192.168.1.x, the subnets clash.
  - Credentials go in env vars `LOGIWEBCAM_USER` / `LOGIWEBCAM_PASSWORD`. They come from the kit card.
  - Run `check_connection.py` to test the link.
- API — [LogiInsight API](https://logitech.github.io/hackathons/logiinsight/API):
  - `LogiWebcamClient(ip="192.168.1.10", username=None, password=None, port=22, timeout=10)`, usable as a context manager.
  - `set_ai_config(enable_face_detection=True, enable_face_mesh=False, ...)` takes about 0.5–1 s to apply.
  - `get_latest_ai_data() -> dict|None`.
  - JSON: `faces[0].bbox [x,y,w,h]`, `confidence`, and `landmarks` (478 `[x,y,z]`; indices 468–477 are iris points). At most one face is reported.
  - Audio: `record_audio(...)` and the non-blocking `AudioRingRecorder(...).start()/snapshot()`.
  - Mic format: 2 ch, 16-bit, 48 kHz, no processing. On Windows the device can show 6 channels (MME etc.). In that case, keep channels 1 and 4.
- Gotchas — [LogiInsight quick start](https://logitech.github.io/hackathons/logiinsight/):
  - The AI runs **only while a program reads the RGB stream**.
  - About 27 AI results/s at 1080p with RGB alone, and 13–17/s with IR.
  - If RGB is MJPG, IR drops to about 1 fps, so use NV12/YUY2.
  - **Overheats after about 10 min of continuous AI** and the video freezes. Use short sessions. Unplug it to cool between demo runs.
  - Expect lag between the picture and the JSON.
  - Other webcams give video only, with no AI. The docs suggest MediaPipe for those.
- Gaze Tracker works with any Logitech webcam. Hands Tracker uses the LogiInsight camera — [Hackathons hub](https://logitech.github.io/hackathons/).

### Inferences
- With the MediaPipe mesh topology, the standard indices for mouth aspect ratio (open mouth / "speaking"), eye aspect ratio (blink), and nose-tip trajectory (nod/shake) apply. The landmarks are sometimes empty, so smooth over a short window and fall back to laptop MediaPipe. Given the overheating risk, running MediaPipe locally on the RGB stream may be more robust for the demo.
- The 2-mic camera array can serve as the user's mic input for Tap. Call (loopback) audio still needs WASAPI loopback capture on Windows (not a Logitech feature).

### Gaps
- I found no Logitech docs on MX Brio or LLM/AI integrations beyond the agent doc zip and llms.txt.
- Gaze Tracker API details were not fetched.
