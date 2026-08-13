// diagnostics.mjs — environment dump + a prefilled "report install issue" URL.
// Run it when an install fails: paste the output into an issue (or open the URL).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveHermesHome } from '../lib/hermes-home.mjs'
import { classifyState, manifestPath, readManifest, readStamp, stampPath } from '../lib/pack-stamp.mjs'
import { resolveAgentRepo } from '../lib/agent-repo.mjs'
import { selectBaseline } from '../lib/baseline.mjs'
import { desktopPluginPath } from '../lib/desktop-plugin.mjs'
import { fileSha256 } from '../lib/file-integrity.mjs'
import { sameManagedPath } from '../lib/path-safety.mjs'
import {
  PLUGIN_BACKEND_FILES,
  pluginBackendRoot,
  pluginConfigState,
} from '../lib/plugin-backend.mjs'

const REPO = 'Elevatormusic/hermes-classic-gold-pack'
const PACK_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || null
  } catch {
    return null
  }
})()

function latestEntry(entries, predicate) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (predicate(entries[index])) return entries[index]
  }
  return null
}

function activeReceipt(entries, predicate, componentStamp) {
  if (!componentStamp) return null
  const transactionId = componentStamp.transactionId
  const scoped = entries.filter(entry => (
    predicate(entry)
      && entry.state !== 'rolled-back'
      && (transactionId ? entry.transactionId === transactionId : !entry.transactionId)
  ))
  const committed = latestEntry(scoped, entry => entry.state === 'committed')
  return committed || latestEntry(scoped, () => true)
}

function rollbackEvidence(entries, predicate) {
  const receipt = latestEntry(entries, entry => predicate(entry) && entry.state === 'rolled-back')
  if (!receipt) return null
  return {
    at: typeof receipt.at === 'string' ? receipt.at : null,
    transactionId: typeof receipt.transactionId === 'string' ? receipt.transactionId.slice(0, 12) : null,
    type: receipt.type || null,
  }
}

function integrityState(path, receipt) {
  if (!existsSync(path)) return 'missing'
  if (!receipt?.installedHash) return 'unrecorded'
  try {
    return fileSha256(path) === receipt.installedHash ? 'match' : 'changed'
  } catch {
    return 'unreadable'
  }
}

/**
 * Collect safe managed-state evidence without config values or raw receipts.
 * @param {string|null} home HERMES_HOME
 * @returns {object} selected install, receipt, and integrity state
 */
export function collectManagedState(home) {
  if (!home) {
    return {
      backendPlugin: null,
      config: null,
      installedVersion: null,
      manifest: null,
      packageVersion: PACK_VERSION,
      rendererPlugin: null,
      stamp: null,
    }
  }

  let stamp = null
  let stampError = null
  try {
    stamp = readStamp(home)
  } catch (error) {
    stampError = error.message
  }
  const manifestFile = manifestPath(home)
  let manifest = null
  let manifestError = null
  try {
    manifest = readManifest(home)
  } catch (error) {
    manifestError = error.message
  }
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : []
  const rendererPath = desktopPluginPath(home)
  const recordedRendererStamp = stamp?.applied?.desktopPlugin || null
  const rendererStamp = sameManagedPath(recordedRendererStamp?.path, rendererPath) ? recordedRendererStamp : null
  const rendererPredicate = entry => entry.type === 'desktop-plugin' && sameManagedPath(entry.path, rendererPath)
  const rendererReceipt = activeReceipt(
    entries,
    rendererPredicate,
    rendererStamp,
  )
  const backendRoot = pluginBackendRoot(home)
  const recordedBackendStamp = stamp?.applied?.pluginBackend || null
  const backendStamp = (
    recordedBackendStamp?.id === 'classic-gold' && sameManagedPath(recordedBackendStamp?.path, backendRoot)
      ? recordedBackendStamp
      : null
  )
  const backendPredicate = entry => (
    entry.id === 'classic-gold'
      && (entry.type === 'plugin-backend-file' || entry.type === 'plugin-backend-config')
  )
  const backendFiles = PLUGIN_BACKEND_FILES.map(relativePath => {
    const path = join(backendRoot, relativePath)
    const predicate = entry => entry.type === 'plugin-backend-file' && sameManagedPath(entry.path, path)
    const receipt = activeReceipt(
      entries,
      predicate,
      backendStamp,
    )
    return {
      installed: existsSync(path),
      integrity: integrityState(path, receipt),
      latestRolledBack: rollbackEvidence(entries, predicate),
      manifestState: receipt?.state || null,
      relativePath,
    }
  })

  const configPath = join(home, 'config.yaml')
  let config = { disabled: null, enabled: null, exists: existsSync(configPath), status: 'missing' }
  if (config.exists) {
    try {
      const state = pluginConfigState(readFileSync(configPath, 'utf8'))
      config = { ...config, ...state, status: 'ok' }
    } catch {
      config = { ...config, status: 'unsupported' }
    }
  }

  return {
    backendPlugin: {
      files: backendFiles,
      latestRolledBack: rollbackEvidence(entries, backendPredicate),
      manifestInstalled: existsSync(join(backendRoot, 'dashboard', 'manifest.json')),
      recorded: Boolean(backendStamp),
      root: backendRoot,
    },
    config,
    installedVersion: typeof stamp?.version === 'string' ? stamp.version : null,
    manifest: {
      error: manifestError ? 'invalid state' : null,
      entries: entries.length,
      exists: existsSync(manifestFile),
      installed: entries.filter(entry => entry.state === 'installed').length,
      legacy: entries.filter(entry => !entry.state).length,
      planned: entries.filter(entry => entry.state === 'planned').length,
      rolledBack: entries.filter(entry => entry.state === 'rolled-back').length,
    },
    packageVersion: PACK_VERSION,
    rendererPlugin: {
      installed: existsSync(rendererPath),
      integrity: integrityState(rendererPath, rendererReceipt),
      latestRolledBack: rollbackEvidence(entries, rendererPredicate),
      manifestState: rendererReceipt?.state || null,
      path: rendererPath,
      recorded: Boolean(rendererStamp),
    },
    stamp: {
      components: Object.keys(stamp?.applied || {}).sort(),
      error: stampError ? 'invalid state' : null,
      exists: existsSync(stampPath(home)),
      pack: typeof stamp?.pack === 'string' ? stamp.pack : null,
    },
  }
}

