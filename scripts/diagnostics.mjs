// diagnostics.mjs — environment dump + a prefilled "report install issue" URL.
// Run it when an install fails: paste the output into an issue (or open the URL).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveHermesHome } from '../lib/hermes-home.mjs'
import { classifyState } from '../lib/pack-stamp.mjs'
import { resolveAgentRepo } from '../lib/agent-repo.mjs'

const REPO = 'Elevatormusic/hermes-classic-gold-pack'
const BASE = '4d7f8ade3e586d83003d61be76e909f364040fba'

/** Gather environment facts relevant to an install failure. */
export function collect({ env = process.env, platform = process.platform } = {}) {
  const hermesHome = resolveHermesHome({ env, platform })
  let agentHead = null
  let packStamp = null
  let packApplied = null
  if (hermesHome) {
    const repo = resolveAgentRepo({ home: hermesHome })
    try {
      agentHead = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'], // hush git's "fatal:" on a non-checkout
      }).trim()
    } catch {
      // no git / not a checkout — leave null
    }
    const stamp = join(hermesHome, 'desktop-build-stamp.json')
    if (existsSync(stamp)) {
      try {
        packStamp = readFileSync(stamp, 'utf8').trim().replace(/\s+/g, ' ')
      } catch {
        // unreadable — leave null
      }
    }
    // This pack's own stamp (written by the advanced apply scripts) — tells us
    // which pieces of the pack were applied, distinct from Hermes' build stamp.
    const packFile = join(hermesHome, 'hermes-classic-gold-pack.json')
    if (existsSync(packFile)) {
      try {
        packApplied = readFileSync(packFile, 'utf8').trim().replace(/\s+/g, ' ')
      } catch {
        // unreadable — leave null
      }
    }
  }
  return {
    platform,
    arch: process.arch,
    node: process.version,
    hermesHome,
    agentHead,
    onBase: agentHead === BASE,
    packStamp,
    packApplied,
  }
}

// Hermes log files worth reading on a failure, most-diagnostic first.
const LOG_PRIORITY = ['errors.log', 'desktop.log', 'agent.log', 'gateway.log', 'gui.log']

/**
 * Collect the tail of Hermes' relevant log files for self-diagnosis.
 * @param {string} home  HERMES_HOME
 * @param {{maxLines?: number}} [opts]
 * @returns {{name: string, path: string, tail: string}[]}
 */
export function collectLogs(home, { maxLines = 40 } = {}) {
  if (!home) return []
  const dir = join(home, 'logs')
  if (!existsSync(dir)) return []
  const out = []
  for (const name of LOG_PRIORITY) {
    const p = join(dir, name)
    if (!existsSync(p)) continue
    let tail = ''
    try {
      const lines = readFileSync(p, 'utf8').split(/\r?\n/)
      tail = lines.slice(-maxLines).join('\n').trim()
    } catch {
      continue
    }
    if (tail) out.push({ name, path: p, tail })
  }
  return out
}

/** Render collected logs for the console. Pure. */
export function formatLogs(logs) {
  if (!logs.length) return '(no Hermes logs found)'
  return logs.map((l) => `── ${l.name} (${l.path}) ──\n${l.tail}`).join('\n\n')
}

/** Render diagnostics as a Markdown block. Pure. */
export function formatDiagnostics(info) {
  return [
    '### Environment',
    `- OS: ${info.platform} (${info.arch})`,
    `- Node: ${info.node}`,
    `- HERMES_HOME: ${info.hermesHome ?? '(not found)'}`,
    `- hermes-agent HEAD: ${info.agentHead ?? '(unknown)'}`,
    `- on base ${BASE.slice(0, 7)}: ${info.onBase ? 'yes' : 'no'}`,
    info.packApplied ? `- pack applied: ${info.packApplied}` : '- pack applied: (core only — no advanced tier stamp)',
    info.packStamp ? `- hermes build stamp: ${info.packStamp}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

const STATE_ACTION = {
  fresh: 'not installed',
  applied: 'installed ✓',
  reverted: 'REVERTED by a Hermes update → re-apply (node update-hermes.mjs --no-update)',
  diverged: 'diverged Hermes version → reconcile (see ai/repair.md)',
}

/**
 * Render a per-component install status using the pack stamp + live source
 * sentinels (classifyState). Tells the user what's applied and the next action.
 */
export function formatStatus(info, { base = BASE } = {}) {
  const home = info.hermesHome
  if (!home) return '### Classic Gold status\n- HERMES_HOME: (not found — pass --home or install Hermes)'
  const repo = resolveAgentRepo({ home })
  const state = classifyState({ repo, home, base, agentHead: info.agentHead })
  const stamp = state.stamp
  const lines = [
    '### Classic Gold status',
    `- HERMES_HOME: ${home}`,
    `- on base ${base.slice(0, 7)}: ${state.onBase ? 'yes' : `no (HEAD ${info.agentHead ? info.agentHead.slice(0, 7) : '?'})`}`,
  ]
  for (const [tier, st] of Object.entries(state.tiers)) {
    const via = stamp?.applied?.[tier]?.via
    lines.push(`- ${tier}: ${st}${via ? ` (via ${via})` : ''} — ${STATE_ACTION[st]}`)
  }
  const pets = stamp?.applied?.pets
  lines.push(
    pets
      ? `- pets: installed [${(pets.slugs || []).join(', ')}]${pets.activated ? `, active: ${pets.activated}` : ''}`
      : '- pets: not recorded'
  )
  const theme = stamp?.applied?.theme
  lines.push(
    theme
      ? `- theme: applied (${theme.value})`
      : '- theme: unknown (localStorage-only — run node theme/apply-theme.mjs to (re)apply)'
  )
  return lines.join('\n')
}

/** Build a prefilled GitHub "New Issue" URL. Pure. */
export function buildIssueUrl(info, { title, error } = {}) {
  const body = [
    `**What failed:** ${error ?? '(describe)'}`,
    '',
    formatDiagnostics(info),
    '',
    '**Steps / notes:**',
    '(add anything else here)',
  ].join('\n')
  const q = new URLSearchParams({ title: title ?? 'Install failure', body, labels: 'install-failure' })
  // URLSearchParams renders spaces as "+"; normalize to %20 for readability.
  return `https://github.com/${REPO}/issues/new?` + q.toString().replace(/\+/g, '%20')
}

// CLI entry (only when run directly, not when imported by tests)
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const errIdx = process.argv.indexOf('--error')
  const error = errIdx !== -1 ? process.argv[errIdx + 1] : undefined
  const wantLogs = process.argv.includes('--logs')
  const info = collect()

  // `status` — per-component install state + recommended next action.
  if (process.argv.includes('status')) {
    console.log(formatStatus(info))
    process.exit(0)
  }

  console.log(formatDiagnostics(info))
  if (wantLogs) {
    console.log('\n### Recent Hermes logs  (review before sharing — may contain prompts/paths)')
    console.log(formatLogs(collectLogs(info.hermesHome)))
  }
  console.log('\nReport this install issue (review before submitting):')
  console.log(buildIssueUrl(info, { title: 'Install failure', error }))
  if (!wantLogs) console.log('(add --logs to also print recent Hermes log tails for diagnosis)')
}
