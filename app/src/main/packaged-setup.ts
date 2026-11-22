/**
 * OWNER: B. Installed app (electron-builder): runs before every other module (first import in index.ts).
 * The code finds models/, scripts/win-mic.ps1 and .env relative to the working folder (process.cwd()), which is
 * app/ in dev. Installed, that folder is wherever Windows started the exe, so we point it at the app's resources
 * folder, where the installer puts models/, scripts/ and extension/.
 * API keys are never in the installer (the repo is public): the user puts them in %APPDATA%\Tap\.env.
 * Without keys Tap still works: local Parakeet speech, template summaries.
 */
import { app } from 'electron'
import { config } from 'dotenv'
import { join } from 'node:path'

if (app.isPackaged) {
  process.chdir(process.resourcesPath)
  config({ path: join(app.getPath('userData'), '.env'), quiet: true })
  // dev sets TAP_STT in app/.env; installed default = Deepgram if a key is set, else local Parakeet
  process.env.TAP_STT ??= 'deepgram'
}
