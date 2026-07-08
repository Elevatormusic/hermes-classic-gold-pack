// diagnostics.mjs — environment dump + a prefilled "report install issue" URL.
// Run it when an install fails: paste the output into an issue (or open the URL).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveHermesHome } from '../lib/hermes-home.mjs'

const REPO = 'Elevatormusic/hermes-classic-gold-pack'
const BASE = '830165473e0920c2baf8c2a6863976edb0c52943'

/** Gather environment facts relevant to an install failure. */
export function collect({ env = process.env, platform = process.platform } = {}) {
  const hermesHome = resolveHermesHome({ env, platform })
  let agentHead = null
  let packStamp = null
  if (hermesHome) {
    const repo = join(hermesHome, 'hermes-agent')
    try {
      agentHead = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
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
  }
  return {
    platform,
    arch: process.arch,
    node: process.version,
    hermesHome,
    agentHead,
    onBase: agentHead === BASE,
    packStamp,
  }
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
    info.packStamp ? `- build stamp: ${info.packStamp}` : null,
  ]
    .filter(Boolean)
    .join('\n')
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
  const info = collect()
  console.log(formatDiagnostics(info))
  console.log('\nReport this install issue (review before submitting):')
  console.log(buildIssueUrl(info, { title: 'Install failure', error }))
}
