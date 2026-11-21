# Optional Python sidecar (owner: B)

Only if the Node path fails:
- Electron loopback gives no audio on a laptop → capture with **PyAudioWPatch** here instead.
- `sherpa-onnx-node` won't install/run in Electron → run **sherpa-onnx** (Python) here instead.

Contract: send the same transcript results to the app. Easiest: add a small WebSocket server in
`app/src/main/audio/` on `ws://127.0.0.1:8765` that calls `AudioPipeline.onText(source, text, final)`
for messages like `{"source": "call_audio", "text": "...", "final": true}`.

```
python -m venv .venv && .venv\Scripts\activate
pip install pyaudiowpatch sherpa-onnx numpy websockets
```
