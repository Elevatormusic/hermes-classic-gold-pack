import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  installPluginBackend,
  legacyBackendReceiptSet,
  PLUGIN_BACKEND_FILES,
  pluginBackendRoot,
  pluginConfigState,
  setPluginConfigState,
} from '../lib/plugin-backend.mjs'
import { fileSha256, sha256 } from '../lib/file-integrity.mjs'
import { appendManifest, readManifest, readStamp, stampPath } from '../lib/pack-stamp.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'backend', 'classic-gold')

function temporaryHome() {
  return mkdtempSync(join(tmpdir(), 'classic-gold-backend-'))
}

function evolvingBundle(t) {
  const root = mkdtempSync(join(tmpdir(), 'classic-gold-backend-evolution-'))
  const home = join(root, 'home')
  const sourceRoot = join(root, 'source')
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { home, root, sourceRoot }
}

function writeBundleFile(sourceRoot, relativePath, contents) {
  const path = join(sourceRoot, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

test('setPluginConfigState preserves unrelated lists, comments, and CRLF', () => {
  const original = [
    'model: example',
    'plugins:',
    '  enabled:',
    '    - disk-cleanup # keep this',
    '  disabled: [classic-gold, another]',
    'gateway:',
    '  port: 8080',
    '',
  ].join('\r\n')

  const installed = setPluginConfigState(original, { disabled: false, enabled: true })
  assert.deepEqual(pluginConfigState(installed), { disabled: false, enabled: true })
  assert.match(installed, /disk-cleanup # keep this/)
  assert.match(installed, /disabled: \[another\]/)
  assert.ok(installed.includes('\r\n'))

  const restored = setPluginConfigState(installed, { disabled: true, enabled: false })
  assert.deepEqual(pluginConfigState(restored), { disabled: true, enabled: false })
  assert.match(restored, /enabled:\r\n    - disk-cleanup # keep this/)
  assert.match(restored, /gateway:\r\n  port: 8080/)
})

test('setPluginConfigState keeps an empty list valid after it removes the last item', () => {
  const restored = setPluginConfigState(
    'plugins:\n  enabled:\n    - classic-gold\n  disabled: []\n',
    { disabled: false, enabled: false },
  )
  assert.match(restored, /enabled: \[\]/)
  assert.deepEqual(pluginConfigState(restored), { disabled: false, enabled: false })
})

test('setPluginConfigState creates a missing plugins block', () => {
  const updated = setPluginConfigState('model: example\n', { disabled: false, enabled: true })
  assert.match(updated, /plugins:\n  enabled:\n    - classic-gold\n$/)
  assert.deepEqual(pluginConfigState(updated), { disabled: false, enabled: true })
})

test('setPluginConfigState preserves four-space plug-in indentation', () => {
  const original = [
    'plugins:',
    '    enabled:',
    '        - existing',
    '    disabled: [classic-gold, keep-disabled]',
    '',
  ].join('\n')

  const updated = setPluginConfigState(original, { disabled: false, enabled: true })

  assert.deepEqual(pluginConfigState(updated), { disabled: false, enabled: true })
  assert.match(updated, /    enabled:\n        - existing\n        - classic-gold/)
  assert.match(updated, /    disabled: \[keep-disabled\]/)
})

test('config helpers reject unsupported or ambiguous YAML shapes', () => {
  const cases = [
    {
      name: 'flow-map plugins',
      text: 'plugins: {enabled: [existing], disabled: [classic-gold]}\n',
    },
    {
      name: 'sequence plugins value',
      text: 'plugins:\n  - classic-gold\n',
    },
    {
      name: 'duplicate plugins',
      text: 'plugins:\n  enabled: []\nplugins:\n  disabled: [classic-gold]\n',
    },
    {
      name: 'duplicate enabled keys',
      text: 'plugins:\n  enabled: []\n  enabled: [classic-gold]\n',
    },
    {
      name: 'duplicate disabled keys',
      text: 'plugins:\n  disabled: []\n  disabled: [classic-gold]\n',
    },
    {
      name: 'ambiguous list indentation',
      text: 'plugins:\n  enabled:\n      - existing\n    - classic-gold\n',
    },
  ]

  for (const sample of cases) {
    assert.throws(
      () => pluginConfigState(sample.text),
      /Cannot safely edit Hermes plug-in config/,
      `${sample.name} must fail during state inspection`,
    )
    assert.throws(
      () => setPluginConfigState(sample.text, { disabled: false, enabled: true }),
      /Cannot safely edit Hermes plug-in config/,
      `${sample.name} must fail before an edit`,
    )
  }
})

test('installPluginBackend leaves an unsupported config unchanged', t => {
  const home = temporaryHome()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const original = 'plugins: {enabled: [existing], disabled: [classic-gold]}\n'
  const configPath = join(home, 'config.yaml')
  writeFileSync(configPath, original)

  assert.throws(
    () => installPluginBackend({ home, sourceRoot: SOURCE }),
    /Cannot safely edit Hermes plug-in config/,
  )
  assert.equal(readFileSync(configPath, 'utf8'), original)
})

test('installPluginBackend copies files, edits config, and records every write', t => {
  const home = temporaryHome()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  writeFileSync(join(home, 'config.yaml'), [
    'plugins:',
    '  enabled:',
    '    - existing',
    '  disabled:',
    '    - classic-gold',
    '    - keep-disabled',
    '',
  ].join('\n'))

  const installed = installPluginBackend({
    home,
    nowIso: '2026-08-12T00:00:00.000Z',
    sourceRoot: SOURCE,
    version: '1.2.0',
  })

  assert.equal(installed.files.length, PLUGIN_BACKEND_FILES.length)
  for (const relativePath of PLUGIN_BACKEND_FILES) {
    const target = join(pluginBackendRoot(home), relativePath)
    assert.equal(readFileSync(target, 'utf8'), readFileSync(join(SOURCE, relativePath), 'utf8'))
  }
  const config = readFileSync(join(home, 'config.yaml'), 'utf8')
  assert.deepEqual(pluginConfigState(config), { disabled: false, enabled: true })
  assert.match(config, /keep-disabled/)
  assert.equal(readStamp(home).applied.pluginBackend.via, 'dashboard-api')
  assert.equal(readStamp(home).version, '1.2.0')
  const entries = readManifest(home).entries
  const installedFiles = entries.filter(entry => entry.type === 'plugin-backend-file' && entry.state === 'installed')
  const componentStamp = readStamp(home).applied.pluginBackend
  assert.equal(installedFiles.length, 3)
  assert.ok(installedFiles.every(entry => entry.installedHash && entry.temporary === null))
  assert.ok(installedFiles.every(entry => entry.transactionId === componentStamp.transactionId))
  const installedConfig = entries.find(entry => entry.type === 'plugin-backend-config' && entry.state === 'installed')
  assert.equal(installedConfig.transactionId, componentStamp.transactionId)
  assert.deepEqual(installedConfig.prior, {
    disabled: true,
    enabled: false,
  })
})

test('reinstall keeps the first config state and first pre-existing backend file', t => {
  const home = temporaryHome()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const target = join(pluginBackendRoot(home), PLUGIN_BACKEND_FILES[0])
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, 'user manifest\n')
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled:\n    - classic-gold\n')

  installPluginBackend({ home, sourceRoot: SOURCE })
  installPluginBackend({ home, sourceRoot: SOURCE })

  const entries = readManifest(home).entries
  const configReceipts = entries.filter(entry => entry.type === 'plugin-backend-config')
  const fileReceipts = entries.filter(entry => entry.type === 'plugin-backend-file' && entry.path === target)
  assert.deepEqual(configReceipts.at(-1).prior, { disabled: true, enabled: false })
  assert.equal(fileReceipts.at(-1).preExisting, true)
  assert.equal(readFileSync(fileReceipts.at(-1).backup, 'utf8'), 'user manifest\n')
})

test('installPluginBackend rejects a changed actively managed file', t => {
  const home = temporaryHome()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n')
  const installed = installPluginBackend({ home, sourceRoot: SOURCE })
  const target = installed.files[0]
  const receiptCount = readManifest(home).entries.length
  writeFileSync(target, 'user changed the managed file\n')

  assert.throws(
    () => installPluginBackend({ home, sourceRoot: SOURCE }),
    /changed after this pack wrote it/,
  )
  assert.equal(readFileSync(target, 'utf8'), 'user changed the managed file\n')
  assert.equal(readManifest(home).entries.length, receiptCount)
})

test('legacy backend adoption requires exact live ownership proof', t => {
  const home = temporaryHome()
  const root = pluginBackendRoot(home)
  const configPath = join(home, 'config.yaml')
  const original = 'plugins:\n  enabled: [classic-gold]\n  disabled: []\n'
  t.after(() => rmSync(home, { recursive: true, force: true }))
  writeFileSync(configPath, original)
  const files = PLUGIN_BACKEND_FILES.map((item, index) => {
    const path = join(root, item)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `known ${index}\n`)
    return path
  })
  const hashes = new Map(PLUGIN_BACKEND_FILES.map((item, index) => [item, fileSha256(files[index])]))
  const stamp = { configPath, files, id: 'classic-gold', path: root, via: 'dashboard-api' }
  const entries = [
    ...files.map(path => ({ backup: null, id: 'classic-gold', path, preExisting: false, type: 'plugin-backend-file' })),
    { id: 'classic-gold', path: configPath, prior: { disabled: false, enabled: false }, type: 'plugin-backend-config' },
  ]
  const options = { componentStamp: stamp, configPath, entries, legacyHashes: hashes, original, targetRoot: root }
  assert.equal(legacyBackendReceiptSet(options).files.size, 3)
  writeFileSync(files[0], 'later user file\n')
  assert.equal(legacyBackendReceiptSet(options), null)
  writeFileSync(files[0], 'known 0\n')
  assert.equal(legacyBackendReceiptSet({
    ...options, entries: [...entries.slice(0, -1), { ...entries.at(-1), prior: { disabled: true, enabled: false } }],
  }), null)
  assert.equal(legacyBackendReceiptSet({
    ...options, entries: [entries[0], entries[0], entries[2], entries.at(-1)],
  }), null)
  assert.equal(legacyBackendReceiptSet({
    ...options, entries: [...entries, { ...entries.at(-1) }],
  }), null)
  assert.equal(legacyBackendReceiptSet({
    ...options, entries: [...entries.slice(0, -1), { ...entries.at(-1), installedHash: 'not-a-legacy-receipt' }],
  }), null)
  assert.equal(legacyBackendReceiptSet({
    ...options, componentStamp: { ...stamp, configPath: join(home, 'other-config.yaml') },
  }), null)
  assert.equal(readFileSync(configPath, 'utf8'), original)
})

test('installPluginBackend ignores historical receipts without a current stamp', t => {
  const home = temporaryHome()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const target = join(pluginBackendRoot(home), PLUGIN_BACKEND_FILES[0])
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, 'first user file\n')

  installPluginBackend({ home, sourceRoot: SOURCE })
  const firstStamp = readStamp(home).applied.pluginBackend
  const firstReceipt = readManifest(home).entries.find(entry => {
    return entry.type === 'plugin-backend-file' &&
      entry.path === target &&
      entry.state === 'installed' &&
      entry.transactionId === firstStamp.transactionId
  })
  unlinkSync(stampPath(home))
  writeFileSync(target, 'later user file\n')

  installPluginBackend({ home, sourceRoot: SOURCE })
  const secondStamp = readStamp(home).applied.pluginBackend
  const secondReceipt = [...readManifest(home).entries].reverse().find(entry => {
    return entry.type === 'plugin-backend-file' &&
      entry.path === target &&
      entry.state === 'installed' &&
      entry.transactionId === secondStamp.transactionId
  })

  assert.notEqual(secondReceipt.backup, firstReceipt.backup)
  assert.equal(readFileSync(firstReceipt.backup, 'utf8'), 'first user file\n')
  assert.equal(readFileSync(secondReceipt.backup, 'utf8'), 'later user file\n')
  const secondConfigReceipt = [...readManifest(home).entries].reverse().find(entry => {
    return entry.type === 'plugin-backend-config' &&
      entry.state === 'installed' &&
      entry.transactionId === secondStamp.transactionId
  })
  assert.deepEqual(secondConfigReceipt.prior, { disabled: false, enabled: true })
})

test('installPluginBackend rejects changed active membership but keeps unrelated config edits', t => {
  const home = temporaryHome()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const configPath = join(home, 'config.yaml')
  writeFileSync(configPath, 'plugins:\n  enabled: []\n')
  installPluginBackend({ home, sourceRoot: SOURCE })

  const withUnrelatedEdit = `${readFileSync(configPath, 'utf8')}gateway:\n  port: 8080\n`
  writeFileSync(configPath, withUnrelatedEdit)
  installPluginBackend({ home, sourceRoot: SOURCE })
  assert.equal(readFileSync(configPath, 'utf8'), withUnrelatedEdit)

  const changedMembership = setPluginConfigState(withUnrelatedEdit, {
    disabled: true,
    enabled: false,
  })
  writeFileSync(configPath, changedMembership)
  const receiptCount = readManifest(home).entries.length
  assert.throws(
    () => installPluginBackend({ home, sourceRoot: SOURCE }),
    /membership changed after this pack wrote it/,
  )
  assert.equal(readFileSync(configPath, 'utf8'), changedMembership)
  assert.equal(readManifest(home).entries.length, receiptCount)
})

test('installPluginBackend records and cleans a failed new-file transaction', t => {
  const home = temporaryHome()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const originalConfig = 'plugins:\n  enabled: []\n  disabled: [classic-gold]\n'
  writeFileSync(join(home, 'config.yaml'), originalConfig)
  assert.throws(() => installPluginBackend({ home, sourceRoot: SOURCE, version: 1n }))

  assert.equal(readFileSync(join(home, 'config.yaml'), 'utf8'), originalConfig)
  assert.equal(existsSync(pluginBackendRoot(home)), false)
  const entries = readManifest(home).entries
  const fileEntries = entries.filter(entry => entry.type === 'plugin-backend-file')
  const configEntries = entries.filter(entry => entry.type === 'plugin-backend-config')
  assert.equal(fileEntries.filter(entry => entry.state === 'planned').length, 3)
  assert.equal(fileEntries.filter(entry => entry.state === 'installed').length, 3)
  assert.equal(fileEntries.filter(entry => entry.state === 'rolled-back').length, 3)
  assert.deepEqual(configEntries.map(entry => entry.state), ['planned', 'installed', 'rolled-back'])
  for (const entry of fileEntries) {
    if (entry.temporary) assert.equal(existsSync(entry.temporary), false)
    if (entry.rollbackBackup) assert.equal(existsSync(entry.rollbackBackup), false)
    if (entry.backupCreated && entry.backup) assert.equal(existsSync(entry.backup), false)
  }
  for (const directory of fileEntries.flatMap(entry => entry.createdDirectories)) {
    assert.equal(existsSync(directory), false)
  }
  assert.equal(existsSync(configEntries[0].rollbackBackup), false)
})

test('installPluginBackend rolls back unique backups and keeps unrelated files', t => {
  const home = temporaryHome()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const target = join(pluginBackendRoot(home), PLUGIN_BACKEND_FILES[0])
  const unrelatedBackup = `${target}.pre-classic-gold`
  const originalConfig = 'plugins:\n  enabled: []\n  disabled: [classic-gold]\n'

  writeFileSync(join(home, 'config.yaml'), originalConfig)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, 'user backend file\n')
  writeFileSync(unrelatedBackup, 'unrelated backup\n')
  assert.throws(() => installPluginBackend({ home, sourceRoot: SOURCE, version: 1n }))

  const planned = readManifest(home).entries.find(entry => {
    return entry.type === 'plugin-backend-file' && entry.path === target && entry.state === 'planned'
  })
  assert.notEqual(planned.backup, unrelatedBackup)
  assert.equal(readFileSync(target, 'utf8'), 'user backend file\n')
  assert.equal(readFileSync(unrelatedBackup, 'utf8'), 'unrelated backup\n')
  assert.equal(readFileSync(join(home, 'config.yaml'), 'utf8'), originalConfig)
  assert.equal(existsSync(planned.backup), false)
  assert.equal(existsSync(planned.temporary), false)
  assert.equal(existsSync(planned.rollbackBackup), false)
})

