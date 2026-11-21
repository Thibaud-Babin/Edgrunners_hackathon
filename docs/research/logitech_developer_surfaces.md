# Logitech Developer Surfaces and Hackathon Involvement (for LauzHack 2026 Logitech challenge)

Research date: 2026-11-21. Challenge text being analysed: "Beyond video conferencing: transform the traditional webcam into the intelligent eyes and ears of AI! ... context-aware productivity workflows by harnessing real-time multimodal inputs, combining audio, video streams, facial/hand landmarks and other metadata. Can you redefine human-computer interaction?"

## 1. Logi Actions SDK (Logi Plugin Service / Options+): what it is, languages, capabilities, getting started, external triggering, approval

### Takeaway
The Logi Actions SDK is Logitech's single public developer surface for its peripherals. It has two flavours: a mature C# (.NET 8) SDK, and an alpha Node.js/TypeScript SDK (`@logitech/plugin-sdk`) that only runs on Windows. Plugins run inside the Logi Plugin Service, which is hosted by Logi Options+ or Loupedeck. A plugin exposes actions and adjustments that users map to MX Creative Console keys and dials, the Actions Ring, or mouse and keyboard buttons. The plugin code can raise haptic events on the MX Master 4. There is no documented official external-trigger API, but a published marketplace plugin already runs a local REST/WebSocket server, so the pattern works in practice.

