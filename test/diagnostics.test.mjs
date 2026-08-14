import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { installDesktopPlugin } from '../lib/desktop-plugin.mjs'
import { installPluginBackend } from '../lib/plugin-backend.mjs'
import {
  appendManifest,
  clearApplied,
  manifestPath,
  readManifest,
  readStamp,
  stampPath,
} from '../lib/pack-stamp.mjs'
import {
  buildIssueUrl,
  collectLogs,
  collectManagedState,
  formatDiagnostics,
} from '../scripts/diagnostics.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_SOURCE = join(ROOT, 'desktop-plugin', 'classic-gold', 'plugin.js')
const BACKEND_SOURCE = join(ROOT, 'backend', 'classic-gold')

function runStatus(home) {
  return spawnSync(process.execPath, [join(ROOT, 'scripts', 'diagnostics.mjs'), 'status'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HERMES_HOME: home },
  })
}

const INFO = {
  platform: 'win32',
  arch: 'x64',
  node: 'v24.0.0',
  hermesHome: 'C:/x/hermes',
  agentHead: '4d7f8ade',
  onBase: true,
  baselineId: '0.17.0-4d7f8ad',
  baselineCommit: '4d7f8ade3e586d83003d61be76e909f364040fba',
  matchType: 'commit',
  appVersion: '0.17.0',
  electronExt: 'cjs',
  packStamp: null,
  packVersion: '1.2.0',
  installedPackVersion: '1.2.0',
  managedState: {
    backendPlugin: {
      files: [
        { installed: true, integrity: 'match', manifestState: 'installed', relativePath: join('dashboard', 'manifest.json') },
        { installed: true, integrity: 'match', manifestState: 'installed', relativePath: join('dashboard', 'plugin_api.py') },
        { installed: true, integrity: 'match', manifestState: 'installed', relativePath: join('dashboard', 'dist', 'index.js') },
      ],
      manifestInstalled: true,
      recorded: true,
    },
    config: { disabled: false, enabled: true, exists: true, status: 'ok' },
    installedVersion: '1.2.0',
    manifest: { entries: 9, exists: true, installed: 4, planned: 4, rolledBack: 1 },
    packageVersion: '1.2.0',
    rendererPlugin: { installed: true, integrity: 'match', manifestState: 'installed', recorded: true },
    stamp: { components: ['desktopPlugin', 'pluginBackend'], exists: true },
  },
}

test('formatDiagnostics includes the environment and safe managed state', () => {
  const result = formatDiagnostics(INFO)
  assert.match(result, /win32/)
  assert.match(result, /v24\.0\.0/)
  assert.match(result, /app 0\.17\.0 .* electron cjs/)
  assert.match(result, /baseline: 0\.17\.0-4d7f8ad \(via commit\)/)
  assert.match(result, /Classic Gold pack: package 1\.2\.0 .* installed 1\.2\.0/)
  assert.match(result, /renderer plug-in: installed .* managed .* integrity match/)
  assert.match(result, /telemetry backend: 3\/3 files .* dashboard manifest present .* managed/)
  assert.match(result, /backend file dashboard.*manifest\.json: installed .* integrity match/)
  assert.match(result, /plug-in config: ok .* enabled yes .* disabled no/)
  assert.match(result, /managed manifest: present .* 9 receipts/)
})

test('diagnostics status reports a corrupt stamp without throwing', t => {
  const home = mkdtempSync(join(tmpdir(), 'hcgp-diagnostics-corrupt-stamp-'))
  t.after(() => rmSync(home, { force: true, recursive: true }))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  writeFileSync(stampPath(home), '{not-json')

  const state = collectManagedState(home)

  assert.equal(state.stamp.error, 'invalid state')
  assert.match(formatDiagnostics({ ...INFO, managedState: state }), /managed stamp: invalid state/)
  const status = runStatus(home)
  assert.equal(status.status, 0, status.stderr)
  assert.match(status.stdout, /managed stamp: invalid state/)
})