test('adds, updates, and retires backend files against the old stamped inventory', t => {
  const { home, sourceRoot } = evolvingBundle(t)
  const kept = join('dashboard', 'kept.txt')
  const retired = join('dashboard', 'retired.txt')
  const added = join('dashboard', 'added.txt')
  writeBundleFile(sourceRoot, kept, 'kept v1')
  writeBundleFile(sourceRoot, retired, 'retired pack file')
  installPluginBackend({ home, sourceRoot, files: [kept, retired], version: '1.2.0' })

  writeBundleFile(sourceRoot, kept, 'kept v2')
  writeBundleFile(sourceRoot, added, 'added v1')
  const upgraded = installPluginBackend({
    home,
    sourceRoot,
    files: [added, kept],
    version: '1.3.0',
  })

  const targetRoot = pluginBackendRoot(home)
  assert.equal(readFileSync(join(targetRoot, kept), 'utf8'), 'kept v2')
  assert.equal(readFileSync(join(targetRoot, added), 'utf8'), 'added v1')
  assert.equal(existsSync(join(targetRoot, retired)), false)
  const stamp = readStamp(home).applied.pluginBackend
  assert.deepEqual(new Set(stamp.files), new Set(upgraded.files))
  assert.deepEqual(new Set(upgraded.files), new Set([
    join(targetRoot, added),
    join(targetRoot, kept),
  ]))
  const activeReceipts = readManifest(home).entries.filter(entry => {
    return entry.type === 'plugin-backend-file' && entry.state === 'installed' &&
      entry.transactionId === stamp.transactionId
  })
  assert.equal(activeReceipts.length, 2)
  assert.ok(readManifest(home).entries.some(entry => {
    return entry.type === 'plugin-backend-file-retirement' &&
      entry.path === join(targetRoot, retired) && entry.state === 'installed' &&
      entry.transactionId === stamp.transactionId
  }))
})

