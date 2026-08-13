import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import {
  buildDesktopPluginSource,
  desktopPluginPath,
  installDesktopPlugin,
  legacyDesktopPluginReceipt,
  removeVerifiedCreatedBackup,
  WORDMARK_TOKEN,
} from '../lib/desktop-plugin.mjs'
import { fileSha256, sha256 } from '../lib/file-integrity.mjs'
import {
  appendManifest,
  readManifest,
  readStamp,
  stampPath,
  withHomeTransactionLock,
} from '../lib/pack-stamp.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_SOURCE = join(ROOT, 'desktop-plugin', 'classic-gold', 'plugin.js')

function loadUsageMerger(source) {
  const bounded = source.match(/const boundedNumber = \(value, fallback = 0\) => \{[\s\S]*?\n\}/)?.[0]
  const merger = source.match(/function mergeUsageMonotonic\(current = \{\}, incoming = \{\}\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(bounded, 'boundedNumber helper is present')
  assert.ok(merger, 'mergeUsageMonotonic helper is present')
  return Function(`${bounded}\n${merger}\nreturn mergeUsageMonotonic`)()
}

function loadComposerMarker(source) {
  const selector = source.match(/const COMPOSER_MODEL_PATH = ([^\n]+)/)?.[0]
  const marker = source.match(/function syncComposerModelTargets\(scope = document\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(selector, 'composer model path is present')
  assert.ok(marker, 'composer model marker is present')
  return Function(`${selector}\n${marker}\nreturn { COMPOSER_MODEL_PATH, syncComposerModelTargets }`)()
}

function loadTurnSpeed(source) {
  const bounded = source.match(/const boundedNumber = \(value, fallback = 0\) => \{[\s\S]*?\n\}/)?.[0]
  const speed = source.match(/function completedTurnSpeed\(\{ baselineReady, completedAt, outputAtStart, startedAt, usage \}\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(bounded, 'boundedNumber helper is present')
  assert.ok(speed, 'completedTurnSpeed helper is present')
  return Function(`${bounded}\n${speed}\nreturn completedTurnSpeed`)()
}

function loadHideDecision(source) {
  const helper = source.match(/function shouldHideComposerModel\(settings\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(helper, 'composer hide decision is present')
  return Function(`${helper}\nreturn shouldHideComposerModel`)()
}

function temporaryHome() {
  return mkdtempSync(join(tmpdir(), 'classic-gold-plugin-'))
}

test('the runtime plug-in is valid JavaScript and uses public contribution areas', () => {
  const checked = spawnSync(process.execPath, ['--check', PLUGIN_SOURCE], { encoding: 'utf8' })
  assert.equal(checked.status, 0, checked.stderr)

  const source = readFileSync(PLUGIN_SOURCE, 'utf8')
  assert.match(source, /THEMES_AREA/)
  assert.match(source, /STATUSBAR_AREAS/)
  assert.match(source, /PALETTE_AREA/)
  assert.match(source, /ROUTES_AREA/)
  assert.match(source, /Hermes telemetry tape/)
  assert.match(source, /data-classic-gold-caduceus/)
  assert.match(source, /data-classic-gold-session/)
  assert.match(source, /data-classic-gold-composer-model/)
  assert.doesNotMatch(source, /button\[aria-label\^="Model ·"\]/)
  assert.match(source, /host\.request\('config\.get'/)
  assert.match(source, /host\.request\('model\.options'/)
  assert.match(source, /syncBootThemeMirror/)
  assert.match(source, /classicGoldPack: true/)
  assert.match(source, /legacyFileSnapshot/)
  assert.match(source, /event\.session_id !== activeSessionId/)
  assert.match(source, /let refreshing = false/)
  assert.match(source, /if \(refreshing\) return/)
  assert.match(source, /mergeUsageMonotonic\(current\.usage, usage\)/)
  assert.match(source, /if \(event\.type === 'message\.start'\) completionGeneration \+= 1/)
  assert.match(source, /stored_session_id/)
  assert.match(source, /sessionStartedAt/)
  assert.match(source, /data-classic-gold-settings/)
  assert.match(source, /ctx\.storage\.get\(SETTINGS_KEY/)
  assert.match(source, /storage\?\.set\(SETTINGS_KEY/)
  assert.match(source, /Reset to original/)
  assert.match(source, /Caduceus opacity/)
  assert.match(source, /Input and output/)
  assert.match(source, /Customize Classic Gold/)
  assert.match(source, /classic-gold\.telemetry/)
  assert.match(source, /toggleLabel: 'Classic Gold telemetry tape'/)
  assert.match(source, /data-hermes-theme="hermes-classic-gold"\]\[data-classic-gold-wordmark/)
  assert.doesNotMatch(source, /function readComposerModel/)
  assert.match(source, /HERMES-AGENT/)
  assert.match(source, /⣴⣾⣿⣿/)
  assert.match(source, /ctx\.onDispose/)
  assert.doesNotMatch(source, /@\//)
})

test('a stale usage poll cannot reduce completed cumulative token counts', () => {
  const mergeUsageMonotonic = loadUsageMerger(readFileSync(PLUGIN_SOURCE, 'utf8'))
  const afterCompletion = { calls: 4, input: 12_000, output: 2_400, total: 14_400 }
  const stalePoll = { calls: 3, input: 10_000, output: 1_900, total: 11_900 }

  assert.deepEqual(mergeUsageMonotonic(afterCompletion, stalePoll), afterCompletion)
  assert.deepEqual(
    mergeUsageMonotonic(afterCompletion, { calls: 5, input: 13_000, output: 2_800, total: 15_800 }),
    { calls: 5, input: 13_000, output: 2_800, total: 15_800 },
  )
})

test('completed token rate uses a seeded current-turn delta only', () => {
  const speed = loadTurnSpeed(readFileSync(PLUGIN_SOURCE, 'utf8'))
  assert.equal(speed({ baselineReady: false, completedAt: 2_000, outputAtStart: 0, startedAt: 1_000, usage: { output: 900 } }), null)
  assert.equal(speed({ baselineReady: true, completedAt: 2_000, outputAtStart: 900, startedAt: 1_000, usage: { output: 900 } }), null)
  assert.equal(speed({ baselineReady: true, completedAt: 2_000, outputAtStart: 900, startedAt: 1_000, usage: { output: 1_000 } }), 100)
})

test('composer model marking survives repeated settings changes without localized labels', () => {
  const { COMPOSER_MODEL_PATH, syncComposerModelTargets } = loadComposerMarker(
    readFileSync(PLUGIN_SOURCE, 'utf8'),
  )
  const first = { dataset: {} }
  const replacement = { dataset: {} }
  let active = first
  const scope = {
    querySelectorAll(selector) {
      if (selector === COMPOSER_MODEL_PATH) return [active]
      if (selector === '[data-classic-gold-composer-model]') {
        return [first, replacement].filter(button => 'classicGoldComposerModel' in button.dataset)
      }
      return []
    },
  }

  assert.equal(syncComposerModelTargets(scope), 1)
  assert.equal('classicGoldComposerModel' in first.dataset, true)
  first.hidden = false
  first.hidden = true
  assert.equal(syncComposerModelTargets(scope), 1)
  assert.equal('classicGoldComposerModel' in first.dataset, true)

  active = replacement
  assert.equal(syncComposerModelTargets(scope), 1)
  assert.equal('classicGoldComposerModel' in first.dataset, false)
  assert.equal('classicGoldComposerModel' in replacement.dataset, true)

  const shouldHide = loadHideDecision(readFileSync(PLUGIN_SOURCE, 'utf8'))
  const settings = { show: { model: true }, visuals: { hideComposerModel: true } }
  const root = { dataset: {} }
  for (const value of [true, false, true]) {
    settings.visuals.hideComposerModel = value
    root.dataset.classicGoldHideComposerModel = String(shouldHide(settings))
  }
  assert.equal(root.dataset.classicGoldHideComposerModel, 'true')
  assert.equal('classicGoldComposerModel' in replacement.dataset, true)
})

test('buildDesktopPluginSource embeds the original pixel wordmark', () => {
  const built = buildDesktopPluginSource(PLUGIN_SOURCE)

  assert.doesNotMatch(built, new RegExp(WORDMARK_TOKEN))
  assert.match(built, /data:image\/png;base64,/)
  assert.ok(built.length > readFileSync(PLUGIN_SOURCE, 'utf8').length + 10_000)
})

test('installDesktopPlugin writes the plug-in and both tracking records', t => {
  const home = temporaryHome()
  t.after(() => rmSync(home, { recursive: true, force: true }))

  const result = installDesktopPlugin({ home, source: PLUGIN_SOURCE, nowIso: '2026-08-12T00:00:00.000Z', version: '1.2.0' })

  assert.equal(result.path, desktopPluginPath(home))
  assert.equal(result.preExisting, false)
  assert.equal(readFileSync(result.path, 'utf8'), buildDesktopPluginSource(PLUGIN_SOURCE))
  const checked = spawnSync(process.execPath, ['--check', result.path], { encoding: 'utf8' })
  assert.equal(checked.status, 0, checked.stderr)
  assert.equal(readStamp(home).applied.desktopPlugin.via, 'runtime-plugin')
  assert.equal(readStamp(home).version, '1.2.0')
  const entries = readManifest(home).entries
  const receipt = entries.find(entry => entry.type === 'desktop-plugin' && entry.state === 'installed')
  assert.equal(receipt.at, '2026-08-12T00:00:00.000Z')
  assert.equal(receipt.type, 'desktop-plugin')
  assert.equal(receipt.id, 'classic-gold')
  assert.equal(receipt.path, result.path)
  assert.equal(receipt.backup, null)
  assert.equal(receipt.preExisting, false)
  assert.equal(receipt.state, 'installed')
  assert.equal(receipt.installedHash, fileSha256(result.path))
  assert.equal(receipt.temporary, null)
  assert.equal(receipt.transactionId, readStamp(home).applied.desktopPlugin.transactionId)
  assert.ok(receipt.createdDirectories.length > 0)
  assert.equal(receipt.createdDirectories.includes(join(home, 'desktop-plugins')), false)
  assert.equal(existsSync(join(home, 'desktop-plugins')), true)
  assert.equal(entries.at(-1).state, 'committed')
})

test('installDesktopPlugin preserves the first pre-existing file', t => {
  const home = temporaryHome()
  t.after(() => rmSync(home, { recursive: true, force: true }))

  mkdirSync(dirname(desktopPluginPath(home)), { recursive: true })
  writeFileSync(desktopPluginPath(home), 'user original\n')
  const first = installDesktopPlugin({ home, source: PLUGIN_SOURCE, nowIso: '2026-08-12T00:00:00.000Z' })
  const second = installDesktopPlugin({ home, source: PLUGIN_SOURCE, nowIso: '2026-08-12T00:01:00.000Z' })

  assert.equal(first.preExisting, true)
  assert.equal(second.preExisting, true)
  assert.equal(first.backup, second.backup)
  assert.equal(readFileSync(second.backup, 'utf8'), 'user original\n')
})

test('installDesktopPlugin rejects a changed actively managed file', t => {
  const home = temporaryHome()
  t.after(() => rmSync(home, { recursive: true, force: true }))

  const first = installDesktopPlugin({ home, source: PLUGIN_SOURCE })
  const receiptCount = readManifest(home).entries.length
  writeFileSync(first.path, 'user changed the managed file\n')

  assert.throws(
    () => installDesktopPlugin({ home, source: PLUGIN_SOURCE }),
    /changed after this pack wrote it/,
  )
  assert.equal(readFileSync(first.path, 'utf8'), 'user changed the managed file\n')
  assert.equal(readManifest(home).entries.length, receiptCount)
})

test('installDesktopPlugin rejects a changed active original backup', t => {
  const home = temporaryHome()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const target = desktopPluginPath(home)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, 'user original\n')
  const installed = installDesktopPlugin({ home, source: PLUGIN_SOURCE })
  const receiptCount = readManifest(home).entries.length
  writeFileSync(installed.backup, 'changed backup\n')

  assert.throws(
    () => installDesktopPlugin({ home, source: PLUGIN_SOURCE }),
    /backup changed or is missing/,
  )
  assert.equal(readManifest(home).entries.length, receiptCount)
})

test('installDesktopPlugin retries exact active cleanup before reinstall', t => {
  const home = temporaryHome()
  const target = desktopPluginPath(home)
  t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, 'user original\n')

  installDesktopPlugin({ home, source: PLUGIN_SOURCE, version: '1.2.0' })
  const activeStamp = readStamp(home).applied.desktopPlugin
  const entries = readManifest(home).entries
  const planned = entries.find(entry => {
    return entry.type === 'desktop-plugin' && entry.state === 'planned' &&
      entry.transactionId === activeStamp.transactionId
  })
  const receiptCount = entries.length
  const installedHash = fileSha256(target)
  writeFileSync(planned.rollbackBackup, 'changed cleanup artifact\n')

  assert.throws(
    () => installDesktopPlugin({ home, source: PLUGIN_SOURCE, version: '1.2.1' }),
    /active rollback backup hash verification failed/,
  )
  assert.equal(readManifest(home).entries.length, receiptCount)
  assert.equal(readStamp(home).applied.desktopPlugin.transactionId, activeStamp.transactionId)
  assert.equal(fileSha256(target), installedHash)
  assert.equal(readFileSync(planned.rollbackBackup, 'utf8'), 'changed cleanup artifact\n')

  writeFileSync(planned.rollbackBackup, 'user original\n')
  writeFileSync(planned.temporary, readFileSync(target))
  const reinstalled = installDesktopPlugin({ home, source: PLUGIN_SOURCE, version: '1.2.1' })

  assert.equal(reinstalled.path, target)
  assert.notEqual(readStamp(home).applied.desktopPlugin.transactionId, activeStamp.transactionId)
  assert.equal(existsSync(planned.rollbackBackup), false)
  assert.equal(existsSync(planned.temporary), false)
})

test('installDesktopPlugin ignores historical receipts without a current stamp', t => {
  const home = temporaryHome()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const target = desktopPluginPath(home)

  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, 'first user file\n')
  const first = installDesktopPlugin({ home, source: PLUGIN_SOURCE })
  unlinkSync(stampPath(home))
  writeFileSync(target, 'later user file\n')

  const second = installDesktopPlugin({ home, source: PLUGIN_SOURCE })

  assert.notEqual(second.backup, first.backup)
  assert.equal(readFileSync(first.backup, 'utf8'), 'first user file\n')
  assert.equal(readFileSync(second.backup, 'utf8'), 'later user file\n')
})

test('legacy renderer receipts are adopted only with exact Pack ownership proof', t => {
  const home = temporaryHome()
  const target = desktopPluginPath(home)
  t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, 'known Pack 1.2 renderer payload\n')
  const currentHash = fileSha256(target)
  const componentStamp = { path: target, via: 'runtime-plugin' }
  const manifest = {
    entries: [{
      type: 'desktop-plugin',
      id: 'classic-gold',
      path: target,
      backup: null,
      preExisting: false,
    }],
  }
  const adopted = legacyDesktopPluginReceipt({
    componentStamp,
    currentHash,
    manifest,
    target,
    legacyHashes: new Set([currentHash]),
  })

  assert.equal(adopted.installedHash, currentHash)
  assert.equal(adopted.preExisting, false)
  assert.equal(adopted.backup, null)
  assert.equal(legacyDesktopPluginReceipt({
    componentStamp,
    currentHash: 'user-modified',
    manifest,
    target,
    legacyHashes: new Set([currentHash]),
  }), null)
  assert.equal(legacyDesktopPluginReceipt({
    componentStamp,
    currentHash,
    manifest: { entries: [{ ...manifest.entries[0], state: 'installed' }] },
    target,
    legacyHashes: new Set([currentHash]),
  }), null)
})

test('installDesktopPlugin records and cleans a failed new-file transaction', t => {
  const home = temporaryHome()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  assert.throws(() => installDesktopPlugin({ home, source: PLUGIN_SOURCE, version: 1n }))

  const receipts = readManifest(home).entries.filter(entry => entry.type === 'desktop-plugin')
  assert.deepEqual(receipts.map(entry => entry.state), ['planned', 'installed', 'rolled-back'])
  const planned = receipts[0]
  assert.equal(existsSync(planned.path), false)
  assert.equal(existsSync(planned.temporary), false)
  if (planned.rollbackBackup) assert.equal(existsSync(planned.rollbackBackup), false)
  for (const directory of planned.createdDirectories) assert.equal(existsSync(directory), false)
})

test('installDesktopPlugin rolls back its unique backup and keeps unrelated files', t => {
  const home = temporaryHome()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const target = desktopPluginPath(home)
  const unrelatedBackup = `${target}.pre-classic-gold`

  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, 'user original\n')
  writeFileSync(unrelatedBackup, 'unrelated backup\n')
  assert.throws(() => installDesktopPlugin({ home, source: PLUGIN_SOURCE, version: 1n }))

  const planned = readManifest(home).entries.find(entry => {
    return entry.type === 'desktop-plugin' && entry.state === 'planned'
  })
  assert.notEqual(planned.backup, unrelatedBackup)
  assert.equal(readFileSync(target, 'utf8'), 'user original\n')
  assert.equal(readFileSync(unrelatedBackup, 'utf8'), 'unrelated backup\n')
  assert.equal(existsSync(planned.backup), false)
  assert.equal(existsSync(planned.temporary), false)
  assert.equal(existsSync(planned.rollbackBackup), false)
})

test('installDesktopPlugin refuses a concurrent profile transaction', t => {
  const home = temporaryHome()
  const source = join(home, 'concurrent-plugin.js')
  t.after(() => rmSync(home, { recursive: true, force: true }))
  writeFileSync(source, 'export default { id: "concurrent" }\n')

  withHomeTransactionLock(home, () => {
    const modulePath = new URL('../lib/desktop-plugin.mjs', import.meta.url).href
    const childSource = [
      `import { installDesktopPlugin } from ${JSON.stringify(modulePath)}`,
      'try {',
      '  installDesktopPlugin({ home: process.argv[1], source: process.argv[2] })',
      '  process.exit(0)',
      '} catch (error) {',
      '  process.stderr.write(String(error.message))',
      '  process.exit(23)',
      '}',
    ].join('\n')
    const child = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', childSource, home, source],
      { encoding: 'utf8' },
    )

    assert.equal(child.status, 23, child.stderr)
    assert.match(child.stderr, /locked by another command/)
    assert.equal(existsSync(desktopPluginPath(home)), false)
  })

  assert.equal(installDesktopPlugin({ home, source }).path, desktopPluginPath(home))
})

test('installDesktopPlugin recovers an abrupt first install before retry', t => {
  const home = temporaryHome()
  const target = desktopPluginPath(home)
  const contents = buildDesktopPluginSource(PLUGIN_SOURCE)
  const transactionId = 'abrupt-first-install'
  t.after(() => rmSync(home, { recursive: true, force: true }))

  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, contents)
  appendManifest(home, {
    type: 'desktop-plugin',
    id: 'classic-gold',
    path: target,
    backup: null,
    backupCreated: false,
    backupHash: null,
    createdDirectories: [],
    installedHash: sha256(contents),
    preExisting: false,
    previousHash: null,
    rollbackBackup: null,
    state: 'planned',
    temporary: `${target}.classic-gold-next-abrupt`,
    transactionId,
  })

  installDesktopPlugin({ home, source: PLUGIN_SOURCE })

  const states = readManifest(home).entries
    .filter(entry => entry.transactionId === transactionId)
    .map(entry => entry.state)
  assert.deepEqual(states, ['planned', 'rolled-back'])
  assert.equal(fileSha256(target), readStamp(home).applied.desktopPlugin.installedHash)
})

test('installDesktopPlugin restores an abrupt reinstall before retry', t => {
  const home = temporaryHome()
  const target = desktopPluginPath(home)
  const abruptSource = join(home, 'abrupt-plugin.js')
  const transactionId = 'abrupt-reinstall'
  t.after(() => rmSync(home, { recursive: true, force: true }))

  installDesktopPlugin({ home, source: PLUGIN_SOURCE })
  const previousHash = fileSha256(target)
  const rollbackBackup = `${target}.classic-gold-rollback-abrupt`
  const abruptContents = 'export default { id: "abrupt" }\n'
  writeFileSync(abruptSource, abruptContents)
  writeFileSync(rollbackBackup, readFileSync(target))
  writeFileSync(target, abruptContents)
  appendManifest(home, {
    type: 'desktop-plugin',
    id: 'classic-gold',
    path: target,
    backup: null,
    backupCreated: false,
    backupHash: null,
    createdDirectories: [],
    installedHash: sha256(abruptContents),
    preExisting: false,
    previousHash,
    rollbackBackup,
    state: 'planned',
    temporary: `${target}.classic-gold-next-reinstall`,
    transactionId,
  })

  installDesktopPlugin({ home, source: PLUGIN_SOURCE })

  const states = readManifest(home).entries
    .filter(entry => entry.transactionId === transactionId)
    .map(entry => entry.state)
  assert.deepEqual(states, ['planned', 'rolled-back'])
  assert.equal(existsSync(rollbackBackup), false)
  assert.equal(fileSha256(target), readStamp(home).applied.desktopPlugin.installedHash)
})

test('a changed Pack-created original backup is not deleted', t => {
  const home = temporaryHome()
  const backup = join(home, 'plugin.js.pre-classic-gold-test')
  t.after(() => rmSync(home, { recursive: true, force: true }))

  writeFileSync(backup, 'original user file\n')
  const expectedHash = fileSha256(backup)
  writeFileSync(backup, 'changed after the planned receipt\n')

  assert.throws(
    () => removeVerifiedCreatedBackup(backup, expectedHash),
    /original backup hash verification failed/,
  )
  assert.equal(readFileSync(backup, 'utf8'), 'changed after the planned receipt\n')
})
