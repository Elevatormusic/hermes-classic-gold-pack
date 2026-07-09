// One resolver for the hermes-agent checkout, so every script agrees on which
// tree it's touching (diagnostics was reporting a checkout the apply scripts
// never modified). Order: explicit --repo → $HERMES_AGENT_REPO → HERMES_HOME/
// hermes-agent → LOCALAPPDATA/hermes/hermes-agent. Issue #3 §7.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveHermesHome } from './hermes-home.mjs'

function isCheckout(dir, exists) {
  return Boolean(dir) && exists(join(dir, 'apps', 'desktop'))
}

/**
 * @param {object} [opts]
 * @param {string} [opts.explicit]  --repo override
 * @param {string} [opts.home]      known HERMES_HOME (else auto-resolved)
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {NodeJS.Platform} [opts.platform]
 * @param {(p:string)=>boolean} [opts.exists]  injectable for tests
 * @returns {string} the resolved repo path (may not exist — caller checks)
 */
export function resolveAgentRepo({ explicit, home, env = process.env, platform = process.platform, exists = existsSync } = {}) {
  if (explicit) return explicit
  if (env.HERMES_AGENT_REPO) return env.HERMES_AGENT_REPO

  const candidates = []
  const h = home || resolveHermesHome({ env, platform, exists })
  if (h) candidates.push(join(h, 'hermes-agent'))
  if (env.LOCALAPPDATA) candidates.push(join(env.LOCALAPPDATA, 'hermes', 'hermes-agent'))

  for (const c of candidates) if (isCheckout(c, exists)) return c
  // Nothing looks like a checkout — return the best guess (HERMES_HOME wins) so
  // the caller can print a useful "not a checkout" error against a real path.
  return candidates[0] || join(env.LOCALAPPDATA || '', 'hermes', 'hermes-agent')
}

/** The packaged Hermes.exe inside a checkout's build output (Windows). */
export function hermesExePath(repo) {
  return join(repo, 'apps', 'desktop', 'release', 'win-unpacked', 'Hermes.exe')
}