test('reinstall cleans exact active file and retirement artifacts before replacement', t => {
  const { home, sourceRoot } = evolvingBundle(t)
  const kept = join('dashboard', 'kept.txt')
  const retired = join('retired-backend', 'retired.txt')
  const replacement = join('retired-backend', 'replacement.txt')
  writeBundleFile(sourceRoot, kept, 'kept v1')
  writeBundleFile(sourceRoot, retired, 'retired v1')
  installPluginBackend({ home, sourceRoot, files: [kept, retired], version: '1.2.0' })
  installPluginBackend({ home, sourceRoot, files: [kept], version: '1.3.0' })

  const activeStamp = readStamp(home).applied.pluginBackend
  const activeEntries = readManifest(home).entries
  const activeFile = activeEntries.find(entry => {
    return entry.type === 'plugin-backend-file' && entry.state === 'installed' &&
      entry.transactionId === activeStamp.transactionId && entry.path.endsWith(kept)
  })
  const activeRetirement = activeEntries.find(entry => {
    return entry.type === 'plugin-backend-file-retirement' && entry.state === 'installed' &&
      entry.transactionId === activeStamp.transactionId && entry.path.endsWith(retired)
  })
  assert.ok(activeFile?.rollbackBackup)
  assert.ok(activeRetirement?.rollbackBackup)

  writeFileSync(activeFile.rollbackBackup, 'kept v1')
  mkdirSync(dirname(activeRetirement.rollbackBackup), { recursive: true })
  writeFileSync(activeRetirement.rollbackBackup, 'changed retirement cleanup artifact')
  writeBundleFile(sourceRoot, replacement, 'replacement v1')
  const manifestBeforeFailure = readManifest(home).entries
  const stampBeforeFailure = readStamp(home)
  const configBeforeFailure = readFileSync(join(home, 'config.yaml'), 'utf8')
  const keptBeforeFailure = readFileSync(activeFile.path, 'utf8')

  assert.throws(
    () => installPluginBackend({ home, sourceRoot, files: [kept, replacement], version: '1.4.0' }),
    /cleanup artifact changed/,
  )
  assert.deepEqual(readManifest(home).entries, manifestBeforeFailure)
  assert.deepEqual(readStamp(home), stampBeforeFailure)
  assert.equal(readFileSync(join(home, 'config.yaml'), 'utf8'), configBeforeFailure)
  assert.equal(readFileSync(activeFile.path, 'utf8'), keptBeforeFailure)
  assert.equal(existsSync(activeFile.rollbackBackup), true)
  assert.equal(readFileSync(activeRetirement.rollbackBackup, 'utf8'), 'changed retirement cleanup artifact')
  assert.equal(existsSync(join(pluginBackendRoot(home), replacement)), false)

  writeFileSync(activeRetirement.rollbackBackup, 'retired v1')
  installPluginBackend({ home, sourceRoot, files: [kept, replacement], version: '1.4.0' })

  assert.equal(existsSync(activeFile.rollbackBackup), false)
  assert.equal(existsSync(activeRetirement.rollbackBackup), false)
  const replacementStamp = readStamp(home).applied.pluginBackend
  assert.notEqual(replacementStamp.transactionId, activeStamp.transactionId)
  const replacementReceipt = readManifest(home).entries.find(entry => {
    return entry.type === 'plugin-backend-file' && entry.state === 'installed' &&
      entry.transactionId === replacementStamp.transactionId && entry.path.endsWith(replacement)
  })
  assert.ok(replacementReceipt.createdDirectories.includes(dirname(replacementReceipt.path)))
})

