# Generates test clips for scripts/stt-bench.mts with Windows' built-in English voices (16 kHz mono WAV).
# Run from app/:  powershell -ExecutionPolicy Bypass -File scripts\make-tts-clips.ps1
# Edit $items to use YOUR name. Files starting with "name" must contain the name, "neg" must not.
$out = Join-Path $PSScriptRoot "..\..\demo\recordings\tts"
New-Item -ItemType Directory -Force $out | Out-Null
Add-Type -AssemblyName System.Speech
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$items = @(
  @("name1", "So Thibaud, are you OK with Friday?"),
  @("name2", "Tibo, what do you think about the budget?"),
  @("name3", "Thibault, can you send the slides tonight?"),
  @("name4", "And what about you, Thibaud?"),
  @("name5", "Thibaud, we need your opinion on the design."),
  @("neg1", "Let's talk about the table by the window."),
  @("neg2", "I think Marc should take the test plan."),
  @("neg3", "The ticket is about the timeout bug."),
  @("trouble1", "Hello? Can you hear me? We can't hear you."),
  @("trouble2", "Sorry, you're frozen, we can't see you.")
)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like "en-*" } | ForEach-Object { $_.VoiceInfo.Name }
foreach ($voice in $voices) {
  $tts = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $tts.SelectVoice($voice)
  $v = $voice.Split(" ")[1].ToLower()
  foreach ($it in $items) {
    $tts.SetOutputToWaveFile("$out\$v-$($it[0]).wav", $fmt)
    $tts.Speak($it[1])
  }
  $tts.Dispose()
}
Write-Host "Clips written to $out (voices: $($voices -join ', '))"
