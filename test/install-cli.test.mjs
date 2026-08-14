import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { appendManifest, readManifest, readStamp, recordApplied } from '../lib/pack-stamp.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const INSTALL = join(ROOT, 'install.mjs')
const UNINSTALL = join(ROOT, 'scripts', 'uninstall.mjs')

function homeFixture (t) {
  const home = mkdtempSync(join(tmpdir(), 'classic-gold-install-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  return home
}

function run (home, args) {
  return spawnSync(process.execPath, [INSTALL, '--home', home, ...args], { encoding: 'utf8' })
}

function runRaw (args, env = process.env) {
  return spawnSync(process.execPath, [INSTALL, ...args], { encoding: 'utf8', env })
}

test('default dry run plans the renderer, backend, and pets', t => {
  const home = homeFixture(t)
  const result = run(home, ['--dry-run'])

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /Desktop plug-in/)
  assert.match(result.stdout, /Telemetry backend/)
  assert.match(result.stdout, /Pets: install both/)
})

test('remote backend mode skips the renderer and pets', t => {
  const home = homeFixture(t)
  const result = run(home, [
    '--no-desktop-plugin',
    '--plugin-backend',
    '--no-pets',
    '--dry-run'
  ])

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.doesNotMatch(result.stdout, /Desktop plug-in:/)
  assert.match(result.stdout, /Telemetry backend:/)
  assert.doesNotMatch(result.stdout, /Pets: install both/)
})

test('an empty install plan stops without profile writes', t => {
  const home = homeFixture(t)
  const before = readFileSync(join(home, 'config.yaml'), 'utf8')
  const configPath = join(home, 'config.yaml')
  appendManifest(home, {
    type: 'pet-config',
    path: configPath,
    previousHash: '0'.repeat(64),
    installedFileHash: '1'.repeat(64),
    installedHash: '2'.repeat(64),
    rollbackBackup: null,
    rollbackTemporary: null,
    temporary: null,
    state: 'planned',
    transactionId: 'pending-pet-config-empty-plan'
  })
  appendManifest(home, {
    type: 'pet-config-transaction',
    path: configPath,
    state: 'planned',
    transactionId: 'pending-pet-config-empty-plan'
  })
  const manifestBefore = readFileSync(join(home, 'hermes-classic-gold-pack.manifest.json'))
  const result = run(home, [
    '--no-desktop-plugin',
    '--no-plugin-backend',
    '--no-pets'
  ])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /No install component is enabled/)
  assert.equal(readFileSync(join(home, 'config.yaml'), 'utf8'), before)
  assert.deepEqual(readFileSync(join(home, 'hermes-classic-gold-pack.manifest.json')), manifestBefore)
  assert.equal(existsSync(join(home, 'hermes-classic-gold-pack.json')), false)
})

test('--no-pets does not recover a pending pet config transaction', t => {
  const home = homeFixture(t)
  const configPath = join(home, 'config.yaml')
  appendManifest(home, {
    type: 'pet-config',
    path: configPath,
    previousHash: '0'.repeat(64),
    installedFileHash: '1'.repeat(64),
    installedHash: '2'.repeat(64),
    rollbackBackup: null,
    rollbackTemporary: null,
    temporary: null,
    state: 'planned',
    transactionId: 'pending-pet-config-no-pets'
  })
  appendManifest(home, {
    type: 'pet-config-transaction',
    path: configPath,
    state: 'planned',
    transactionId: 'pending-pet-config-no-pets'
  })
  const manifestBefore = readFileSync(join(home, 'hermes-classic-gold-pack.manifest.json'))

  const result = run(home, [
    '--no-desktop-plugin',
    '--plugin-backend',
    '--no-pets',
    '--yes'
  ])

  assert.equal(result.status, 0, result.stderr || result.stdout)
  const entries = JSON.parse(readFileSync(
    join(home, 'hermes-classic-gold-pack.manifest.json'),
    'utf8'
  )).entries
  assert.deepEqual(entries.slice(0, 2), JSON.parse(manifestBefore).entries)
  assert.equal(entries.some(entry => entry.transactionId === 'pending-pet-config-no-pets' && entry.state === 'rolled-back'), false)
})

test('legacy source patches cannot be combined with run-time plug-ins', t => {
  const home = homeFixture(t)
  const result = run(home, ['--advanced', 'statusbar', '--dry-run'])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /legacy source-patch installer is retired/)
})

test('an active legacy source tier blocks the run-time desktop plug-in', t => {
  const home = homeFixture(t)
  recordApplied(home, 'statusbar', { agentHead: 'test-head', via: 'patch' }, { version: 'test' })
  recordApplied(home, 'caduceus', { agentHead: 'test-head', via: 'patch' }, { version: 'test' })
  const stampPath = join(home, 'hermes-classic-gold-pack.json')
  const before = readFileSync(stampPath, 'utf8')

  const result = run(home, ['--dry-run'])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /Legacy source tiers are still active: statusbar, caduceus/)
  assert.match(result.stderr, /scripts[\\/]migrate-to-plugin\.mjs --home/)
  assert.equal(readFileSync(stampPath, 'utf8'), before)
  assert.equal(existsSync(join(home, 'desktop-plugins', 'classic-gold', 'plugin.js')), false)
  assert.equal(existsSync(join(home, 'plugins', 'classic-gold', 'dashboard', 'plugin_api.py')), false)
})

test('pet activation is rejected when pet installation is disabled', t => {
  const home = homeFixture(t)
  const result = run(home, ['--activate', 'noir-neko', '--no-pets', '--dry-run'])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /--activate requires pet installation/)
})