test('validates the old backend stamp before it accepts a new inventory', t => {
  const { home, sourceRoot } = evolvingBundle(t)
  const firstFile = join('dashboard', 'first.txt')
  const retiredFile = join('dashboard', 'retired.txt')
  const nextFile = join('dashboard', 'next.txt')
  writeBundleFile(sourceRoot, firstFile, 'first')
  writeBundleFile(sourceRoot, retiredFile, 'retired')
  installPluginBackend({ home, sourceRoot, files: [firstFile, retiredFile] })

  const stamp = readStamp(home)
  stamp.applied.pluginBackend.files.pop()
  writeFileSync(stampPath(home), JSON.stringify(stamp, null, 2))
  writeBundleFile(sourceRoot, nextFile, 'next')

  assert.throws(
    () => installPluginBackend({ home, sourceRoot, files: [firstFile, nextFile] }),
    /complete manifest receipts/,
  )
  assert.equal(existsSync(join(pluginBackendRoot(home), nextFile)), false)
  assert.equal(readFileSync(join(pluginBackendRoot(home), retiredFile), 'utf8'), 'retired')
})

test('backs up a new bundle path that already belongs to the user', t => {
  const { home, sourceRoot } = evolvingBundle(t)
  const kept = join('dashboard', 'kept.txt')
  const added = join('dashboard', 'added.txt')
  writeBundleFile(sourceRoot, kept, 'kept')
  installPluginBackend({ home, sourceRoot, files: [kept] })

  const target = join(pluginBackendRoot(home), added)
  writeFileSync(target, 'user file')
  writeBundleFile(sourceRoot, added, 'pack file')
  installPluginBackend({ home, sourceRoot, files: [kept, added] })

  const stamp = readStamp(home).applied.pluginBackend
  const receipt = readManifest(home).entries.find(entry => {
    return entry.type === 'plugin-backend-file' && entry.path === target &&
      entry.state === 'installed' && entry.transactionId === stamp.transactionId
  })
  assert.equal(receipt.preExisting, true)
  assert.equal(readFileSync(receipt.backup, 'utf8'), 'user file')
  assert.equal(readFileSync(target, 'utf8'), 'pack file')
})

