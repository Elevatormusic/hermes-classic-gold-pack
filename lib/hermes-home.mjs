import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/**
 * Resolve HERMES_HOME: the first candidate directory that contains config.yaml.
 * Order: explicit override → $HERMES_HOME → per-OS defaults.
 *
 * @param {object} [opts]
 * @param {string} [opts.explicit]              --home override
 * @param {NodeJS.ProcessEnv} [opts.env]        defaults to process.env
 * @param {NodeJS.Platform} [opts.platform]     defaults to process.platform
 * @param {(p: string) => boolean} [opts.exists] injectable for tests
 * @returns {string|null}
 */
export function resolveHermesHome({
  explicit,
  env = process.env,
  platform = process.platform,
  exists = existsSync,
} = {}) {
  // An explicit --home is authoritative: use it, or fail. Never silently fall
  // back to auto-detection (a typo must not target the user's real install).
  if (explicit) return exists(join(explicit, 'config.yaml')) ? explicit : null

  const home = env.HOME || env.USERPROFILE || homedir()
  const candidates = []
  if (env.HERMES_HOME) candidates.push(env.HERMES_HOME)
  if (platform === 'win32') {
    if (env.LOCALAPPDATA) candidates.push(join(env.LOCALAPPDATA, 'hermes'))
    candidates.push(join(home, '.hermes'))
  } else if (platform === 'darwin') {
    candidates.push(join(home, 'Library', 'Application Support', 'hermes'))
    candidates.push(join(home, '.hermes'))
  } else {
    candidates.push(join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'hermes'))
    candidates.push(join(home, '.hermes'))
  }
  for (const c of candidates) {
    if (c && exists(join(c, 'config.yaml'))) return c
  }
  return null
}