test('an incomplete home option cannot fall back to auto-detection', t => {
  const home = homeFixture(t)
  const result = runRaw(['--home'], { ...process.env, HERMES_HOME: home })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /--home requires a value/)
  assert.equal(existsSync(join(home, 'hermes-classic-gold-pack.json')), false)
})

test('an unknown option stops before any profile write', t => {
  const home = homeFixture(t)
  const result = runRaw(['--no-desktop-plguin'], { ...process.env, HERMES_HOME: home })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /Unsupported or incomplete option/)
  assert.equal(existsSync(join(home, 'hermes-classic-gold-pack.json')), false)
})

test('a fresh renderer and backend install completes its finalization', t => {
  const home = homeFixture(t)
  const target = join(home, 'desktop-plugins', 'classic-gold', 'plugin.js')

  const result = run(home, ['--no-pets'])

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(existsSync(target), true)
  const applied = readStamp(home).applied.desktopPlugin
  const finalization = readManifest(home).entries.filter(entry => (
    entry.type === 'desktop-plugin-finalization' &&
    entry.desktopTransactionId === applied.transactionId
  ))
  assert.deepEqual(finalization.map(entry => entry.state), ['planned', 'committed'])
})

test('a fresh renderer install is removed when backend configuration fails', t => {
  const home = homeFixture(t)
  const target = join(home, 'desktop-plugins', 'classic-gold', 'plugin.js')
  writeFileSync(join(home, 'config.yaml'), 'plugins: []\n')

  const result = run(home, [])

  assert.notEqual(result.status, 0)
  assert.equal(existsSync(target), false)
  assert.equal(readStamp(home)?.applied?.desktopPlugin, undefined)
  const compensation = readManifest(home).entries.filter(entry => (
    entry.type === 'desktop-plugin-compensation'
  ))
  assert.deepEqual(compensation.map(entry => entry.state), ['planned', 'rolled-back'])
  assert.equal(existsSync(compensation[0].temporary), false)
  assert.equal(existsSync(join(home, 'desktop-plugins', 'classic-gold')), false)
})

test('an updated renderer is restored when backend configuration fails', t => {
  const home = homeFixture(t)
  const target = join(home, 'desktop-plugins', 'classic-gold', 'plugin.js')
  const first = run(home, ['--no-plugin-backend', '--no-pets'])
  assert.equal(first.status, 0, first.stderr || first.stdout)
  const previousBytes = readFileSync(target)
  const previousApplied = readStamp(home).applied.desktopPlugin
  writeFileSync(join(home, 'config.yaml'), 'plugins: []\n')

  const result = run(home, [])

  assert.notEqual(result.status, 0)
  assert.deepEqual(readFileSync(target), previousBytes)
  assert.deepEqual(readStamp(home).applied.desktopPlugin, previousApplied)
  const compensation = readManifest(home).entries.filter(entry => (
    entry.type === 'desktop-plugin-compensation'
  ))
  assert.deepEqual(compensation.map(entry => entry.state), ['planned', 'rolled-back'])
  assert.equal(existsSync(compensation[0].rollbackBackup), false)
})

test('a successful renderer and backend update finalizes its rollback backup', t => {
  const home = homeFixture(t)
  const first = run(home, ['--no-plugin-backend', '--no-pets'])
  assert.equal(first.status, 0, first.stderr || first.stdout)

  const result = run(home, ['--no-pets'])

  assert.equal(result.status, 0, result.stderr || result.stdout)
  const applied = readStamp(home).applied.desktopPlugin
  const entries = readManifest(home).entries
  const renderer = entries.find(entry => (
    entry.type === 'desktop-plugin' &&
    entry.transactionId === applied.transactionId &&
    entry.state === 'installed'
  ))
  const finalization = entries.filter(entry => (
    entry.type === 'desktop-plugin-finalization' &&
    entry.desktopTransactionId === applied.transactionId
  ))
  assert.ok(renderer.rollbackBackup)
  assert.equal(existsSync(renderer.rollbackBackup), false)
  assert.deepEqual(finalization.map(entry => entry.state), ['planned', 'committed'])
})

test('reinstall keeps the first pet config state and uninstall restores only that block', t => {
  const home = homeFixture(t)
  const original = [
    'display:',
    '  compact: false',
    '  pet:',
    '    enabled: false',
    '    slug: old-pet',
    'plugins:',
    '  enabled: []',
    '  disabled: []',
    ''
  ].join('\n')
  writeFileSync(join(home, 'config.yaml'), original)

  const first = run(home, [
    '--no-desktop-plugin',
    '--no-plugin-backend',
    '--activate',
    'noir-neko'
  ])
  assert.equal(first.status, 0, first.stderr || first.stdout)

  const withLaterSetting = readFileSync(join(home, 'config.yaml'), 'utf8').replace(
    'plugins:\n',
    'later_setting: keep\nplugins:\n'
  )
  writeFileSync(join(home, 'config.yaml'), withLaterSetting)
  const second = run(home, [
    '--no-desktop-plugin',
    '--no-plugin-backend',
    '--activate',
    'noir-neko-ascii-fine'
  ])
  assert.equal(second.status, 0, second.stderr || second.stdout)

  const removed = spawnSync(process.execPath, [
    UNINSTALL,
    '--home',
    home,
    '--no-build',
    '--yes'
  ], { encoding: 'utf8' })
  assert.equal(removed.status, 0, removed.stderr || removed.stdout)
  const restored = readFileSync(join(home, 'config.yaml'), 'utf8')
  assert.match(restored, /^later_setting: keep$/m)
  assert.match(restored, /^ {4}slug: old-pet$/m)
  assert.match(restored, /^ {4}enabled: false$/m)
  assert.equal(existsSync(join(home, 'pets', 'noir-neko', 'pet.json')), false)
})