test('restores a pre-existing backend file when the next bundle retires it', t => {
  const { home, sourceRoot } = evolvingBundle(t)
  const kept = join('dashboard', 'kept.txt')
  const retired = join('dashboard', 'retired.txt')
  writeBundleFile(sourceRoot, kept, 'kept')
  writeBundleFile(sourceRoot, retired, 'pack file')
  const target = join(pluginBackendRoot(home), retired)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, 'user file')
  installPluginBackend({ home, sourceRoot, files: [kept, retired] })
  const oldStamp = readStamp(home).applied.pluginBackend
  const oldReceipt = readManifest(home).entries.find(entry => {
    return entry.type === 'plugin-backend-file' && entry.path === target &&
      entry.state === 'installed' && entry.transactionId === oldStamp.transactionId
  })

  installPluginBackend({ home, sourceRoot, files: [kept] })

  assert.equal(readFileSync(target, 'utf8'), 'user file')
  assert.equal(existsSync(oldReceipt.backup), false)
  assert.equal(readStamp(home).applied.pluginBackend.files.includes(target), false)
})

test('rolls back a retired backend file when a later upgrade write fails', t => {
  const { home, sourceRoot } = evolvingBundle(t)
  const kept = join('dashboard', 'kept.txt')
  const retired = join('dashboard', 'retired.txt')
  const blocked = join('dashboard', 'blocked', 'child.txt')
  writeBundleFile(sourceRoot, kept, 'kept')
  writeBundleFile(sourceRoot, retired, 'old pack file')
  const first = installPluginBackend({ home, sourceRoot, files: [kept, retired] })
  writeBundleFile(sourceRoot, blocked, 'new child')
  writeFileSync(join(pluginBackendRoot(home), 'dashboard', 'blocked'), 'user blocker')

  assert.throws(
    () => installPluginBackend({ home, sourceRoot, files: [blocked, kept] }),
    /EEXIST|ENOTDIR/,
  )

  const retiredTarget = join(pluginBackendRoot(home), retired)
  assert.equal(readFileSync(retiredTarget, 'utf8'), 'old pack file')
  assert.equal(readFileSync(join(pluginBackendRoot(home), 'dashboard', 'blocked'), 'utf8'), 'user blocker')
  assert.deepEqual(readStamp(home).applied.pluginBackend.files, first.files)
  const retirementStates = readManifest(home).entries
    .filter(entry => entry.type === 'plugin-backend-file-retirement' && entry.path === retiredTarget)
    .map(entry => entry.state)
  assert.deepEqual(retirementStates.slice(-2), ['planned', 'rolled-back'])
})

