# Technical feasibility: real-time multimodal webcam and microphone AI in a 20-hour student hackathon (late 2026)

Scope: a browser web app in TypeScript/Python, built by a team of 3-4 in about 20 hours. Research date: 2026-11-21. I used about 15 search/fetch calls, so several sub-questions are only partly sourced. Anything marked "UNVERIFIED (prior knowledge)" comes from the researcher's background knowledge and was not checked against a source this session. The report writer should label it as such or leave it out.

## 1. MediaPipe Tasks (web): available solutions, performance, limits, custom gestures

### Takeaway
MediaPipe Tasks is still the strongest on-device building block. 19 of its 22 tasks run on the Web, including Hand, Face (478 landmarks plus 52 blendshapes), Pose and Holistic landmarkers, the Gesture Recognizer with 8 built-in gestures, and image/audio classifiers. There are also newer audio tasks (Audio Transcriber, Text-to-Speech). Getting a demo running takes about 1-2 hours. The main risks are UI-thread blocking and stacking several models at once. I found no official laptop FPS figures for web.

### Cited Findings
- The official guide lists 22 tasks in five categories. Vision: Face Detector, Face Landmarker, Gesture Recognizer, Hand Landmarker, Holistic Landmarker, Image Classifier, Image Embedder, Image Segmenter, Interactive Segmenter, Object Detector, Pose Landmarker. Audio: Audio Classifier (521 sound events, YAMNet), plus Audio Transcriber and Text-to-Speech (24 kHz), both marked "New". Text: Language Detector, Text Classifier, Text Embedder, plus Proofreader and Summarizer (no Web). Others: Decision Maker, Semantic Retriever, Universal Embedder. 19 of 22 support Web. Holistic Landmarker is listed as current, not deprecated. Install is `npm @mediapipe/tasks-vision@latest`. — [MediaPipe Solutions guide](https://developers.google.com/edge/mediapipe/solutions/guide) (ai.google.dev/edge now redirects to developers.google.com/edge)
- The Gesture Recognizer's built-in gestures are None, Closed_Fist, Open_Palm, Pointing_Up, Thumb_Down, Thumb_Up, Victory and ILoveYou. `num_hands` defaults to 1 and accepts any integer above 0. The full pipeline averages 16.76 ms on CPU and 20.87 ms on GPU on a Pixel 6, which is a phone benchmark, not a laptop browser. The model bundle can be extended with a custom gesture classifier (`customGesturesClassifierOptions`), and custom gestures win over canned ones when both match. The model is float16, with inputs of 192x192 and 224x224. — [Gesture Recognizer docs](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer)
- Face Landmarker returns 478 3D landmarks per face and 52 blendshape scores (`outputFaceBlendshapes`). `num_faces` defaults to 1, and temporal smoothing applies only when numFaces = 1. The pipeline is BlazeFace short-range (128x128) → landmark model (256x256) → blendshape model, all float16. The web running modes are IMAGE and VIDEO; live webcam use is VIDEO plus requestAnimationFrame, and examples use `delegate: "GPU"`. Mirroring the input swaps the *Left/*Right blendshapes. — [Face Landmarker docs](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker)
- On web, the Hand Landmarker's `detect()`/`detectForVideo()` calls are synchronous and block the UI thread. The docs suggest web workers. The GPU delegate is set in `baseOptions`. — [Hand Landmarker web guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js?authuser=4)
- The only laptop FPS figure I found is old (2021, the earlier MediaPipe Hands model, two hands, 2019 MacBook Pro with Radeon Pro Vega 20): roughly 62 and 48 FPS for the MediaPipe WASM/GPU runtimes. The table was garbled when extracted, so treat these as rough. — [TensorFlow blog, 3D Hand Pose (2021)](https://blog.tensorflow.org/2021/11/3D-handpose.html?hl=sq)

### Inferences
- A single landmarker (hands or face) should run in real time (≥30 FPS) on a recent laptop with GPU delegate. This is consistent with the ~17-21 ms Pixel 6 pipeline and the 2021 laptop figures, but not measured on current web builds. Running Hand + Face + Pose separately at the same time will likely drop FPS noticeably on integrated GPUs. Holistic Landmarker, or alternating models frame by frame, is the frugal option.
- Built-in gestures work with zero training, so a gesture-controlled UI built on the 8 canned gestures takes about 1-3 hours.
- Custom gestures are often easier as "landmarks → small classifier in JS" (kNN or a small MLP on 21×3 normalized hand landmarks, trained in the browser from a few dozen samples per class) than through the Model Maker Python pipeline. A team can record their own samples live. Effort: about 3-5 hours.
- UNVERIFIED (prior knowledge): Model Maker (`mediapipe-model-maker`, Python, typically in Colab) trains a custom gesture classifier from a folder-per-class image dataset. It requires a `none` class folder and exports a `.task` bundle for web. Google's tutorial uses a rock-paper-scissors dataset with a few hundred images per class, and training takes minutes on Colab. The package has historically had Python-version and dependency friction. Budget 2-4 hours including data capture, or skip it in favor of the JS kNN approach.
- Lighting, occlusion (hand over face, crossed hands), fast motion blur and hands at frame edges are the usual failure modes. Demo in good front lighting.

### Gaps
- The official customization page for Model Maker gesture training would not give me dataset size, `none`-class or Python-version details (it returned the inference page content). I could not verify data requirements.
- No current official web FPS/latency numbers for laptops for any vision task. The team should benchmark the official demos on day 0.
- Exact max hands/faces is open-ended (an integer above 0). I found no documented accuracy curves for how lighting or occlusion affects results.

## 2. Sign language recognition feasibility

### Takeaway
Isolated sign recognition from MediaPipe landmarks is a solved Kaggle-scale problem (250 ASL signs, about 100k videos, top solutions around 0.8-0.9 accuracy). A hackathon team cannot reproduce that without the dataset and GPU training. They can realistically do 5-20 custom signs or static fingerspelling letters with template matching (DTW/kNN) on landmark sequences they recorded themselves, which works for a demo. Continuous translation is not feasible. SignGemma's open weights still appear unreleased, and Swiss DSGS data exists but is research-licensed and small.

### Cited Findings
- The Google Isolated Sign Language Recognition (GISLR) Kaggle competition ran Feb-May 2023 with a $100,000 prize. The task was classifying isolated sign videos into 250 classes. — [element14 / hackster write-up](https://hackster.io/AlbertaBeef/insightful-datasets-for-asl-recognition-f786b9) (via search snippet)
- The corpus is MediaPipe landmark data for about 100k videos of isolated signs by 21 Deaf signers, from a 250-sign vocabulary. — [Hyeonwoo Cho silver-medal write-up](https://hyeonwoocho7.github.io/hwc.github.io/project/google-isolated-sign-language-recognition)
- The 2nd-place solution scored about 0.898 CV accuracy with a single EfficientNet-B0 fold (160x80 input) and about 0.80 on the leaderboard. An ensemble with BERT/DeBERTa reached about 0.81 LB. — [2nd place GISLR GitHub](https://github.com/ffs333/2nd_place_GISLR)
- The 1st-place solution (hoyso48) used 118 selected landmarks and stacked 1D convolutional blocks (plus transformer). Its weights are mirrored on Hugging Face and have been reused by hobby projects in browser ASL apps. — [Stanford CS231n 2024 paper](https://cs231n.stanford.edu/2024/papers/live-non-isolated-sign-language-recognition-using-transformers.pdf); [HF mirror of 1st place](https://huggingface.co/sign/kaggle-asl-signs-1st-place); [DEV: ASL app using Kaggle top model + custom MediaPipe gesture model](https://dev.to/yoshan0921/developing-an-asl-app-with-kaggles-top-model-and-customized-mediapipe-gesture-model-5eaa)
- The ASL Fingerspelling Kaggle competition was won by Christof Henkel (NVIDIA) and a teammate. They used an encoder-decoder with an improved Squeezeformer encoder on MediaPipe landmarks (adapted from speech recognition), a 2-layer transformer decoder, and TF-Lite export. — [NVIDIA blog](https://blogs.nvidia.com/blog/2023/10/23/nvidia-life-kaggle-ai-contest-sign-language-recognition); [1st place repo](https://github.com/ChristofHenkel/kaggle-asl-fingerspelling-1st-place-solution)
- A Stanford student project on live non-isolated recognition reports about 80% validation accuracy on isolated segments. That is a student result, not a benchmark. — [CS231n 2024](https://cs231n.stanford.edu/2024/papers/live-non-isolated-sign-language-recognition-using-transformers.pdf)
- SignGemma was announced at Google I/O 2025 as an open sign-language→text model (ASL→English) planned for the Gemma family later in 2025. Developer-forum threads asking for access/release dates got "no specific timeline to share". — [Google AI dev forum: SignGemma release date](https://discuss.ai.google.dev/t/signgemma-release-date/113794); [SignGemma availability thread](https://discuss.ai.google.dev/t/signgemma-availability/111432); [TechCrunch May 2025](https://techcrunch.com/2025/05/20/the-newest-google-gemma-ai-model-can-run-on-phones)
- Mid-2026 secondary reports describe a DeepMind sign-language-to-text feature ("SL2T") in Gboard/Live Transcribe on Pixel, starting with ASL. A sign-to-text option was spotted in a Gboard beta on July 17, 2026. These reports are secondary, and it is unclear whether SL2T is SignGemma. — [Mitrade news, Aug 2026](https://www.mitrade.com/insights/news/live-news/article-3-1990915-20260813); [Android Authority](https://androidauthority.com/gboard-sign-to-text-3688910)
- Google's Gemma releases page lists 2026 releases (e.g. Gemma 4 12B Unified, June 3 2026). The search summary did not show a SignGemma entry. — [Gemma releases](https://ai.google.dev/gemma/docs/releases?hl=en)
- Swiss German Sign Language (DSGS): the SMILE dataset (LREC 2018) covers 100 isolated signs, recorded with Kinect color video and pose, OpenPose 2D keypoints and iLex annotations. The paper reports 11 L1 + 19 L2 signers; Zenodo reports 16 L1 + 22 L2. Access is by EULA and strictly non-commercial research. — [LREC 2018 paper](https://www.sign-lang.uni-hamburg.de/lrec/pub/L18-1666.html); [Zenodo record](https://zenodo.org/record/7701457)
- A newer SMILE Continuous DSGS corpus (LREC 2026 workshop) is a longitudinal learner corpus licensed CC BY-NC-SA 4.0 and hosted on SWISSUbase. — [sign-lang anthology 26034](https://www.sign-lang.uni-hamburg.de/lrec/pub/26034.html); [UZH news](https://www.cl.uzh.ch/de/about-us/news/Highly-valuable-DSGS-dataset-on-SWISSUbase.html)

### Inferences
- Realistic hackathon scope: about 10-20 isolated signs or static letters, recorded by the team (about 10-30 samples per sign), classified by kNN on normalized hand landmarks (static) or DTW over short landmark sequences (dynamic). Expect good accuracy for the person who recorded the samples and noticeably worse for other signers. Effort: about 6-10 hours for a polished demo.
- Using the Kaggle 1st-place TFLite model in the browser would give 250 ASL signs without training. That is a stronger demo, but it is ASL only and needs about 4-8 hours of integration (input preprocessing must match exactly).
- No ready model exists for LSF-CH (Swiss French Sign Language) or DSGS. Any Swiss-sign demo would rely on self-recorded templates. Projects should be framed as "assistive prototype", not "translation", and ideally checked with Deaf users.

### Gaps
- I could not verify the 1st-place GISLR private leaderboard accuracy (commonly cited as about 0.89) or the fingerspelling 1st-place normalized Levenshtein score from a primary source.
- I found no LSF-CH (Swiss French Sign Language) dataset.
- WLASL benchmark accuracies were not retrieved.

## 3. Webcam gaze and head tracking accuracy

### Takeaway
Browser webcam gaze tracking (WebGazer.js) is accurate to only about 3.5-4.2° of visual angle (about 170-210 px), and it drifts. That is enough for "which screen quadrant/large button", not for fine cursor control. Head pose from MediaPipe Face Landmarker is a more robust input for hands-free UI.

### Cited Findings
- Original WebGazer study (76 online participants plus 4 in lab): errors of 175 and 210 px for its two regression models, and about 4.17° of visual angle, comparable to a low-cost commercial tracker at the time. — [WebGazer paper (Papoutsaki et al.), NSF PAR](https://par.nsf.gov/servlets/purl/10024076)
- Later reviews put its average error above 4° (about 172 px in lab), worse online, versus 0.5-1° for dedicated infrared trackers. — [PMC review](https://pmc.ncbi.nlm.nih.gov/articles/PMC11289017); [Behavior Research Methods 2023](https://link.springer.com/article/10.3758/s13428-023-02237-8)
- A WebGazer-in-Gorilla student study reports 3.65° mean accuracy (SD 0.77°), with drift over the session. — [Utrecht thesis](https://studenttheses.uu.nl/bitstream/handle/20.500.12932/40709/Eindwerkstuk_Bachelor_KI_Mark_Wessel_6008283_final.pdf?sequence=1)
- A 2026 study found a median 3.72° webcam error versus 0.76° in the lab. — [arXiv 2308.06035](https://arxiv.org/pdf/2308.06035)
- Better webcam systems reach about 1.4° accuracy (Labvanced, not WebGazer). A research system under natural head movement reported about 1.7°/2.0° (x/y). — [Springer 2023](https://link.springer.com/article/10.3758/s13428-023-02237-8); [arXiv 1803.11088](https://arxiv.org/pdf/1803.11088)

### Inferences
- On a 1920px-wide laptop screen, about 200 px of error means targets should be at least about 300-400 px, a 2x2 or 3x3 grid at most, with dwell-time selection and frequent recalibration. Effort: about 3-5 hours with WebGazer, which needs a 9-point calibration.
- Head pose (nose landmark / facial transformation matrix) plus blink/blendshape "clicks" is more reliable and has no calibration drift. Effort: about 2-4 hours.

### Gaps
- No published accuracy for MediaPipe iris-based gaze estimation in browsers was found.

## 4. Speech-to-text for live captions (browser, local Whisper, cloud), diarization, keyword spotting

### Takeaway
For a 20-hour build, the fastest route to live captions is the Web Speech API in Chrome/Edge (zero setup, free, Chromium-centric). The most robust route is a streaming cloud API like Deepgram Nova-3 (about $0.0048/min, with diarization as an add-on), which works in any browser. In-browser Whisper via transformers.js/WebGPU works for privacy demos but is not natively streaming. Use tiny/base models, chunk the audio, use VAD, and watch VRAM.

### Cited Findings
- Web Speech API: Chromium supports `SpeechRecognition` (Safari partially, prefixed as `webkitSpeechRecognition`). The newer `processLocally` (on-device) option is supported in Edge 139+ and Opera 123+ with an `available()`/`install()` flow for the local model. It is unsupported in Firefox through 158 and in iOS Safari through 27.0, and MDN marks it experimental. A Mozilla on-device SpeechRecognition intent thread (Sept 2026) is still under investigation. — [caniuse processLocally](https://caniuse.com/mdn-api_speechrecognition_processlocally); [caniuse web-speech](https://caniuse.com/speech-recognition); [Microsoft Edge docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/speech-recognition-api); [MDN processLocally](https://developer.mozilla.org/docs/Web/API/SpeechRecognition/processLocally); [Mozilla dev-platform thread](https://groups.google.com/a/mozilla.org/g/dev-platform/c/6f4l8P9hO6o)
- A W3C TAG review discusses privacy and permission concerns of on-device Web Speech. — [W3C TAG #1038](https://tag-github-bot.w3.org/gh/w3ctag/design-reviews/1038)
- In-browser Whisper (transformers.js): it is not natively streaming and needs fixed-length chunks from the mic stream. Use tiny or base models for real time, put a VAD gate in front, and run off the main thread. Without WebGPU it falls back to WASM (slower). — [LogRocket: real-time voice AI agent in the browser](https://blog.logrocket.com/how-to-build-a-real-time-voice-ai-agent-in-the-browser); [transformers.js WebGPU guide](https://huggingface.co/docs/transformers.js/en/guides/webgpu); [xenova/whisper-web](https://github.com/xenova/whisper-web)
- One user reported GPU VRAM climbing to nearly 100% within about 2 minutes in the Xenova realtime-whisper-webgpu demo. — [HF discussion](https://huggingface.co/spaces/Xenova/realtime-whisper-webgpu/discussions/1)
- Whisper-Turbo (Rust/WASM/WebGPU) claims about 20x real-time, with streaming still work in progress. — [whisper-turbo GitHub](https://github.com/hbcbh1999/whisper-turbo)
- Parakeet v3 via WebGPU is a reported client-side alternative. — [DEV: Parakeet v3 + WebGPU](https://dev.to/maikidev/client-side-audio-transcription-using-parakeet-v3-and-webgpu-1916)
- MediaPipe now lists an "Audio Transcriber" task with Web support (marked New). — [MediaPipe guide](https://developers.google.com/edge/mediapipe/solutions/guide)
- Deepgram's official pricing page lists Nova-3 Monolingual at $0.0048/min and Multilingual at $0.0058/min. A pricing tracker says $0.0048 is a promotional rate against a $0.0077 regular rate. Cloudflare Workers AI resells Nova-3 at $0.0052/min, or $0.0092/min over websocket. Third-party figures put diarization at about +$0.002/min and keyterm prompting at about +$0.0013/min. — [Deepgram pricing](https://deepgram.com/pricing); [activepieces 2026 breakdown](https://www.activepieces.com/blog/deepgram-pricing-2026-per-minute-rates-and-add-ons); [Cloudflare Nova-3](https://developers.cloudflare.com/workers-ai/models/nova-3)

### Inferences
- Costs are trivial at hackathon scale. 20 hours of streaming at about $0.005-0.01/min is about $6-12, and vendor free credits usually cover it (UNVERIFIED: Deepgram has historically offered about $200 of signup credit).
- Keyword or name spotting: Deepgram keyterm prompting, or simple string/fuzzy matching on interim transcripts. Both take under an hour.
- Diarization: cloud APIs handle it. A browser-only alternative is "speaker = which mic/participant" or face-based active-speaker detection (mouth-open blendshapes). True local diarization (e.g. pyannote in Python) is likely 4+ hours and fragile.
- Effort estimates: Web Speech API captions about 1 hour. Deepgram websocket from browser (via a small token server) about 2-3 hours. transformers.js Whisper with VAD about 4-6 hours.
- UNVERIFIED (prior knowledge): Chrome's Web Speech API sends audio to Google servers by default, which is a privacy caveat. faster-whisper (Python, CTranslate2) on a laptop GPU is a good local server option. AssemblyAI streaming and OpenAI realtime transcription are alternatives with similar sub-second latency.

### Gaps
- No measured end-to-end latency figures for in-browser Whisper on named hardware.
- AssemblyAI, Google and OpenAI streaming prices and latencies were not checked this session.

## 5. Text-to-speech options

### Takeaway
Browser `speechSynthesis` is free and instant (UNVERIFIED details). MediaPipe now lists an on-device Text-to-Speech task for Web (24 kHz). Cheap cloud neural TTS is available but was not priced this session.

### Cited Findings
- MediaPipe lists a Text-to-Speech task (marked New) with Web support and 24 kHz output. — [MediaPipe guide](https://developers.google.com/edge/mediapipe/solutions/guide)

### Inferences
- UNVERIFIED (prior knowledge): `window.speechSynthesis` works in all major browsers, and voice quality varies by OS (Edge offers neural "Online" voices). It takes about 15 minutes to integrate. Kokoro-82M via transformers.js gives decent in-browser neural TTS. Cloud options (ElevenLabs, OpenAI TTS, Google Cloud TTS) cost cents per demo.

### Gaps
- No sourced pricing or latency for neural TTS vendors.

## 6. Small or cheap LLMs and frugal pipeline design

### Takeaway
Cloud small models are now extremely cheap. Claude Haiku 5.5 is reported at $0.10/$0.50 per million input/output tokens for prompts up to 100K tokens (third-party sources). A landmark-to-text, event-triggered pipeline therefore costs fractions of a cent per call. Chrome's built-in Gemini Nano Prompt API (text/image/audio in, text out) is available on desktop Chrome but has hardware requirements, so it is risky as the only path in a demo.

### Cited Findings
- Claude Haiku 5.5 (launched about Oct 15, 2026) is reported at $0.10/MTok input and $0.50/MTok output for prompts ≤100K tokens. Rates are 5x higher above 100K ($0.50/$2.50). Cache reads are $0.01/MTok (≤100K), and batch is reportedly half price. For comparison, Haiku 4.5 was $1/$5. All sources are third-party, and Anthropic's own pricing page was not retrieved. — [techenclave](https://techenclave.com/news/items/claude-haiku-5-5-launches-with-0-10-input-pricing-for-shorter-prompts); [neoteo](https://www.neoteo.com/en/anthropic-launches-claude-haiku-55-with-tiered-api-pricing); [usagepricing](https://www.usagepricing.com/blueprint/activity/anthropic-2026-10-15-haiku-5-5-launch); [Anthropic pricing page (not fetched)](https://platform.claude.com/docs/en/about-claude/pricing)
- Chrome Prompt API (Gemini Nano): accepts text, image and audio input and outputs text only. Docs say it is available from Chrome 148 on desktop (Windows, macOS, Linux, Chromebook Plus), not on Android/iOS. Hardware: a GPU with more than 4 GB VRAM, or CPU-only with at least 16 GB RAM and 4 cores. A 2025 intent-to-ship covered text, image and audio input. I found no clear confirmation that multimodal input is stable everywhere. — [Chrome Prompt API docs](https://developer.chrome.com/docs/ai/prompt-api); [Chrome built-in AI language model guide](https://developer.chrome.com/docs/modern-web-guidance/guides/built-in-ai/language-model); [blink-dev intent to ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/iR6R7-nQeHI)
- Deepgram Nova-3 is also offered via OpenRouter, so a single OpenRouter key can cover both STT and LLMs. — [OpenRouter Nova-3](https://openrouter.ai/deepgram/nova-3/api)

### Inferences
- Frugal pattern: run vision and audio locally (MediaPipe, Web Speech), convert to compact text events (e.g. "user gestured THUMB_UP", "transcript chunk: …", "blendshape: frown 0.7"), and call the LLM only on triggers (end of utterance, new gesture, every N seconds). A 500-token-in / 100-token-out call on Haiku 5.5 costs about $0.0001, so a whole hackathon costs well under $1. Avoid sending raw frames; when an image is needed, send one downscaled snapshot on demand.
- The Chrome Prompt API makes a good "offline/private" story but should have a cloud fallback because of the hardware gating. Effort: about 1-2 hours with fallback.
- UNVERIFIED (prior knowledge): WebLLM (MLC) and transformers.js run 0.5-3B models in-browser with WebGPU. First load downloads hundreds of MB to GBs, which is risky on hackathon Wi-Fi, so pre-cache. Ollama with small models (e.g. 1-4B) on a team laptop is a reliable offline fallback with about 1-second responses.

### Gaps
- No measured latency figures for Haiku 5.5, Gemini Nano or WebLLM gathered this session.
- OpenRouter cheap-model pricing not checked.

## 7. Getting output into Zoom, Teams or Meet without native plugins

### Takeaway
The lowest-effort, most universal route is OBS Studio: a Browser Source pointing at the web app (captions/overlays, transparent background), then Start Virtual Camera, then select "OBS Virtual Camera" in Zoom, Meet or Teams. It takes about 1-2 hours including testing. A Chrome extension that injects overlays into Google Meet is feasible but brittle. The Zoom Apps SDK has the highest overhead.

### Cited Findings
- OBS workflow: Sources → + → Browser, paste the URL (optionally "Control audio via OBS") → Start Virtual Camera. In Zoom: Settings → Video → Camera → OBS-Camera. In Google Meet: Settings → Camera → OBS Virtual Camera. — [Movavi OBS virtual camera guide](https://movavi.com/learning-portal/obs-virtual-camera.html); [UT Austin wiki: OBS feeding Zoom](https://cloud.wikis.utexas.edu/wiki/spaces/comm/pages/33425602/Install+OBS+as+a+virtual+video+switcher+feeding+Zoom); [Duo Labs](https://duo.com/labs/tech-notes/leveling-up-your-video-conferencing-with-obs)
- Pitfall: an OBS forum report says caption window output stalled in Zoom when the OBS preview was hidden or minimized. The report was about a window capture, not a browser source. — [OBS forum thread](https://obsproject.com/forum/threads/live-web-captioner-output-stalling-when-virtual-camera-is-sent-to-zoom.150225)
- VDO.Ninja is an alternative bridge for using a browser stream as a webcam in Meet or Zoom. — [VDO.Ninja docs](https://docs.vdo.ninja/guides/use-vdo.ninja-as-a-webcam-for-google-hangouts-zoom-and-more)

### Inferences
- Webcam contention: if the web app and Zoom both need the physical camera, Windows may lock it to one app. The usual fix is to capture the camera only inside OBS (the OBS Video Capture source plus the overlay browser source) and let the web app read the OBS Virtual Camera. Alternatively the web app renders camera plus overlay into one canvas, which OBS captures.
- UNVERIFIED (prior knowledge): Audio out (TTS into the meeting) needs a virtual audio cable (VB-Audio Cable on Windows, BlackHole on macOS). It takes about 30-60 minutes and is fiddly with echo. A Chrome MV3 extension content script on meet.google.com can read DOM captions and draw overlays (about 4-6 hours, breaks when Meet's DOM changes). The Zoom Apps SDK / Meeting SDK needs a Zoom Marketplace developer app, OAuth and a dev-mode install; it is realistically 6-10+ hours and is not recommended. Google Meet Add-ons SDK and Teams apps carry similar overhead.

### Gaps
- No sourced effort or limitation details for the Zoom Apps SDK, Meet Add-ons SDK or Teams apps were gathered this session.

## 8. Known pitfalls: permissions, HTTPS, running several models

### Takeaway
getUserMedia needs a secure context (HTTPS or localhost). MediaPipe inference is synchronous on the main thread. Running several models plus in-browser Whisper or an LLM competes for the same GPU and VRAM.

### Cited Findings
- MediaPipe web `detect()`/`detectForVideo()` block the UI thread; use web workers. — [Hand Landmarker web guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js?authuser=4)
- In-browser Whisper can saturate GPU VRAM over minutes. — [HF discussion](https://huggingface.co/spaces/Xenova/realtime-whisper-webgpu/discussions/1)
- Gemini Nano audio input needs a GPU with more than 4 GB VRAM. — [Chrome Prompt API docs](https://developer.chrome.com/docs/ai/prompt-api?authuser=1)

### Inferences
- UNVERIFIED (prior knowledge): camera and mic require HTTPS except on `localhost`. For phone or second-device testing, use an ngrok/Cloudflare tunnel or Vite's `--https`. Permission prompts reset per origin, so keep one stable URL for the demo. Only one browser tab or app may hold the camera on some OSes.
- Budget the GPU: one MediaPipe landmarker (or Holistic) + Web Speech API + cloud LLM is safe on a typical laptop. Adding in-browser Whisper + WebLLM + multiple landmarkers risks frame drops and tab crashes during the demo. Pick at most one heavy in-browser model.
- Download the model files (`.task`, wasm) ahead of time and serve them locally, to protect against venue Wi-Fi.

### Gaps
- No sourced benchmark for running several MediaPipe tasks at once in a browser.