test('diagnostics status reports a corrupt manifest without throwing', t => {
  const home = mkdtempSync(join(tmpdir(), 'hcgp-diagnostics-corrupt-manifest-'))
  t.after(() => rmSync(home, { force: true, recursive: true }))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  writeFileSync(manifestPath(home), '{not-json')

  const state = collectManagedState(home)

  assert.equal(state.manifest.error, 'invalid state')
  assert.match(formatDiagnostics({ ...INFO, managedState: state }), /managed manifest: invalid state/)
  const status = runStatus(home)
  assert.equal(status.status, 0, status.stderr)
  assert.match(status.stdout, /managed manifest: invalid state/)
})

test('diagnostics status reports structurally invalid state without throwing', t => {
  const home = mkdtempSync(join(tmpdir(), 'hcgp-diagnostics-invalid-state-'))
  t.after(() => rmSync(home, { force: true, recursive: true }))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  writeFileSync(stampPath(home), JSON.stringify({ applied: [] }))
  writeFileSync(manifestPath(home), JSON.stringify({ entries: {} }))

  const state = collectManagedState(home)

  assert.equal(state.stamp.error, 'invalid state')
  assert.equal(state.manifest.error, 'invalid state')
  const status = runStatus(home)
  assert.equal(status.status, 0, status.stderr)
  assert.match(status.stdout, /managed stamp: invalid state/)
  assert.match(status.stdout, /managed manifest: invalid state/)
  assert.match(status.stdout, /repair the Pack state file/)
})

test('collectManagedState reports installed files and does not expose config values', () => {
  const home = mkdtempSync(join(tmpdir(), 'hcgp-managed-'))
  writeFileSync(join(home, 'config.yaml'), 'token: do-not-report\nplugins:\n  enabled: []\n  disabled: []\n')
  installDesktopPlugin({
    home,
    source: PLUGIN_SOURCE,
    nowIso: '2026-08-13T00:00:00.000Z',
    version: '1.2.0',
  })
  installPluginBackend({
    home,
    nowIso: '2026-08-13T00:00:00.000Z',
    sourceRoot: BACKEND_SOURCE,
    version: '1.2.0',
  })

  const state = collectManagedState(home)
  assert.equal(state.packageVersion, '1.2.0')
  assert.equal(state.installedVersion, '1.2.0')
  assert.deepEqual(state.config, { disabled: false, enabled: true, exists: true, status: 'ok' })
  assert.equal(state.rendererPlugin.installed, true)
  assert.equal(state.rendererPlugin.recorded, true)
  assert.equal(state.rendererPlugin.integrity, 'match')
  assert.equal(state.backendPlugin.recorded, true)
  assert.equal(state.backendPlugin.manifestInstalled, true)
  assert.deepEqual(state.backendPlugin.files.map(file => file.integrity), ['match', 'match', 'match'])
  assert.ok(state.manifest.entries >= 8)

  const rendered = formatDiagnostics({ ...INFO, managedState: state })
  assert.doesNotMatch(rendered, /do-not-report/)
  assert.doesNotMatch(JSON.stringify(state), /do-not-report/)
  assert.equal(readFileSync(join(home, 'config.yaml'), 'utf8').includes('do-not-report'), true)
})

test('managed evidence uses the active transaction and notes later rollbacks', () => {
  const home = mkdtempSync(join(tmpdir(), 'hcgp-diagnostics-transaction-'))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  installDesktopPlugin({ home, source: PLUGIN_SOURCE, version: '1.2.0' })
  installPluginBackend({ home, sourceRoot: BACKEND_SOURCE, version: '1.2.0' })
  const active = collectManagedState(home)
  const rendererPath = active.rendererPlugin.path
  const backendPath = join(active.backendPlugin.root, 'dashboard', 'manifest.json')

  appendManifest(home, {
    type: 'desktop-plugin',
    path: rendererPath,
    installedHash: 'not-the-active-hash',
    state: 'rolled-back',
    transactionId: 'renderer-rollback-transaction',
  }, '2026-08-13T01:00:00.000Z')
  appendManifest(home, {
    type: 'plugin-backend-file',
    id: 'classic-gold',
    path: backendPath,
    installedHash: 'not-the-active-hash',
    state: 'rolled-back',
    transactionId: 'backend-rollback-transaction',
  }, '2026-08-13T02:00:00.000Z')

  const afterRollback = collectManagedState(home)
  assert.equal(afterRollback.rendererPlugin.integrity, 'match')
  assert.equal(afterRollback.rendererPlugin.manifestState, 'committed')
  assert.equal(afterRollback.rendererPlugin.latestRolledBack.transactionId, 'renderer-rol')
  assert.equal(afterRollback.backendPlugin.files[0].integrity, 'match')
  assert.equal(afterRollback.backendPlugin.files[0].manifestState, 'installed')
  assert.equal(afterRollback.backendPlugin.latestRolledBack.transactionId, 'backend-roll')

  clearApplied(home, 'desktopPlugin')
  clearApplied(home, 'pluginBackend')
  const afterUninstallStamp = collectManagedState(home)
  assert.equal(afterUninstallStamp.rendererPlugin.recorded, false)
  assert.equal(afterUninstallStamp.rendererPlugin.integrity, 'unrecorded')
  assert.equal(afterUninstallStamp.rendererPlugin.manifestState, null)
  assert.equal(afterUninstallStamp.backendPlugin.recorded, false)
  assert.equal(afterUninstallStamp.backendPlugin.files[0].integrity, 'unrecorded')
  assert.equal(afterUninstallStamp.backendPlugin.files[0].manifestState, null)
  assert.equal(afterUninstallStamp.rendererPlugin.latestRolledBack.transactionId, 'renderer-rol')
})