test('rejects a linked backend ancestor before it writes a receipt or external file', t => {
  const { home, root, sourceRoot } = evolvingBundle(t)
  const relativePath = join('dashboard', 'plugin.py')
  writeBundleFile(sourceRoot, relativePath, 'plugin')
  const outside = join(root, 'outside-plugins')
  mkdirSync(outside, { recursive: true })
  try {
    symlinkSync(outside, join(home, 'plugins'), process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    t.skip(`This environment cannot create a test link: ${error.code || error.message}`)
    return
  }

  assert.throws(
    () => installPluginBackend({ home, sourceRoot, files: [relativePath] }),
    /symbolic link or junction/,
  )
  assert.equal(existsSync(join(outside, 'classic-gold')), false)
  assert.deepEqual(readManifest(home).entries, [])
})

test('recovers an interrupted first backend install before it starts a new transaction', t => {
  const { home, sourceRoot } = evolvingBundle(t)
  const relativePath = join('dashboard', 'plugin.py')
  const contents = 'pack plugin v1'
  const transactionId = 'interrupted-first-backend-install'
  writeBundleFile(sourceRoot, relativePath, contents)
  const target = join(pluginBackendRoot(home), relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, contents)
  const originalConfig = readFileSync(join(home, 'config.yaml'), 'utf8')
  const installedConfig = setPluginConfigState(originalConfig, { disabled: false, enabled: true })
  const configRollback = join(home, 'config.yaml.classic-gold-rollback-interrupted')
  const configTemporary = join(home, 'config.yaml.classic-gold-next-interrupted')
  writeFileSync(configRollback, originalConfig)
  writeFileSync(join(home, 'config.yaml'), installedConfig)
  const fileReceipt = {
    type: 'plugin-backend-file',
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
    source: relativePath,
    temporary: null,
    transactionId,
  }
  const configReceipt = {
    type: 'plugin-backend-config',
    id: 'classic-gold',
    path: join(home, 'config.yaml'),
    installedHash: sha256(installedConfig),
    installedState: { disabled: false, enabled: true },
    previousHash: sha256(originalConfig),
    prior: { disabled: false, enabled: false },
    rollbackBackup: configRollback,
    temporary: configTemporary,
    transactionId,
  }
  appendManifest(home, { type: 'plugin-backend-transaction', state: 'planned', transactionId })
  appendManifest(home, { ...fileReceipt, state: 'planned' })
  appendManifest(home, { ...configReceipt, state: 'planned' })
  appendManifest(home, { ...fileReceipt, state: 'installed' })
  appendManifest(home, { ...configReceipt, state: 'installed', temporary: null })

  installPluginBackend({ home, sourceRoot, files: [relativePath], version: '1.3.0' })

  const active = readStamp(home).applied.pluginBackend
  assert.notEqual(active.transactionId, transactionId)
  assert.equal(readFileSync(target, 'utf8'), contents)
  assert.equal(existsSync(configRollback), false)
  assert.equal(existsSync(configTemporary), false)
  assert.deepEqual(pluginConfigState(readFileSync(join(home, 'config.yaml'), 'utf8')), {
    disabled: false,
    enabled: true,
  })
  assert.ok(readManifest(home).entries.some(entry => {
    return entry.type === 'plugin-backend-transaction' &&
      entry.transactionId === transactionId && entry.state === 'rolled-back'
  }))
})

test('recovers an interrupted backend reinstall and preserves the old active stamp', t => {
  const { home, sourceRoot } = evolvingBundle(t)
  const relativePath = join('dashboard', 'plugin.py')
  const oldContents = 'pack plugin v1'
  const nextContents = 'pack plugin v2'
  writeBundleFile(sourceRoot, relativePath, oldContents)
  installPluginBackend({ home, sourceRoot, files: [relativePath], version: '1.2.0' })
  const firstStamp = readStamp(home).applied.pluginBackend
  const target = join(pluginBackendRoot(home), relativePath)
  const firstReceipt = readManifest(home).entries.find(entry => {
    return entry.type === 'plugin-backend-file' && entry.path === target &&
      entry.state === 'installed' && entry.transactionId === firstStamp.transactionId
  })
  const transactionId = 'interrupted-backend-reinstall'
  const rollbackBackup = `${target}.classic-gold-rollback-interrupted`
  const temporary = `${target}.classic-gold-next-interrupted`
  writeBundleFile(sourceRoot, relativePath, nextContents)
  writeFileSync(rollbackBackup, oldContents)
  writeFileSync(target, nextContents)
  const config = readFileSync(join(home, 'config.yaml'), 'utf8')
  const configReceipt = {
    type: 'plugin-backend-config',
    id: 'classic-gold',
    path: join(home, 'config.yaml'),
    installedHash: sha256(config),
    installedState: { disabled: false, enabled: true },
    previousHash: sha256(config),
    prior: { disabled: false, enabled: false },
    rollbackBackup: null,
    transactionId,
  }
  const fileReceipt = {
    ...firstReceipt,
    backupCreated: false,
    installedHash: sha256(nextContents),
    previousHash: sha256(oldContents),
    rollbackBackup,
    state: 'planned',
    temporary,
    transactionId,
  }
  appendManifest(home, { type: 'plugin-backend-transaction', state: 'planned', transactionId })
  appendManifest(home, fileReceipt)
  appendManifest(home, { ...configReceipt, state: 'planned' })
  appendManifest(home, { ...fileReceipt, state: 'installed', temporary: null })
  appendManifest(home, { ...configReceipt, state: 'installed' })

  installPluginBackend({ home, sourceRoot, files: [relativePath], version: '1.3.0' })

  const active = readStamp(home).applied.pluginBackend
  assert.notEqual(active.transactionId, transactionId)
  assert.notEqual(active.transactionId, firstStamp.transactionId)
  assert.equal(readFileSync(target, 'utf8'), nextContents)
  assert.equal(existsSync(rollbackBackup), false)
  assert.equal(existsSync(temporary), false)
  assert.ok(readManifest(home).entries.some(entry => {
    return entry.type === 'plugin-backend-transaction' &&
      entry.transactionId === transactionId && entry.state === 'rolled-back'
  }))
})

test('interrupted backend recovery fails closed on a later target change', t => {
  const { home, sourceRoot } = evolvingBundle(t)
  const relativePath = join('dashboard', 'plugin.py')
  const target = join(pluginBackendRoot(home), relativePath)
  const rollbackBackup = `${target}.classic-gold-rollback-interrupted`
  const temporary = `${target}.classic-gold-next-interrupted`
  const transactionId = 'changed-interrupted-backend-install'
  const priorContents = 'prior user plugin'
  const packContents = 'pack plugin'
  writeBundleFile(sourceRoot, relativePath, packContents)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, 'later user change')
  writeFileSync(rollbackBackup, priorContents)
  appendManifest(home, {
    type: 'plugin-backend-transaction',
    state: 'planned',
    transactionId,
  })
  appendManifest(home, {
    type: 'plugin-backend-file',
    id: 'classic-gold',
    path: target,
    backup: null,
    backupCreated: false,
    backupHash: null,
    createdDirectories: [],
    installedHash: sha256(packContents),
    preExisting: true,
    previousHash: sha256(priorContents),
    rollbackBackup,
    source: relativePath,
    state: 'installed',
    temporary,
    transactionId,
  })
  const receiptCount = readManifest(home).entries.length

  assert.throws(
    () => installPluginBackend({ home, sourceRoot, files: [relativePath] }),
    /later changes/,
  )
  assert.equal(readFileSync(target, 'utf8'), 'later user change')
  assert.equal(readFileSync(rollbackBackup, 'utf8'), priorContents)
  assert.equal(existsSync(temporary), false)
  assert.equal(readManifest(home).entries.length, receiptCount)
})

