/**
 * OWNER: B. Installed app (electron-builder): runs before every other module (first import in index.ts).
 * The code finds models/, scripts/win-mic.ps1 and .env relative to the working folder (process.cwd()), which is
 * app/ in dev. Installed, that folder is wherever Windows started the exe, so we point it at the app's resources
 * folder, where the installer puts scripts/ and extension/ (and models/, only if someone adds them by hand).
 * API keys are never in the installer (the repo is public): the user puts them in %APPDATA%\Tap\.env.
 * The installer ships no local speech model: without DEEPGRAM_API_KEY there are no captions (index.ts says so).
 */
import { app } from 'electron'
import { config } from 'dotenv'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// First run: a settings file to fill in (tray → "Open settings file"). No secrets in it.
const TEMPLATE = `# Tap settings. Fill in, save, then quit Tap (tray icon → Quit) and start it again.

# Speech-to-text (Deepgram). Needed for live captions, name detection, alerts and meeting summaries.
DEEPGRAM_API_KEY=
TAP_STT=deepgram

# Your first name, then nicknames or common misspellings, comma-separated. Tap alerts you when one is said.
TAP_USER_NAMES=

# Optional: AI recaps and summaries (Anthropic). Without it, Tap builds them from the transcript itself.
ANTHROPIC_API_KEY=
# TAP_LLM_MODEL=claude-haiku-5-5

# Optional: your role (intern, senior, executive, ceo). Executive and CEO meetings never use the cloud AI.
TAP_USER_ROLE=intern

# Optional: Logitech MX Master haptics through the HapticWeb plugin (Logi Options+).
# TAP_HAPTIC_URL=https://local.jmw.nz:41443
`

if (app.isPackaged) {
  process.chdir(process.resourcesPath)
  const file = join(app.getPath('userData'), '.env')
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, TEMPLATE)
  }
  config({ path: file, quiet: true })
  process.env.TAP_CONFIG_FILE = file // the tray and the checkup point to it
  // dev sets TAP_STT in app/.env; installed default = Deepgram (falls back to local models only if added by hand)
  process.env.TAP_STT ||= 'deepgram'
}