test('managed evidence supports an active legacy stamp with legacy receipts', () => {
  const home = mkdtempSync(join(tmpdir(), 'hcgp-diagnostics-legacy-'))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  installDesktopPlugin({ home, source: PLUGIN_SOURCE, version: '1.2.0' })
  installPluginBackend({ home, sourceRoot: BACKEND_SOURCE, version: '1.2.0' })

  const stamp = readStamp(home)
  delete stamp.applied.desktopPlugin.transactionId
  delete stamp.applied.pluginBackend.transactionId
  writeFileSync(stampPath(home), JSON.stringify(stamp, null, 2))
  const manifest = readManifest(home)
  for (const entry of manifest.entries) {
    if (!['desktop-plugin', 'plugin-backend-file', 'plugin-backend-config'].includes(entry.type)) continue
    delete entry.transactionId
    delete entry.state
  }
  writeFileSync(manifestPath(home), JSON.stringify(manifest, null, 2))

  const legacy = collectManagedState(home)
  assert.equal(legacy.rendererPlugin.recorded, true)
  assert.equal(legacy.rendererPlugin.integrity, 'match')
  assert.equal(legacy.rendererPlugin.manifestState, null)
  assert.equal(legacy.backendPlugin.recorded, true)
  assert.deepEqual(legacy.backendPlugin.files.map(file => file.integrity), ['match', 'match', 'match'])
  assert.deepEqual(legacy.backendPlugin.files.map(file => file.manifestState), [null, null, null])
})

test('buildIssueUrl encodes title and body and targets the repository', () => {
  const url = buildIssueUrl(INFO, { title: 'status bar failed', error: 'git apply rejected' })
  assert.ok(url.startsWith('https://github.com/Elevatormusic/hermes-classic-gold-pack/issues/new?'))
  assert.match(url, /title=status%20bar%20failed/)
  assert.match(url, /labels=install-failure/)
  assert.match(url, /git%20apply%20rejected/)
})

test('collectLogs tails known log files in priority order and skips empty files', () => {
  const home = mkdtempSync(join(tmpdir(), 'hcgp-logs-'))
  mkdirSync(join(home, 'logs'), { recursive: true })
  const many = Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n')
  writeFileSync(join(home, 'logs', 'errors.log'), many)
  writeFileSync(join(home, 'logs', 'desktop.log'), 'desk-a\ndesk-b')
  writeFileSync(join(home, 'logs', 'gui.log'), '   ')

  const logs = collectLogs(home, { maxLines: 10 })
  assert.deepEqual(logs.map(log => log.name), ['errors.log', 'desktop.log'])
  assert.equal(logs[0].tail.split('\n').length, 10)
  assert.match(logs[0].tail, /line 99/)
  assert.equal(logs[1].tail, 'desk-a\ndesk-b')
})

test('collectLogs returns an empty list when there is no logs directory', () => {
  const home = mkdtempSync(join(tmpdir(), 'hcgp-nolog-'))
  assert.deepEqual(collectLogs(home), [])
})