test('interrupted backend recovery rejects a changed recorded temporary file before restore', t => {
  const { home, sourceRoot } = evolvingBundle(t)
  const relativePath = join('dashboard', 'plugin.py')
  const target = join(pluginBackendRoot(home), relativePath)
  const rollbackBackup = `${target}.classic-gold-rollback-interrupted`
  const temporary = `${target}.classic-gold-next-interrupted`
  const transactionId = 'changed-interrupted-backend-temporary'
  const priorContents = 'prior user plugin'
  const packContents = 'pack plugin'
  writeBundleFile(sourceRoot, relativePath, packContents)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, packContents)
  writeFileSync(rollbackBackup, priorContents)
  writeFileSync(temporary, 'later temporary change')
  const receipt = {
    type: 'plugin-backend-file',
    id: 'classic-gold',
    path: target,
    backup: null,
    backupCreated: false,
    backupHash: null,
    createdDirectories: [],
    installedHash: sha256(packContents),
    preExisting: true,
    previousHash: sha256(priorContents),
    rollbackBackup,
    source: relativePath,
    state: 'planned',
    temporary,
    transactionId,
  }
  appendManifest(home, { type: 'plugin-backend-transaction', state: 'planned', transactionId })
  appendManifest(home, receipt)
  appendManifest(home, { ...receipt, state: 'installed', temporary: null })
  const receiptCount = readManifest(home).entries.length

  assert.throws(
    () => installPluginBackend({ home, sourceRoot, files: [relativePath] }),
    /temporary file changed/,
  )
  assert.equal(readFileSync(target, 'utf8'), packContents)
  assert.equal(readFileSync(rollbackBackup, 'utf8'), priorContents)
  assert.equal(readFileSync(temporary, 'utf8'), 'later temporary change')
  assert.equal(readManifest(home).entries.length, receiptCount)
})

