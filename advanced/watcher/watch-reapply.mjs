#!/usr/bin/env node
// Notify-watcher: if the pack was previously applied but a Hermes update has
// since reverted it to stock, pop a Windows notification telling the user to
// re-apply. READ-ONLY — it never modifies source or rebuilds (a silent rebuild
// would need to kill a running Hermes, which we won't do behind your back).
//
// Run by a Scheduled Task (see register-watcher.ps1) on logon + hourly, or
// manually: `node advanced/watcher/watch-reapply.mjs`.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveHermesHome } from '../../lib/hermes-home.mjs'
import { resolveAgentRepo } from '../../lib/agent-repo.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACK_ROOT = join(HERE, '..', '..')

// Sentinel: the pack's status bar adds the TelemetryTape component. Stock
// Hermes has no such symbol, so its absence means the tier was reverted.
const SENTINEL_FILE = 'apps/desktop/src/app/shell/statusbar-controls.tsx'
const SENTINEL = 'function TelemetryTape'

function packWasApplied() {
  try {
    const home = resolveHermesHome({})
    const stampPath = home && join(home, 'hermes-classic-gold-pack.json')
    if (stampPath && existsSync(stampPath)) {
      const stamp = JSON.parse(readFileSync(stampPath, 'utf8'))
      return Boolean(stamp?.applied && Object.keys(stamp.applied).length)
    }
  } catch {
    /* no stamp */
  }
  return false
}

function tierIsStock(repo) {
  const f = join(repo, SENTINEL_FILE)
  if (!existsSync(f)) return true
  try {
    return !readFileSync(f, 'utf8').includes(SENTINEL)
  } catch {
    return false
  }
}

function notify(text) {
  if (process.platform !== 'win32') {
    console.log(text)
    return
  }
  // msg.exe is present on Windows Pro; fall back to a console line otherwise.
  const r = spawnSync('msg', ['*', '/TIME:0', text], { stdio: 'ignore' })
  if (r.status !== 0) console.log(text)
}

function main() {
  const repo = resolveAgentRepo({})
  if (!existsSync(join(repo, 'apps', 'desktop'))) return 0
  if (!packWasApplied()) return 0 // never installed → nothing to nag about
  if (!tierIsStock(repo)) return 0 // still themed → all good

  // Only nag when the checkout actually moved (a real update), not just any
  // stock state, to avoid false alarms mid-install.
  let head = ''
  try {
    head = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    /* ignore */
  }
  notify(
    `Hermes updated${head ? ` to ${head}` : ''} and reverted the Classic Gold theme. ` +
      `To restore it: fully quit Hermes, then run  node update-hermes.mjs --no-update  ` +
      `in ${PACK_ROOT}. (See ai/brokenupdatefix.md if anything fails.)`
  )
  return 0
}

process.exit(main())