function safeBuildStamp(path) {
  if (!existsSync(path)) return null
  try {
    const stamp = JSON.parse(readFileSync(path, 'utf8'))
    return {
      builtAt: typeof stamp.builtAt === 'string' ? stamp.builtAt : null,
      contentHash: typeof stamp.contentHash === 'string' ? stamp.contentHash.slice(0, 12) : null,
      sourceMode: typeof stamp.sourceMode === 'boolean' ? stamp.sourceMode : null,
    }
  } catch {
    return null
  }
}

/** Gather environment facts relevant to an install failure. */
export function collect({ env = process.env, platform = process.platform } = {}) {
  const hermesHome = resolveHermesHome({ env, platform })
  let agentHead = null
  let packStamp = null
  let baseline = null
  let matchType = 'none'
  let appVersion = null
  let electronExt = null
  let desktopPluginInstalled = false
  if (hermesHome) {
    desktopPluginInstalled = existsSync(desktopPluginPath(hermesHome))
    const repo = resolveAgentRepo({ home: hermesHome })
    try {
      const safeRepo = repo.replaceAll('\\', '/')
      agentHead = execFileSync('git', ['-c', `safe.directory=${safeRepo}`, '-C', repo, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'], // hush git's "fatal:" on a non-checkout
      }).trim()
    } catch {
      // no git / not a checkout — leave null
    }
    const sel = selectBaseline({ repo, io: { readHead: () => agentHead } })
    baseline = sel.baseline
    matchType = sel.matchType
    appVersion = sel.appVersion
    electronExt = sel.electronExt
    const stamp = join(hermesHome, 'desktop-build-stamp.json')
    packStamp = safeBuildStamp(stamp)
  }
  const managedState = collectManagedState(hermesHome)
  return {
    platform,
    arch: process.arch,
    node: process.version,
    hermesHome,
    agentHead,
    onBase: Boolean(baseline && agentHead === baseline.commit),
    baselineId: baseline?.id ?? null,
    baselineCommit: baseline?.commit ?? null,
    matchType,
    appVersion,
    electronExt,
    packStamp,
    packVersion: managedState.packageVersion,
    installedPackVersion: managedState.installedVersion,
    desktopPluginInstalled,
    managedState,
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
export function formatDiagnostics(info, { redactPaths = false } = {}) {
  const managed = info.managedState || {}
  const renderer = managed.rendererPlugin
  const backend = managed.backendPlugin
  const config = managed.config
  const manifest = managed.manifest
  const backendInstalled = backend?.files?.filter(file => file.installed).length || 0
  const backendExpected = backend?.files?.length || 0
  const backendFileLines = backend?.files?.map(file => (
    `- backend file ${file.relativePath}: ${file.installed ? 'installed' : 'missing'} · integrity ${file.integrity} · receipt ${file.manifestState || 'legacy state'}`
  )) || []
  const rollbackText = rollback => [
    rollback?.at || '(time not recorded)',
    rollback?.type || null,
    rollback?.transactionId ? `transaction ${rollback.transactionId}` : 'legacy receipt',
  ].filter(Boolean).join(' · ')
  const components = managed.stamp?.components?.join(', ') || '(none)'
  const buildStamp = info.packStamp
    ? [
        info.packStamp.builtAt ? `built ${info.packStamp.builtAt}` : null,
        info.packStamp.contentHash ? `content ${info.packStamp.contentHash}` : null,
        info.packStamp.sourceMode === null ? null : `source mode ${info.packStamp.sourceMode ? 'yes' : 'no'}`,
      ].filter(Boolean).join(' · ')
    : null
  return [
    '### Environment',
    `- OS: ${info.platform} (${info.arch})`,
    `- Node: ${info.node}`,
    `- HERMES_HOME: ${info.hermesHome ? (redactPaths ? '<redacted>' : info.hermesHome) : '(not found)'}`,
    `- hermes-agent HEAD: ${info.agentHead ?? '(unknown)'}`,
    `- installed: app ${info.appVersion ?? '?'} · electron ${info.electronExt ?? '?'}`,
    `- baseline: ${info.baselineId ? `${info.baselineId} (via ${info.matchType})` : 'NONE match → reconcile (ai/repair.md)'}`,
    `- Classic Gold pack: package ${info.packVersion ?? '?'} · installed ${info.installedPackVersion ?? '(not recorded)'}`,
    renderer
      ? `- renderer plug-in: ${renderer.installed ? 'installed' : 'not found'} · ${renderer.recorded ? 'managed' : 'not recorded'} · integrity ${renderer.integrity} · receipt ${renderer.manifestState || 'legacy state'}`
      : '- renderer plug-in: (HERMES_HOME not found)',
    renderer?.latestRolledBack
      ? `- renderer latest rollback: ${rollbackText(renderer.latestRolledBack)}`
      : null,
    backend
      ? `- telemetry backend: ${backendInstalled}/${backendExpected} files · dashboard manifest ${backend.manifestInstalled ? 'present' : 'missing'} · ${backend.recorded ? 'managed' : 'not recorded'}`
      : '- telemetry backend: (HERMES_HOME not found)',
    ...backendFileLines,
    backend?.latestRolledBack
      ? `- telemetry backend latest rollback: ${rollbackText(backend.latestRolledBack)}`
      : null,
    config
      ? `- plug-in config: ${config.status} · enabled ${config.enabled === null ? '?' : config.enabled ? 'yes' : 'no'} · disabled ${config.disabled === null ? '?' : config.disabled ? 'yes' : 'no'}`
      : '- plug-in config: (HERMES_HOME not found)',
    managed.stamp
      ? `- managed stamp: ${managed.stamp.error || (managed.stamp.exists ? 'present' : 'missing')} · components ${components}`
      : '- managed stamp: (HERMES_HOME not found)',
    manifest
      ? `- managed manifest: ${manifest.error || (manifest.exists ? 'present' : 'missing')} · ${manifest.entries} receipts (${manifest.installed} installed, ${manifest.legacy || 0} legacy state, ${manifest.planned} planned, ${manifest.rolledBack} rolled back)`
      : '- managed manifest: (HERMES_HOME not found)',
    buildStamp ? `- Hermes build stamp: ${buildStamp}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

const STATE_ACTION = {
  fresh: 'not installed',
  applied: 'installed ✓',
  reverted: 'legacy stamp remains; migrate to the desktop plug-in before the next update',
  diverged: 'diverged Hermes version → reconcile (see ai/repair.md)',
}

/**
 * Render a per-component install status using the pack stamp + live source
 * sentinels (classifyState). Tells the user what's applied and the next action.
 */
export function formatStatus(info, { base = info.baselineCommit } = {}) {
  const home = info.hermesHome
  const stampError = info.managedState?.stamp?.error
  const manifestError = info.managedState?.manifest?.error
  if (stampError || manifestError) {
    return [
      '### Classic Gold status',
      stampError ? `- managed stamp: ${stampError}` : null,
      manifestError ? `- managed manifest: ${manifestError}` : null,
      '- repair the Pack state file before install, update, or uninstall',
    ].filter(Boolean).join('\n')
  }
  if (!home) return '### Classic Gold status\n- HERMES_HOME: (not found — pass --home or install Hermes)'
  const repo = resolveAgentRepo({ home })
  const state = classifyState({ repo, home, base, agentHead: info.agentHead })
  const stamp = state.stamp
  const lines = [
    '### Classic Gold status',
    `- HERMES_HOME: ${home}`,
    `- desktop plug-in: ${existsSync(desktopPluginPath(home)) ? 'installed ✓' : 'not found → run node install.mjs'}`,
    `- installed: HEAD ${info.agentHead ? info.agentHead.slice(0, 7) : '?'} · app ${info.appVersion ?? '?'} · electron ${info.electronExt ?? '?'}`,
    info.baselineId
      ? `- baseline: ${info.baselineId} (matched via ${info.matchType})`
      : '- baseline: NONE match → reconcile per ai/repair.md',
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
      : '- theme: not recorded — select Classic Hermes in Settings > Appearance'
  )
  return lines.join('\n')
}

/** Build a prefilled GitHub "New Issue" URL. Pure. */
export function buildIssueUrl(info, { title, error } = {}) {
  const body = [
    `**What failed:** ${error ?? '(describe)'}`,
    '',
    formatDiagnostics(info, { redactPaths: true }),
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
    console.log(formatStatus({ ...info, managedState: collectManagedState(info.hermesHome) }))
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