test('interrupted backend recovery rejects a recorded temporary path outside the target directory', t => {
  const { home, sourceRoot } = evolvingBundle(t)
  const relativePath = join('dashboard', 'plugin.py')
  const target = join(pluginBackendRoot(home), relativePath)
  const rollbackBackup = `${target}.classic-gold-rollback-interrupted`
  const temporary = join(home, 'unrelated.classic-gold-next-interrupted')
  const transactionId = 'nonsibling-interrupted-backend-temporary'
  const priorContents = 'prior user plugin'
  const packContents = 'pack plugin'
  writeBundleFile(sourceRoot, relativePath, packContents)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, packContents)
  writeFileSync(rollbackBackup, priorContents)
  const receipt = {
    type: 'plugin-backend-file',
    id: 'classic-gold',
    path: target,
    backup: null,
    backupCreated: false,
    backupHash: null,
    createdDirectories: [],
    installedHash: sha256(packContents),
    preExisting: true,
    previousHash: sha256(priorContents),
    rollbackBackup,
    source: relativePath,
    state: 'planned',
    temporary,
    transactionId,
  }
  appendManifest(home, { type: 'plugin-backend-transaction', state: 'planned', transactionId })
  appendManifest(home, receipt)

  assert.throws(
    () => installPluginBackend({ home, sourceRoot, files: [relativePath] }),
    /temporary path is not an owned target sibling/,
  )
  assert.equal(readFileSync(target, 'utf8'), packContents)
  assert.equal(readFileSync(rollbackBackup, 'utf8'), priorContents)
  assert.equal(existsSync(temporary), false)
})

test('recovers an interrupted backend retirement through its recorded temporary path', t => {
  const { home, sourceRoot } = evolvingBundle(t)
  const relativePath = join('dashboard', 'plugin.py')
  const contents = 'pack plugin'
  writeBundleFile(sourceRoot, relativePath, contents)
  installPluginBackend({ home, sourceRoot, files: [relativePath] })
  const active = readStamp(home).applied.pluginBackend
  const target = join(pluginBackendRoot(home), relativePath)
  const transactionId = 'interrupted-backend-retirement'
  const rollbackBackup = `${target}.classic-gold-rollback-interrupted`
  const temporary = `${target}.classic-gold-next-interrupted`
  writeFileSync(rollbackBackup, contents)
  unlinkSync(target)
  const receipt = {
    type: 'plugin-backend-file-retirement',
    id: 'classic-gold',
    path: target,
    backup: null,
    backupHash: null,
    createdDirectories: [],
    preExisting: false,
    previousHash: sha256(contents),
    restoredHash: null,
    rollbackBackup,
    temporary,
    sourceTransactionId: active.transactionId,
    state: 'planned',
    transactionId,
  }
  appendManifest(home, { type: 'plugin-backend-transaction', state: 'planned', transactionId })
  appendManifest(home, receipt)
  appendManifest(home, { ...receipt, state: 'installed', temporary: null })

  installPluginBackend({ home, sourceRoot, files: [relativePath], version: '1.3.0' })

  assert.equal(readFileSync(target, 'utf8'), contents)
  assert.equal(existsSync(rollbackBackup), false)
  assert.equal(existsSync(temporary), false)
  assert.ok(readManifest(home).entries.some(entry => {
    return entry.type === 'plugin-backend-file-retirement' &&
      entry.transactionId === transactionId && entry.state === 'rolled-back' &&
      entry.temporary === temporary
  }))
})
