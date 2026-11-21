# Tap: Windows loopback capture, real-time STT, and name/keyword spotting (research notes, 2026-11-21)

Scope: what the "Tap" team (4 people, 24 hours, Windows, TS/Python) needs to hear the far end of a Zoom/Teams/Meet call, transcribe it live, and detect the user's name (e.g. "Thibaud", which ASR may render as "Tibo" or "Thibault"), questions aimed at them, and phrases like "can you hear me?" or "you're frozen".
Research budget: about 16 tool calls. Items marked [UNVERIFIED] come from prior knowledge and were not checked this session.

## Q1. Windows loopback capture: which route is fastest to get working?

### Takeaway
There are two quick routes. Electron's `setDisplayMediaRequestHandler` with `audio: 'loopback'` captures system audio with no native module, so it suits a TypeScript/Electron app. PyAudioWPatch (MIT, `pip install`) suits a Python sidecar. With headphones on, whole-system loopback contains only the remote participants plus any other system sounds, because the user's own voice is not played back to them. That makes per-process capture (Zoom only) optional.

### Cited Findings
- **Electron desktopCapturer loopback.** In the main process, `session.defaultSession.setDisplayMediaRequestHandler()` grants `{ video: sources[0], audio: 'loopback' }` from `desktopCapturer.getSources()`. The renderer then calls `navigator.mediaDevices.getDisplayMedia({ audio: true, video: {...} })`. `useSystemPicker: true` is experimental: if the system picker exists, the handler is not called. `getDisplayMedia` cannot pick a source by `deviceId`. — [Electron desktopCapturer docs](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- The Electron page's caveats are mostly about macOS: it needs `NSAudioCaptureUsageDescription` on 14.2+, uses the CoreAudio Tap by default from Electron 39+, and the `MacCatapLoopbackAudioForScreenShare` flag was removed in Electron 45. If the macOS permission is denied, the audio track starts already `ended` with no error. On Linux PipeWire, only one source is returned. The page lists no Windows-specific caveat. — [Electron desktopCapturer docs](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- Snippet, following the documented pattern:
  ```ts
  // main.ts
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then(s => cb({ video: s[0], audio: 'loopback' }));
  });
  // renderer.ts
  const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
  stream.getVideoTracks().forEach(t => t.stop());           // keep audio only
  // then AudioWorklet -> 16 kHz PCM16 -> WebSocket to the STT service
  ```
- **Excluding your own app's audio.** The W3C Screen Capture spec defines a `restrictOwnAudio` constraint that removes audio produced by the capturing tab. A Chromium intent-to-ship says it will be supported on Windows and Mac, not ChromeOS or Linux. Whether Electron's `audio: 'loopback'` handler honours it is unconfirmed. — [W3C Screen Capture](https://www.w3.org/TR/screen-capture); [Chromium Intent to Ship: restrictOwnAudio](https://groups.google.com/a/chromium.org/g/blink-dev/c/5SZfg29iwPc); [MDN restrictOwnAudio](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings/restrictOwnAudio)
- **PyAudioWPatch** is a PortAudio/PyAudio fork with WASAPI loopback. MIT (PyAudio licence). Windows wheels exist for Python 3.7 to 3.15 (`pip install PyAudioWPatch`). Loopback devices appear as input devices at the end of the device list, and the helper `get_default_wasapi_loopback()` finds the default speaker's loopback device. The repo has 245 stars and 63 commits; the last release date was not visible. — [PyAudioWPatch GitHub](https://github.com/s0d3s/PyAudioWPatch)
  ```python
  import pyaudiowpatch as pyaudio
  with pyaudio.PyAudio() as p:
      lb = p.get_default_wasapi_loopback()
      with p.open(format=pyaudio.paInt16, channels=lb["maxInputChannels"],
                  rate=int(lb["defaultSampleRate"]), input=True,
                  input_device_index=lb["index"], frames_per_buffer=512) as s:
          while True: chunk = s.read(512)   # downmix + resample to 16 kHz before STT
  ```
  (The snippet was built from the README's method names; check it against `examples/pawp_record_wasapi_loopback.py`.)
- **Per-process loopback (ApplicationLoopback API).** `AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS` takes a target PID and an include or exclude mode for that process tree. Microsoft gives the minimum client as Windows 10 Build 20348, and there is a Microsoft C++ sample. — [MS Learn: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS](https://learn.microsoft.com/en-us/windows/win32/api/audioclientactivationparams/ns-audioclientactivationparams-audioclient_process_loopback_params); [ApplicationLoopback sample](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/)
  - Node: the npm package `application-loopback` (WerdoxDev) lists windows and captures one process's audio, Windows 10 x64+ only. A fork, `@kokapuk/application-loopback`, is "tested on Windows 11". — [application-loopback GitHub](https://github.com/WerdoxDev/application-loopback); [@kokapuk/application-loopback](https://www.pkgstats.com/pkg:@kokapuk/application-loopback)
  - Python: `process-audio-capture` on PyPI wraps a prebuilt DLL based on Microsoft's sample. It targets Build 19041 per its page, which conflicts with Microsoft's stated 20348. It ships as a DLL plus a wrapper file, not a pure pip install. — [process-audio-capture PyPI](https://pypi.org/project/process-audio-capture/)
  - **Warning:** a GitHub issue reports that process loopback captured *silence* from the Microsoft Teams desktop app, while device loopback worked. — [Windows-classic-samples issue #414](https://github.com/microsoft/Windows-classic-samples/issues/414)

### Inferences
- **Fastest route.** If the app is Electron, use the Electron loopback route (about 1 to 2 h including the AudioWorklet resampler). If the backend is Python, use PyAudioWPatch (about 1 h). Keep the other route as the fallback.
- With headphones, device loopback holds no user voice, so no echo cancellation or speaker separation is needed. Tap's own notification sounds would be captured, so keep them silent or very short, or mute STT while they play.
- Treat per-process capture of Zoom only as a stretch goal: there is the Teams silence report and the conflicting build requirements.
- **Google Meet in Chrome.** Device loopback already captures browser audio, so a Chrome extension using `chrome.tabCapture` is only needed for a browser-only product. [UNVERIFIED: tabCapture specifics not researched.]
- [UNVERIFIED, prior knowledge] Other options not checked this session:
  - Python `soundcard` (BSD-3) has loopback through `include_loopback=True` on the speaker's microphone object.
  - `sounddevice` has dropped direct WASAPI-loopback support in recent PortAudio builds.
  - NAudio (C#, MIT) has `WasapiLoopbackCapture`. It is solid but adds a .NET process.
  - Node: `naudiodon` and `audify` (RtAudio/PortAudio bindings) need native builds and are less maintained. Avoid them in a 24 h build.

### Gaps
- No Windows-specific Electron caveats were found in the docs, such as minimum Electron version or sample-rate behaviour. Test early on the team's laptops.
- PyAudioWPatch's latest release date and the status of soundcard and sounddevice were not verified.
- The Chrome `tabCapture` and `getDisplayMedia({systemAudio:'include'})` behaviour on Windows were not researched.

## Q2. Real-time STT: cloud vs local, latency, cost, name biasing

### Takeaway
Use **Deepgram Nova-3 streaming with `keyterm`** as primary. It is about $0.005 to $0.008 per minute, has latency under 300 ms, accepts up to 100 keyterms that can be changed mid-stream, and has interim results. That gives the best latency and name accuracy per hour of integration. Fallbacks:
- **Cloud:** AssemblyAI Universal-Streaming, about $0.15/h plus keyterms, or OpenAI `gpt-live-transcribe` with `keywords`.
- **Local:** Moonshine (MIT, Windows, built for live streaming) or the sherpa-onnx streaming Zipformer.

### Cited Findings
**Deepgram**
- **Keyterm Prompting** boosts up to 100 terms. It is supported on Nova-3 (monolingual and multilingual) and Flux, not Nova-2, which uses legacy Keywords.
  - The cap is 500 tokens per request, and Deepgram recommends 20 to 50 terms.
  - Repeat the parameter: `keyterm=Thibaud&keyterm=Tibo`. Multi-word terms use `+` or `%20`.
  - Commas or weights are silently treated as one literal term, which boosts nothing.
  - Capitalise proper nouns.
  - The list can be replaced mid-stream with a `Configure` message holding a `keyterms` array (`[]` clears it).
  - The docs' examples show recognition improving, e.g. "try to win" becomes "tretinoin" with confidence rising from 0.71 to 0.97.
  — [Deepgram Keyterm docs](https://developers.deepgram.com/docs/keyterm)
- **Price.** The official pricing page lists Nova-3 Monolingual at $0.0048/min and Multilingual at $0.0058/min. Third parties describe these as promotional, against regular rates of $0.0077 and $0.0092/min, and put keyterm prompting at about $0.0013/min extra. The aggregators conflict, so verify. — [Deepgram Pricing](https://deepgram.com/pricing); [activepieces Deepgram pricing 2026](https://www.activepieces.com/blog/deepgram-pricing-2026-per-minute-rates-and-add-ons.md); [cekura Deepgram pricing](https://www.cekura.ai/blogs/deepgram-pricing)
- **Latency.**
  - Nova-3 is marketed as sub-300 ms streaming latency.
  - Flux (`/v2/listen`, `flux-general-en`) end-of-turn is about 260 ms p50; Deepgram's latency doc gives a 100 to 500 ms range, and Together.ai reports p95 of 1.5 s.
  - Flux uses `eot_threshold`, `eager_eot_threshold` and `eot_timeout_ms`.
  - On Nova, `utterance_end_ms` requires `interim_results=true`, and values under 1000 ms bring no benefit.
  — [Deepgram Flux / Nova-3 migration](https://developers.deepgram.com/docs/flux/nova-3-migration); [Deepgram utterance end](https://developers.deepgram.com/docs/utterance-end); [Deepgram measuring streaming latency](https://developers.deepgram.com/docs/measuring-streaming-latency.mdx); [Together.ai Flux](https://www.together.ai/models/flux)
- Example URL, composed from the docs' parameters:
  ```
  wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1
     &interim_results=true&smart_format=true&punctuate=true&utterance_end_ms=1000
     &keyterm=Thibaud&keyterm=Tibo&keyterm=can+you+hear+me
  ```

**AssemblyAI**
- Universal-Streaming English costs $0.15/h.
- On keyterms, the sources disagree:
  - The docs say Keyterms Prompting costs $0.04/h extra and is supported on Universal-3 Pro, Universal-Streaming English and Universal-Streaming Multilingual.
  - AssemblyAI's own pricing reference lists keyterms as "Not supported" for Universal-Streaming.
- Keyterms can be updated mid-session with `UpdateConfiguration`.
- Universal-3 Pro Streaming latency: P50 about 150 ms and P90 about 240 ms after the VAD endpoint.
— [AssemblyAI pricing reference](https://www.assemblyai.com/llms/pricing.md); [AssemblyAI streaming keyterms](https://assemblyai.com/docs/streaming/keyterms-prompting); [Universal-3 Pro streaming post](https://assemblyai.com/blog/universal-3-pro-streaming)

**OpenAI realtime transcription**
- Connect to `wss://api.openai.com/v1/realtime?intent=transcription` without a model parameter, then send `session.update` with `type: "transcription"`.
- Models: `gpt-live-transcribe` is recommended and streams deltas. `gpt-transcribe` runs after commit and returns language.
- Configuration: `audio.input.transcription.prompt` and `.keywords` give vocabulary hints; `.delay` is one of minimal, low, medium, high or xhigh.
- `gpt-live-transcribe` does not support server or semantic VAD. Use client-side VAD and send `input_audio_buffer.commit`.
- Events: `conversation.item.input_audio_transcription.delta` and `.completed`. They can arrive out of order, so match on `item_id`.
- There are no word timestamps or confidence scores. Input is PCM at 24 kHz in the examples.
— [OpenAI realtime transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription)
- Pricing for these models was not on that page.

**Gemini Live API**
- Google's Live transcription guide points to `gemini-3.5-transcribe-live` for low-latency streaming transcription. — [Gemini live-transcribe guide](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe)
- Billing is per token, and transcription text tokens are billed in addition to audio tokens. — [Google AI forum](https://discuss.ai.google.dev/t/gemini-3-1-flash-live-preview-does-input-transcription-add-to-token-cost-and-can-it-be-disabled/171882)
- Third-party prices conflict: $0.54 per audio hour per Vercel versus $3.50/$21 per 1M tokens per Maxim. — [Vercel AI gateway](https://vercel.com/ai-gateway/models/gemini-3.5-transcribe-live); [Maxim](https://www.getmaxim.ai/bifrost/llm-cost-calculator/provider/gemini/model/gemini-3.5-transcribe-live)
- A third party says Gemini 3.1 Flash Live Preview and 2.5 Flash Native Audio preview shut down in the Developer API on 2026-11-17. — [cekura Gemini Live pricing](https://www.cekura.ai/blogs/gemini-live-api-pricing) [UNVERIFIED against Google]

**Local options**
- **Moonshine** (moonshine-ai):
  - Code is MIT, and models are MIT by default. The exception is the legacy non-streaming non-English models, which use the non-commercial Moonshine Community License.
  - STT languages: English, Spanish, German, Mandarin, Japanese, Korean, Vietnamese, Tagalog, Ukrainian and Arabic. **French STT is not listed.**
  - Platforms include Windows, Python and JS/WASM.
  - Quick start: `pip install moonshine-voice`, then `moonshine-voice mic --language en`.
  - The README says it does work while the user is still speaking, for low latency. It claims the top model beats Whisper Large V3 accuracy but gives no CPU latency numbers. The repo has 11.6k stars.
  — [Moonshine GitHub](https://github.com/moonshine-ai/moonshine)
- **WhisperLive** (collabora):
  - MIT, with faster_whisper, tensorrt and openvino backends. OpenVINO targets Intel CPU and iGPU, and there is a CPU Docker image `ghcr.io/collabora/whisperlive-cpu`.
  - Client: `TranscriptionClient("localhost", 9090, lang="en", model="small")`.
  - Inputs are mic, file, RTSP and HLS, with no loopback, so audio must be fed yourself.
  - It describes itself as "nearly-live", and no latency figures are given. The repo has about 4.4k stars.
  — [WhisperLive GitHub](https://github.com/collabora/WhisperLive)
- **sherpa-onnx** (k2-fsa):
  - Supports Windows with a Python API, and the docs include a Python script for real-time mic recognition with streaming Zipformer.
  - Small streaming Zipformer models (14M and 20M) are described as suitable for Cortex-A7 CPUs.
  - No Windows CPU real-time-factor (RTF) benchmark was found.
  — [sherpa-onnx GitHub](https://github.com/k2-fsa/sherpa-onnx); [sherpa mic example doc](https://github.com/k2-fsa/sherpa/blob/master/docs/source/onnx/python/real-time-speech-recongition-from-a-microphone.rst)

### Inferences
- **Name biasing:**
  - Deepgram keyterm is documented, cheap, and can be updated live, which is the strongest fit for "Thibaud" and its variants.
  - OpenAI `keywords` is a close second.
  - With local Whisper-family models, the only lever is `initial_prompt` [UNVERIFIED].
  - Phonetic post-matching (Q3) is needed whichever STT is used.
- **Cost for a demo:** at about $0.005 to $0.008/min, 10 hours of testing costs about $3 to $5. Deepgram has historically given new accounts $200 in free credit [UNVERIFIED for 2026].
- **CPU-only laptops:** Moonshine or the sherpa-onnx streaming Zipformer should run faster than real time on CPU, whereas Whisper-small streaming through faster-whisper on CPU tends to lag 1 to 3 s [UNVERIFIED, no benchmark found]. Use a local model as an offline fallback, not as primary.
- [UNVERIFIED, not researched]:
  - ufal/whisper_streaming (MIT; LocalAgreement policy, about 3 s latency in its paper)
  - whisper.cpp `stream` example (MIT)
  - NVIDIA Parakeet (CC-BY-4.0; needs a GPU or the sherpa-onnx/onnx-asr exports for CPU)
  - Vosk (Apache-2.0)

### Gaps
- No verified CPU latency or RTF numbers on Windows laptops for any local model.
- OpenAI and Gemini transcription prices are unconfirmed, and AssemblyAI's keyterm support on Universal-Streaming is contradictory.
- Deepgram's 2026 free-credit amount was not verified.

## Q3. Keyword/name spotting and phonetic matching

### Takeaway
Do not rely on a wake-word engine. Run detection on the transcript, in three layers:
1. Bias the STT with keyterms.
2. Match each interim and final transcript against a variant list ("Thibaud", "Thibault", "Tibo", "Tibault", "Teebo").
3. Fall back to phonetic codes (Double Metaphone plus a French algorithm from talisman) with an edit-distance threshold.

sherpa-onnx open-vocabulary KWS is the only good acoustic, offline, train-free option. Picovoice's free tier is reportedly dead.

### Cited Findings
- **sherpa-onnx KWS:**
  - Open-vocabulary: you supply keywords "without re-training the model".
  - Decoding is beam search over the given keywords. Each keyword has a boosting score (`:`) and a 0 to 1 trigger threshold (`#`); a lower threshold triggers more easily but gives more false alarms.
  - The keywords file has one keyword per line as tokens from `sherpa-onnx-cli text2token`, e.g. `▁HE LL O ▁WORLD :2.0 #0.25`.
  - Models: `kws-zipformer-gigaspeech-3.3M` (English, fp32 and int8), `kws-zipformer-wenetspeech-3.3M` (Chinese), and `kws-zipformer-zh-en-3M-2025-12-20`.
  - CLI: `sherpa-onnx-keyword-spotter`.
  — [sherpa-onnx KWS docs](https://k2-fsa.github.io/sherpa/onnx/kws/index.html)
- **Picovoice Porcupine:**
  - A Home Assistant community post says Picovoice disabled Free Tier AccessKeys on 2026-06-30 and is planning no non-commercial tier. Picovoice's pricing page still showed a "Forever-Free" plan, which may be stale.
  - Custom wake words trained in Console are for non-commercial and evaluation use.
  — [Home Assistant community](https://community.home-assistant.io/t/fyi-picovoice-confirmed-free-tier-accesskeys-will-stop-working-after-june-30-2026/1012744); [Picovoice pricing](https://picovoice.ai/pricing); [Porcupine docs](https://picovoice.ai/docs/porcupine/)
- **Vosk grammar:** recognizers can be built with a phrase list (e.g. Rust `new_with_grammar`). The default English model's vocabulary is limited, so out-of-vocabulary names need phonetically similar stand-ins. Licences are set per model. — [vosk-rs grammar example](https://docs.rs/crate/vosk/latest/source/examples/grammar.rs); [wyoming-vosk](https://github.com/rhasspy/wyoming-vosk)
- **PocketSphinx** keyword-list mode supports a threshold per keyword. — [speech_recognition Sphinx docs](https://www.mintlify.com/Uberi/speech_recognition/engines/sphinx)
- **Phonetic libraries (JS):**
  - npm `double-metaphone` (words/, ESM-only, Node 14.14+): `doubleMetaphone('michael')` returns a primary and secondary code. — [double-metaphone GitHub](https://github.com/words/double-metaphone)
  - npm `doublemetaphone` (hgoebl) is compatible with Apache Commons Codec. — [hgoebl/doublemetaphone](https://github.com/hgoebl/doublemetaphone)
  - npm `talisman` (Yomguithereal, v1.1.4) is a fuzzy-matching toolkit with **French phonetics**: `fonem`, `phonetic`, `phonex`, `sonnex`, `soundex`, `soundex2`. Examples: `phonex('Henri')` returns `'H1RI'` and `fonem('Beaulac')` returns `'BOLAK'`. Import paths differ between versions. — [talisman French phonetics](https://yomguithereal.github.io/talisman/phonetics/french); [talisman npm](https://npmjs.com/package/talisman)
- **Phonetic libraries (Python):**
  - PyPI `Metaphone` implements Metaphone and Double Metaphone. — [Metaphone PyPI](https://pypi.org/project/Metaphone)
  - `phonetic-fr` computes French phonetic representations. — [phonetic-fr PyPI](https://pypi.org/project/phonetic-fr/)
  - abydos has a FONEM port. — [abydos FONEM](https://abydos.readthedocs.io/en/latest/_modules/abydos/phonetic/_fonem.html)

### Inferences
- Suggested matcher in TypeScript:
  ```ts
  import { doubleMetaphone } from 'double-metaphone';
  const VARIANTS = ['thibaud','thibault','tibo','tibault','teebo','tybo'];
  const target = new Set(VARIANTS.flatMap(v => doubleMetaphone(v)));   // "Thibaud" -> roughly "TPT"/"TBT"
  function hitsName(text: string) {
    return text.toLowerCase().split(/[^a-zà-ÿ']+/).some(w =>
      VARIANTS.includes(w) || doubleMetaphone(w).some(c => target.has(c)));
  }
  ```
  - Add Levenshtein ≤ 1 on codes, or rapidfuzz `ratio ≥ 85` on the raw word, to catch "Tea bow" split across two words: also test bigrams joined together.
  - Test against false positives such as "table" and "to be". Requiring the codes to match **and** the word to start with t/th lowers false alarms.
  - The exact metaphone output for "Thibaud" was not verified.
- In Python, use `jellyfish` (MIT; metaphone, soundex, nysiis, jaro-winkler, levenshtein) plus `rapidfuzz` (MIT; fast `fuzz.partial_ratio`) [UNVERIFIED this session, but both are widely used].
- Phrases like "can you hear me" or "you're frozen" are best handled as normalised substring and regex matches on the transcript: "can you hear me", "hear me", "you're frozen", "you froze", "you're on mute", "you are muted", "lost you", "breaking up". Optionally also add them as Deepgram keyterms.
- openWakeWord (Apache-2.0 code; requires training a model per wake word) is too slow to set up for a 24 h build when the transcript already exists [UNVERIFIED].

### Gaps
- Whether Picovoice's free tier still works was not confirmed from Picovoice itself.
- No benchmark was found for sherpa-onnx KWS on unusual names or French names. The pretrained English KWS model's BPE tokens may not cover "Thibaud" well, so it would need spelling as English-like tokens such as "TEE BO" [UNVERIFIED].

## Q4. Question detection and a recommended 24-hour stack

### Takeaway
Use rules for the MVP. A final utterance counts as "addressed to the user" if it contains a name hit **and** either a question mark from STT punctuation or a question-word or auxiliary-verb opener, or if it is a name hit followed within about 5 s by a question. Optionally pass the last 30 s of transcript to an LLM to classify and summarise "what was asked". No dedicated question-detection repo was researched.

### Cited Findings
- Deepgram `smart_format` and `punctuate` provide punctuation (including "?"), and `utterance_end_ms` plus `is_final` give utterance boundaries to run rules on. — [Deepgram utterance end](https://developers.deepgram.com/docs/utterance-end); [Deepgram Keyterm docs](https://developers.deepgram.com/docs/keyterm)
- OpenAI `gpt-live-transcribe` gives a final transcript per committed item, which can be classified the same way. — [OpenAI realtime transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription)

### Inferences
- **Rule set:**
  - The utterance ends with "?", OR
  - it starts with what, why, how, when, where, who, which, can, could, would, will, do, does, did, is, are, have, should, OR
  - it contains "what do you think", "any thoughts", "your take", "over to you".
  - Combine with a name hit within the same or previous utterance.
  - Precision and recall are unmeasured.
- **Small classifiers** (e.g. a zero-shot model or a fine-tuned DistilBERT question classifier from Hugging Face) add setup time for little gain over rules plus an LLM call [UNVERIFIED].
- **Recommended stack:**

| Layer | Primary (cloud) | Fallback | Effort (h) |
|---|---|---|---|
| Capture | Electron `setDisplayMediaRequestHandler` + `audio:'loopback'`, AudioWorklet → 16 kHz PCM16 | Python sidecar with PyAudioWPatch over a local WebSocket | 1.5–2 (+1 fallback) |
| STT | Deepgram Nova-3 streaming, `interim_results`, `smart_format`, `keyterm` = name variants + alert phrases | Local: Moonshine (`moonshine-voice`, English) or sherpa-onnx streaming Zipformer; cloud alt: OpenAI `gpt-live-transcribe` with `keywords` | 2–3 (+2–3 local fallback) |
| Name spotting | Variant list + Double Metaphone + talisman `phonex`/`sonnex` + fuzzy ratio on words and joined bigrams; run on interim results for speed and confirm on final | sherpa-onnx KWS (acoustic, offline) | 2–3 |
| Alert phrases | Regex/substring list on normalised transcript | Deepgram keyterms for those phrases | 0.5–1 |
| Question detection | Rules above; LLM call for "what was asked" summary | — | 1–2 |
| Test harness | Record a WAV of a Zoom/Meet test call with teammates saying "Thibaud/Tibo…", replay it through the pipeline | — | 1–2 |

- **Total:** about 8 to 13 person-hours for the audio and detection core, which a 4-person team can parallelise as capture, STT, matcher and UI.
- **End-to-end latency:** Deepgram interim results under 300 ms plus capture buffering of about 100 ms plus matching under 10 ms should flag a name hit within about 0.5 to 1 s of it being spoken [UNVERIFIED estimate].
- **Licences:** Electron, PyAudioWPatch, Moonshine (English), WhisperLive, double-metaphone and talisman are all MIT. sherpa-onnx is Apache-2.0 [UNVERIFIED this session]. Deepgram and OpenAI are commercial pay-as-you-go. Avoid Picovoice because its free tier is in doubt.

### Gaps
- No question-detection repos or measured precision and recall were researched.
- The effort estimates are judgement calls, not sourced.
