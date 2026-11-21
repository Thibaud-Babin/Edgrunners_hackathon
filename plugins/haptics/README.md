# Haptics plugin (owner: C) — P1-5

Until this exists, Tap uses the **HapticWeb** plugin from the Logi Marketplace (`TAP_HAPTIC_URL=https://local.jmw.nz:41443`).

Plan (see `docs/PRD.md` §5):

1. Install Logi Options+ (≥ 1.95), .NET 10 (or .NET 8 if Plugin Service < 6.4).
2. Fork the `HapticsPlugin` sample from https://github.com/Logitech/actions-sdk into this folder (check its licence; declare it in the Rule 30 table).
3. Add an `HttpListener` on `http://127.0.0.1:41444/` so `POST /haptic/{waveform}` calls `PluginEvents.RaiseEvent(waveform)`.
   Same URL shape as HapticWeb → switching is just `TAP_HAPTIC_URL=http://127.0.0.1:41444` in `app/.env`.
4. Map all 15 waveforms in `events/extra/eventMapping.yaml` (event names must match the YAML files and code exactly).
5. `dotnet build` → the plugin loads locally via the `.link` file, no Marketplace approval needed.
