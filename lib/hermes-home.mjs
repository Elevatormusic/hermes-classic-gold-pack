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

  return findHermesHomes({ env, platform, exists })[0] || null
}

/**
 * ALL candidate directories that contain config.yaml, in priority order.
 * When this returns more than one, the auto-resolved home (index 0) is a GUESS —
 * callers should confirm before writing (a config edit could hit the wrong
 * install). Ignores `explicit` (that path is unambiguous by definition).
 * @returns {string[]}
 */
export function findHermesHomes({ env = process.env, platform = process.platform, exists = existsSync } = {}) {
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
  // De-dupe (HERMES_HOME can equal a default) and keep only those with config.yaml.
  const seen = new Set()
  const found = []
  for (const c of candidates) {
    if (!c || seen.has(c)) continue
    seen.add(c)
    if (exists(join(c, 'config.yaml'))) found.push(c)
  }
  return found
}
