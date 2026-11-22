# OWNER: B. Windows microphone helper for Tap (Windows Core Audio, no extra install).
# Runs as a long-lived process: reads one command per line on stdin, answers one JSON line on stdout.
#   list                  -> {"ok":true,"mics":[{"id","name","default","muted","volume"}]}
#   unmute <id>           -> unmutes that mic (Windows-level mute, the one Meet/Teams/Tap all hear)
#   default <id>          -> makes that mic the Windows default (console, multimedia and communications)
#   volume <id> <0..1>    -> sets that mic's Windows input volume
#   mute <id>             -> TEST ONLY (scripts/test-win-mic.mts): Tap itself never mutes anyone
# Apps set to "Default" microphone (Meet's default setting) follow the new default.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace TapMic {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom {}
  [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")] class PolicyConfigCom {}

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
  }
  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection { int GetCount(out int count); int Item(int index, out IMMDevice device); }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    int OpenPropertyStore(int access, out IPropertyStore store);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetState(out int state);
  }
  [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore { int GetCount(out int c); int GetAt(int i, out PROPERTYKEY k); int GetValue(ref PROPERTYKEY key, out PROPVARIANT v); }
  [StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public int pid; }
  [StructLayout(LayoutKind.Explicit)] struct PROPVARIANT { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; [FieldOffset(16)] public long pad; }

  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr n); int UnregisterControlChangeNotify(IntPtr n);
    int GetChannelCount(out int c);
    int SetMasterVolumeLevel(float db, ref Guid ctx); int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
    int GetMasterVolumeLevel(out float db); int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(int ch, float db, ref Guid ctx); int SetChannelVolumeLevelScalar(int ch, float level, ref Guid ctx);
    int GetChannelVolumeLevel(int ch, out float db); int GetChannelVolumeLevelScalar(int ch, out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }
  // Undocumented but stable since Windows 7 (used by every "set default audio device" tool). Only the slot order matters.
  [Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPolicyConfig {
    int GetMixFormat(); int GetDeviceFormat(); int ResetDeviceFormat(); int SetDeviceFormat();
    int GetProcessingPeriod(); int SetProcessingPeriod(); int GetShareMode(); int SetShareMode();
    int GetPropertyValue(); int SetPropertyValue();
    int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
  }

  public static class Mics {
    const int CAPTURE = 1, ACTIVE = 1;
    static IMMDeviceEnumerator En() { return (IMMDeviceEnumerator)new MMDeviceEnumeratorCom(); }
    static IAudioEndpointVolume Vol(IMMDevice d) {
      Guid iid = typeof(IAudioEndpointVolume).GUID; object o; d.Activate(ref iid, 23, IntPtr.Zero, out o); return (IAudioEndpointVolume)o;
    }
    static string Name(IMMDevice d) {
      IPropertyStore s; d.OpenPropertyStore(0, out s);
      PROPERTYKEY k = new PROPERTYKEY { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
      PROPVARIANT v; s.GetValue(ref k, out v);
      return v.vt == 31 ? Marshal.PtrToStringUni(v.p) : "";
    }
    static string J(string s) { return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }

    public static string List() {
      var en = En(); IMMDeviceCollection col; en.EnumAudioEndpoints(CAPTURE, ACTIVE, out col);
      string defId = "";
      IMMDevice def; if (en.GetDefaultAudioEndpoint(CAPTURE, 2, out def) == 0 && def != null) def.GetId(out defId);
      int n; col.GetCount(out n);
      var sb = new StringBuilder("{\"ok\":true,\"mics\":[");
      for (int i = 0; i < n; i++) {
        IMMDevice d; col.Item(i, out d); string id; d.GetId(out id);
        var vol = Vol(d); bool muted; vol.GetMute(out muted); float level; vol.GetMasterVolumeLevelScalar(out level);
        if (i > 0) sb.Append(",");
        sb.Append("{\"id\":" + J(id) + ",\"name\":" + J(Name(d)) + ",\"default\":" + (id == defId ? "true" : "false") +
                  ",\"muted\":" + (muted ? "true" : "false") + ",\"volume\":" + level.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture) + "}");
      }
      return sb.Append("]}").ToString();
    }
    public static string Mute(string id) {
      IMMDevice d; En().GetDevice(id, out d); Guid ctx = Guid.Empty; int hr = Vol(d).SetMute(true, ref ctx);
      return "{\"ok\":" + (hr == 0 ? "true" : "false") + "}";
    }
    public static string Unmute(string id) {
      IMMDevice d; En().GetDevice(id, out d); Guid ctx = Guid.Empty; int hr = Vol(d).SetMute(false, ref ctx);
      return "{\"ok\":" + (hr == 0 ? "true" : "false") + "}";
    }
    public static string SetVolume(string id, float level) {
      IMMDevice d; En().GetDevice(id, out d); Guid ctx = Guid.Empty; int hr = Vol(d).SetMasterVolumeLevelScalar(level, ref ctx);
      return "{\"ok\":" + (hr == 0 ? "true" : "false") + "}";
    }
    public static string SetDefault(string id) {
      var pc = (IPolicyConfig)new PolicyConfigCom(); int hr = 0;
      for (int role = 0; role < 3; role++) hr |= pc.SetDefaultEndpoint(id, role);
      return "{\"ok\":" + (hr == 0 ? "true" : "false") + "}";
    }
  }
}
'@
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $cmd, $arg = $line.Trim() -split ' ', 2
  try {
    switch ($cmd) {
      'list' { [Console]::Out.WriteLine([TapMic.Mics]::List()) }
      'unmute' { [Console]::Out.WriteLine([TapMic.Mics]::Unmute($arg)) }
      'mute' { [Console]::Out.WriteLine([TapMic.Mics]::Mute($arg)) }
      'default' { [Console]::Out.WriteLine([TapMic.Mics]::SetDefault($arg)) }
      'volume' {
        $id, $lvl = $arg -split ' ', 2
        [Console]::Out.WriteLine([TapMic.Mics]::SetVolume($id, [float]::Parse($lvl, [System.Globalization.CultureInfo]::InvariantCulture)))
      }
      default { [Console]::Out.WriteLine('{"ok":false,"error":"unknown command"}') }
    }
  } catch {
    $msg = $_.Exception.Message -replace '\\', '\\\\' -replace '"', '\"' -replace "[\r\n]", ' '
    [Console]::Out.WriteLine("{`"ok`":false,`"error`":`"$msg`"}")
  }
  [Console]::Out.Flush()
}