### Cited Findings
- The docs live at logitech.github.io/actions-sdk-docs and offer two paths. The C# SDK is "the established option with the full feature set" and needs the .NET 8 SDK plus the Logi Plugin Tool. The Node.js SDK is in **alpha**: it is simpler, aimed at TS/JS developers, has fewer features, and is **limited to Windows development**. The npm package is `@logitech/plugin-sdk` and the docs include an API reference for a `PluginSDK` class. — [Actions SDK docs](https://logitech.github.io/actions-sdk-docs); [Node.js API](https://logitech.github.io/actions-sdk-docs/nodejs/api/html/classes/PluginSDK.html); [C# intro](https://logitech.github.io/actions-sdk-docs/csharp/plugin-development/introduction)
- Architecture:
  - The **Host Application** (Logi Options+ or Loupedeck, with G HUB support "planned for 2026") is where users install plugins and map actions to controls.
  - The **Logi Plugin Service** handles host-plugin communication, plugin lifecycle, action execution, profile storage and device-control mapping.
  - Plugins "typically integrate with external applications or cloud services."
  - Profiles map actions to controls for each app and are stored locally.
  - Prerequisites are a Windows or macOS machine, Options+ or Loupedeck, and a compatible device. "Generate a ready-to-use plugin project with a single SDK command."
  - You can test on the MX Creative Console or Loupedeck (which have screens), or on MX mice and keyboards through the on-screen Actions Ring.
  - Source: [Getting started](https://logitech.github.io/actions-sdk-docs/getting-started)
- The C# API reference is based on Plugin API 6.4.2.3567. Its classes include ClientApplication, DeviceType, Plugin, PluginDynamicAction, PluginDynamicAdjustment, PluginDynamicCommand and PluginImageSize. Documented plugin features include:
  - Action Editor actions and multistate actions
  - Dynamic folders and profile actions
  - Default application profiles (linking a plugin to an app)
  - **External Service Login**
  - Plugin settings, local data storage, plugin status, logging and localization
  - Icons and vector images for button LCDs
  - Source: [llms.txt index](https://logitech.github.io/actions-sdk-docs/llms.txt)
- Plugins can be distributed through the Logitech Marketplace and the Loupedeck Marketplace. A "Marketplace Approval Guidelines" page exists, and its terms are defined in the "Logitech Marketplace Developer Agreement". — [llms.txt index](https://logitech.github.io/actions-sdk-docs/llms.txt); [Develop with Logitech](https://www.logitech.com/en-ae/software/developer) (links to marketplace.logi.com/contribute, the developer agreement, and Discord discord.com/invite/etJCPZytHg)
- Free learning resources include a Codecademy course "Build Plugins for Logitech Devices with Actions SDK" (C#, built around a Git automation project) and an "AI-friendly documentation setup" page (llms.txt). — [Codecademy](https://www.codecademy.com/learn/build-plugins-for-logitech-devices); [llms.txt](https://logitech.github.io/actions-sdk-docs/llms.txt)
- **Proof that a plugin can be triggered from outside:** the "Haptic Web Plugin" (v1.2, by third-party developer Jasper M-W, macOS and Windows) on the Logi Marketplace:
  - It is a "Web API for the MX Master 4 haptic motor" that exposes a **REST API and a WebSocket**.
  - It serves at `https://local.jmw.nz:41443/` and needs a localhost SSL certificate.
  - It "does nothing on its own until triggered by a web app."
  - It has a playground at https://haptics.jmw.nz/playground.
  - Source: [Marketplace: HapticWeb](https://marketplace.logi.com/plugin/HapticWeb/en)

### Inferences
- A plugin is ordinary .NET (or Node) code running as a local process. It can therefore host its own localhost HTTP/WebSocket server, which the HapticWeb plugin shows works and passed marketplace listing. The practical architecture for a webcam-AI project is: **Python/JS perception app (MediaPipe etc.) -> localhost WebSocket -> Actions SDK plugin -> RaiseEvent (haptics) / button LCD and dial updates**. The reverse direction also works: a dial turn or key press goes to the plugin and is forwarded over the socket to the AI app.
- For a 36-hour hackathon, C# is the safer pick because it has the full feature set and documented haptics. Choose Node only if the team is JS-only and on Windows.
- Marketplace approval is not needed to run a plugin locally during development. Approval only matters for public distribution. This is inferred from the docs' "Testing and Debugging" and "Distributing" sections being separate; it is not explicitly stated.

### Gaps
- No official doc found on an external-trigger or IPC API into the Logi Plugin Service. The Node.js overview and introduction pages returned 404, so it is unconfirmed whether the Node SDK supports haptics.
- I could not read the exact CLI command names (e.g. `logiplugintool`) or the hot-reload workflow. The getting-started page doesn't name them.
- The licence terms of the SDK itself and the details of the approval criteria were not retrieved.

## 2. MX Master 4 haptics: can third parties trigger waveforms programmatically?

### Takeaway
**Yes, confirmed through two independent, documented routes.**
- **Route (a), Actions SDK plugin:** declare the `HasHapticMapping` capability, define events, map them to one of 15 named waveforms in YAML, and call `PluginEvents.RaiseEvent(name)` from any plugin code. This needs Plugin API 6.2.1+ and Options+ 1.95+.
- **Route (b), Windows 11 InputHapticsManager:** in `Windows.Devices.Haptics` (SDK 10.0.28000.1721, March 2026). Microsoft explicitly lists the Logitech MX Master 4 as a supported mouse. This route is scoped to the foreground app's UI thread and input focus.

Route (a) is the one that works from a background or AI process.

### Cited Findings
- Haptics are "New in Plugin API 6.2.1 (Logi Options+ 1.95)". The only supported device is the "Logitech MX Master 4 mouse with Logi Options+ software installed." — [Haptics overview](https://logitech.github.io/actions-sdk-docs/csharp/haptics/haptics-overview); [Supported devices](https://logitech.github.io/actions-sdk-docs/supported-devices) (the MX Master 4 is the only haptics device; the MX Creative Console, Actions Ring and Loupedeck CT/Live/Live S/+ are action devices)
- Implementation recipe (C#):
  - Add `pluginCapabilities: - HasHapticMapping` to `LoupedeckPackage.yaml`.
  - Define events, either in code with `this.PluginEvents.AddEvent(name, displayName, description)` or in `events/DefaultEventSource.yaml`.
  - Map events to waveforms in `/events/extra/eventMapping.yaml`. It supports a `DEFAULT` waveform plus device-specific keys such as `MX Master 4: sharp_collision`.
  - Fire an event with `this.PluginEvents.RaiseEvent(EventName)` (or `this.Plugin.PluginEvents.RaiseEvent` from inside an action). The documented example fires from a `System.Timers.Timer`, so the trigger does not need user input.
  - Event logs are under the Logi Plugin Service `Logs` directory.
  - Source: [Haptics getting started](https://logitech.github.io/actions-sdk-docs/csharp/haptics/haptics-getting-started)
- **The 15 waveforms available to plugins:**
  - State change: `sharp_state_change`, `damp_state_change`
  - Collision: `sharp_collision`, `damp_collision`, `subtle_collision`
  - Alert: `happy_alert`, `angry_alert`, `completed`
  - Special: `square`, `wave`, `firework`, `mad`, `knock`, `jingle`, `ringing`
  - The docs group them as "precision enhancers", "progress indicators" (`completed`, `firework`) and "incoming events" (`knock`, `ringing`, `jingle`, `happy_alert`).
  - Source: [Haptics getting started](https://logitech.github.io/actions-sdk-docs/csharp/haptics/haptics-getting-started)
- Logitech's consumer page says haptics are "only available with MX Master 4 and specific plugins in the Logi Marketplace at this moment". Named haptic plugins:
  - **Zoom:** alerts when someone raises a hand, or when a wrong meeting ID is entered.
  - **Adobe Photoshop:** a pulse when Generative Fill finishes, and Smart Guide snapping.
  - A Logitech regional resource page also lists **Lightroom**. The en-ch page I read did not mention Lightroom.
  - Options+ features with haptics: Actions Ring (moving between and selecting bubbles), Smart Actions (haptics on any step), and gestures (desktop switching).
  - Source: [Logitech haptics page (en-ch)](https://www.logitech.com/en-ch/software/logi-options-plus/haptics.html); [Logitech haptics](https://www.logitech.com/haptics)
- Windows integration: the MX Master 4 has "native integration with Advanced Haptics on Windows 11". This requires the Windows 11 update from the end of March 2026 onward, and covers PowerPoint alignment and window snapping/resizing. Intensity is set in Windows settings, and the mouse may need a firmware update via Options+. — [Logitech haptics page (en-ch)](https://www.logitech.com/en-ch/software/logi-options-plus/haptics.html)
- Microsoft API details:
  - `InputHapticsManager` lives in the `Windows.Devices.Haptics` namespace. It needs Windows 11 SDK 10.0.28000.1721 (March 2026) and UniversalApiContract v19. The Align, Collide, Step and Grow waveforms need SDK 10.0.28000.1839 (April 2026).
  - Usage: `InputHapticsManager.IsSupported()`, then `GetForCurrentThread().TrySendHapticWaveform(KnownSimpleHapticsControllerWaveforms.Align, 0)`. `TrySendHapticWaveformForPlayCount(waveform, fallback, intensity 0.0-1.0, playCount, delay)` adds intensity control. `TryStopFeedback()` stops playback.
  - **Important:** the manager is "scoped to the current thread's input focus". `GetForCurrentThread()` must be called on the UI thread, and "calling it from a background thread will not route feedback to the correct device."
  - Microsoft's Supported Device Database lists the **Logitech MX Master 4** as the only mouse.
  - Source: [MS Learn: Implement haptic feedback](https://learn.microsoft.com/en-us/windows/apps/develop/input/haptics) (updated 2026-08-17)
- Possible naming discrepancy: a Microsoft design article's snippet uses `Windows.Devices.Input.InputHapticsManager`, while the reference docs use `Windows.Devices.Haptics`. — [MS design article](https://microsoft.design/articles/haptics-design-and-implementation/) vs [API ref](https://learn.microsoft.com/en-ca/uwp/api/windows.devices.haptics.inputhapticsmanager) (reported by the search summary; not verified line by line)
- Windows has "no mechanism to configure device-initiated feedback on a mouse". — [Input haptics implementation guide](https://learn.microsoft.com/en-us/windows-hardware/design/component-guidelines/input-haptics-implementation-guide) (via search summary)

### Inferences
- For "AI eyes and ears", haptics make a good **silent output channel**. Examples:
  - `knock` when the camera sees someone approach behind you
  - `angry_alert` for bad posture or fatigue
  - `completed` when an AI agent finishes a task
  - `subtle_collision` as gesture-recognition confirmation
- These cues are private and don't add screen clutter. Logitech's own Zoom "raised hand" plugin is the same pattern, so judges will recognise it.
- The Windows API route only fits a foreground WinUI/WPF app. A background webcam AI should use the Actions SDK plugin route, or the HapticWeb plugin as a zero-code shortcut to prototype from Python or the browser. Note that HapticWeb's waveform set and endpoint routes are undocumented on its listing.

### Gaps
- Not confirmed: whether the 15 waveforms can be customised, set in intensity, or sequenced through the Actions SDK. There is no intensity parameter in the docs I read.
- Not confirmed: haptic latency over Bluetooth versus the Bolt receiver.
- The Haptics Best Practices and Tutorial pages were not read in full.

## 3. MX Creative Console / Actions Ring programmability

### Takeaway
Both are first-class Actions SDK targets.
- **MX Creative Console:** the Keypad has programmable LCD keys and the Dialpad has a dial and a roller. Plugin commands and adjustments, with dynamic icons and folders, map to these.
- **Actions Ring:** an on-screen overlay that is activated by any Logitech MX device and then usable with any mouse. It is the cheapest way to get a plugin UI without special hardware.

### Cited Findings
- The MX Creative Console "consists of a Keypad with programmable LCD buttons and a Dialpad with a rotary dial and roller". The Actions Ring is a virtual on-screen controller that "requires a Logitech MX device to activate... Once active, the overlay can be controlled using any mouse." — [Supported devices](https://logitech.github.io/actions-sdk-docs/supported-devices)
- SDK primitives exist for these surfaces: `PluginDynamicCommand` (buttons), `PluginDynamicAdjustment` (dials), dynamic folders, button-image changes and multistate actions. — [llms.txt index](https://logitech.github.io/actions-sdk-docs/llms.txt)
- Logitech's 2026 DevStudio Challenge had a dedicated category, "MX Creative Console + Actions SDK". — [Logitech blog, 2 Jun 2026](https://www.logitech.com/blog/2026/06/02/from-code-to-the-swiss-alps-meet-the-logitech-devstudio-challenge-finalists/)

### Inferences
- A strong demo could pair webcam perception with the Creative Console as a "context surface". Keypad LCD icons would change dynamically based on what the camera or mic detects (current task, person present, gesture), and the dial would adjust AI parameters. Haptics on the MX Master 4 would provide feedback.

### Gaps
- I did not verify the LCD image resolution or refresh limits for dynamic key images.

## 4. Logitech webcams (MX Brio, Brio, C920), Logi Tune, RightSight, Sync APIs

### Takeaway
There is **no public consumer webcam SDK**. Webcams are standard UVC devices, so teams get raw video and audio through OpenCV, MediaPipe or browser getUserMedia, plus standard UVC controls. Logitech-specific features such as auto-framing, Show Mode and image tuning live in Options+, G HUB or Logi Tune. Room-system APIs (CollabOS local API and Sync Cloud API, including people counts) exist only for business Rally devices under paid Sync licences, so they are irrelevant for students.

### Cited Findings
- MX Brio basic support is via the UVC standard and it "should work with any software compatible with the UVC standard" (Zoom, Teams, OBS, etc.). Fine image controls come through Logi Options+ or G HUB. There is no Logitech software beyond Windows and macOS. — [MX Brio app compatibility](https://support.logi.com/hc/en-au/articles/20712923164311-What-video-conferencing-or-streaming-apps-does-MX-Brio-work-with); [MX Brio specs](https://support.logi.com/hc/en-ch/articles/18849231040023-Specification-MX-BRIO)
- The hackaTUM 2025 Logitech brief lists the **MX Brio** among "Supported Devices" for its Actions SDK challenge, alongside the MX Master 4, Actions Ring, MX Creative Console and MX Keys. — [hackaTUM 2025 Logitech challenge PDF](https://hack.tum.de/wp-content/uploads/2025/11/hackaTUM2025_logitech_challenge.pdf.pdf)
- Sync and CollabOS:
  - The CollabOS API gives local on-device data and the Sync Cloud API gives fleet data.
  - Access requires a Sync Plus, Select or Essential licence; Basic licences have no API access.
  - Sync Insights provides people counts and occupancy for Rally Bar and Rally Bar Mini.
  - The new Rally AI Camera and Rally AI Camera Pro (announced Jan 2026, available from summer 2026) provide people counting to Sync.
  - Logitech says it does not collect or transmit audio or video.
  - Sources: [CollabOS & Sync Cloud API FAQ](https://hub.sync.logitech.com/collabosguides/post/collabos-and-sync-cloud-api-faq-vxcw5mBqvh6Hs75); [VergeSense integration](https://support.vergesense.com/hc/en-us/articles/47292507359757-Logitech-Integration-Sync-Cloud-API); [Next Up Recap Jan 2026](https://hub.sync.logitech.com/learn/post/next-up-recap-january-2026-HXivzjgnQM08LHK) (from search snippets)
- At LauzHack 2019, Logitech's challenge page pointed participants to the C922 webcam with OpenCV samples, and provided C# "devmon" input-device-monitoring samples. — [LauzHack 2019 Logitech page](https://logitech.github.io/lauzhack2019); [devmon samples](https://logitech.github.io/lauzhack2019/devmon/samples/csharp)

### Inferences
- The challenge's "facial/hand landmarks and other metadata" must come from the team's own on-device ML (MediaPipe Face Mesh/Hands/Pose, Whisper or VAD for audio). Logitech exposes no landmark or metadata stream. On-device processing also lines up with Logitech's privacy messaging.
- The webcam is the input; the Actions SDK devices (haptics, LCD keys, Actions Ring) are the Logitech-programmable outputs and controls. A project using both covers the full Logitech ecosystem.

### Gaps
- Not verified: whether the MX Brio exposes RightSight or auto-framing state, or face-detection metadata, over UVC extension units. No public documentation found.
- Logi Tune has no documented API (none found).
- Not verified: whether the Actions SDK can read or set webcam settings (no doc found).

## 5. Logitech's AI / HCI direction 2025-2026 (what excites the judges)

### Takeaway
The challenge wording ("eyes and ears of AI") directly echoes CEO Hanneke Faber's repeated framing of Logitech hardware as "the eyes, the ears and the hands of AI", a "sensory layer for AI". Logitech is sceptical of standalone AI gadgets. It wants AI built into existing peripherals, and it wants to reduce cognitive overload, tab and context switching, and copy-paste friction. Its first-party AI software (Prompt Builder) was retired in 2026 in favour of Smart Actions.

### Cited Findings
- At Logi Work London 2025, Faber said hardware is "the eyes, the ears and the hands of AI" and a "sensory layer for AI". — [TechRadar interview](https://www.techradar.com/pro/our-work-is-never-done-logitech-ceo-on-the-trends-shaping-the-future-of-work-and-how-hardware-can-be-the-eyes-the-ears-and-the-hands-of-ai)
- Semafor (Sept 2026) says Faber positions Logitech as "the eyes, ears, and hands of AI". She also sees voice as "a more important modality" as workers talk to AI agents. — [Semafor](https://semafor.com/article/09/03/2026/how-a-china-for-china-strategy-rebooted-logitech)
- Faber called standalone AI gadgets "a solution looking for a problem" (late 2025). — [The Register](https://www.theregister.com/2025/12/04/logitech_chief_ai/); [Tom's Hardware](https://www.tomshardware.com/tech-industry/artificial-intelligence/logitech-ceo-says-ai-gadget-makers-are-chasing-problems-that-dont-exist)
- She wants an AI agent in every board meeting, and reportedly said Logitech built 3,000+ internal AI agents. The 3,000 figure comes via a secondary report. — [TechSpot](https://www.techspot.com/news/109906-logitech-ceo-hanneke-faber-wants-ai-agent-every.html); [Barchart](https://www.barchart.com/story/news/2166057/logitech-international-ceo-eyes-ai-b2b-growth-as-next-investment-push-begins)
- Logi AI Prompt Builder (launched April 2024, ChatGPT only, in Options+) was **retired around May/June 2026**. The sources conflict on the month: May on most support pages, June on the Japanese one. Logitech's stated reason was that "AI tools have advanced". The replacement is Smart Actions AI templates (reply, summarise selected text). — [Support: feature retirement](https://support.logi.com/hc/articles/22394071652759); [Launch blog 2024](https://www.logitech.com/blog/2024/04/17/looking-to-improve-your-workflow-with-chatgpt-we-have-you-covered-with-the-new-logi-ai-prompt-builder-available-today)
- The hackaTUM 2025 Logitech brief, "Make the World More Tangible", is the clearest recent statement of what Logitech wants:
  - Its goal is to "alleviate cognitive overload".
  - It names three pains: CONTROL ("Too many tools, apps, AI – Tab overload"), SPEED ("typing, copying, and pasting, which feels like the '90s'") and FOCUS ("Endless context switching").
  - It asks: "What if it could be as simple as pressing a button?"
  - Teams were to "Develop a plugin that trigger intelligent actions or streamline complex workflows using AI or web services, resulting in heightened awareness, improved security, or an effortless workflows" using the Actions SDK.
  - Source: [hackaTUM 2025 PDF](https://hack.tum.de/wp-content/uploads/2025/11/hackaTUM2025_logitech_challenge.pdf.pdf)

### Inferences
- Judges are likely to reward:
  1. Concrete productivity pain relief (context switching, tab overload), not AI novelty.
  2. Peripherals as the AI's senses and actuators, not a new gadget.
  3. Voice and agent interaction.
  4. Privacy-respecting, on-device perception.
  5. Something that could plausibly ship as a Logi Marketplace plugin.
- Using haptics (MX Master 4's 2025 flagship feature) and the Actions SDK on top of the webcam probably differentiates a team, because most teams will build webcam-only CV demos.

### Gaps
- No 2026 Logitech statement found that specifically concerns webcam-as-AI-sensor products.

## 6. Logitech at past hackathons (LauzHack, HackZurich, hackaTUM, DevStudio): statements, winners, prizes

### Takeaway
Logitech is a recurring sponsor of Swiss and German student hackathons. It ran LauzHack challenges in 2019 (streaming/broadcasting, C922 webcam plus OpenCV) and 2023 (creative potential with devices plus AI). At HackZurich 2023 ("Make the world more interactive") the winner was an AI-in-the-browser mouse-button tool. At hackaTUM 2025 the challenge was "Make the World More Tangible" (Actions SDK plus AI). In 2026 it ran the global DevStudio Challenge, with $10k per category and finals in Lausanne; finalists were AI-agent, voice and accessibility plugins. I found no public record of LauzHack 2024 or 2025 Logitech winners.

### Cited Findings
- **LauzHack 2019:** the challenge was "Streaming & Broadcasting" (e.g. enhancing recorded content with smart filtering), with C922 webcam and OpenCV samples. — [logitech.github.io/lauzhack2019](https://logitech.github.io/lauzhack2019)
- **LauzHack 2023:** the challenge asked how to unleash creative potential for knowledge workers, digital creators and developers using Logitech devices and AI services. A demo at the Logitech booth was the route to a prize. No winners are published. The page logitech.github.io/lauzhack2023 now returns 404 and its content is known only from a search snippet. — [LauzHack 2023 page (search snippet)](https://logitech.github.io/lauzhack2023)
- **HackZurich 2023**, Logitech "Make the world more interactive", with no specific guidelines. The first-place team (led by Youssef El Masry, RSA) built an app on a Logitech mouse's custom buttons: highlight text, then one click to translate, search or send it to a generative AI, with the answer in a small in-browser pop-up. They also pitched passwordless authentication through clicks, keys or audio, which was not built. Prizes were not described. — [RSA blog, Nov 2023](https://www.rsa.com/?p=27186)
- **hackaTUM 2025** (Munich), "hackaTUM x Logi Challenge: Make the World More Tangible": build an Actions SDK plugin linking devices to web, AI and services. The listed devices were the MX Master 4, Actions Ring, MX Creative Console, MX Keys and MX Brio. Prizes and winners are not in the PDF. — [hackaTUM 2025 PDF](https://hack.tum.de/wp-content/uploads/2025/11/hackaTUM2025_logitech_challenge.pdf.pdf)
- **Logi DevStudio Challenge 2026** (Logitech's first global developer challenge, on Devpost):
  - Launched 5 Feb 2026, with 250+ submissions and finals in Lausanne on 10-11 June 2026.
  - Two categories: MX Creative Console + Actions SDK, and MX Ink (MR stylus for Meta Quest).
  - Prize: USD 10,000 per category-winning team, a trip to Lausanne HQ, and a path to the Logi Marketplace ("40M+ users").
  - Console finalists: **Access Ring** (India; turns MX devices into accessibility tools), **VoxRing** (Germany; voice-to-everything plugin), and **AgentDeck – Command Your AI Fleet** (controlling multiple AI agents from the console).
  - Sources: [Logitech blog, finalists](https://www.logitech.com/blog/2026/06/02/from-code-to-the-swiss-alps-meet-the-logitech-devstudio-challenge-finalists/); [Access Ring blog](https://www.logitech.com/blog/2026/06/25/why-i-built-access-ring-transforming-logitech-mx-devices-into-accessibility-tools/); [DevStudio challenge page](https://www.logitech.com/en-us/discover/devstudio/challenge)
- Devpost has projects using Logitech hardware: "Actionly" (an AI agent in the MX Master Actions Ring) and "Clickless" (the "Logitech Accelerator Package" using the Creative Console). Both pages returned 403, so their hackathon and placing are unverified. — [Actionly](https://devpost.com/software/actionly); [Clickless](https://devpost.com/software/clickless)
- Logitech also co-ran EPFL student projects in 2019, e.g. "Software developer content creators" and "Better together ecosystem". — [EPFL OES PDF](https://www.epfl.ch/labs/oes/wp-content/uploads/2019/05/Project-n°10-Software-developer-content-creators-.pdf)

### Inferences
- What has won or been shortlisted: **one-click AI in the user's existing flow** (HackZurich), **voice-driven actions** (VoxRing), **multi-agent control surfaces** (AgentDeck) and **accessibility** (Access Ring).
- The LauzHack 2026 statement shifts the input from button to webcam and mic, but the same values likely apply. Show a real workflow, an AI that perceives context, and output through Logitech devices.
- Accessibility is a proven angle for Logitech judges. Hands-free control via face or hand landmarks for users with motor impairments would fit both the challenge and the precedent.
- Lausanne is Logitech's HQ city (DevStudio finals were held there), so judges at LauzHack may include Actions SDK and product staff. This is unverified.

### Gaps
- LauzHack 2024 and 2025: no Logitech challenge page, winners or prizes found. The LauzHack site and Devpost gallery were not reachable through search.
- The DevStudio 2026 winners (as opposed to finalists) were not retrieved.
- Prize amounts for the LauzHack, HackZurich and hackaTUM Logitech tracks are unknown.
