import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { activatePetInConfig, petConfigBlock } from '../lib/config-edit.mjs'
import { sha256 } from '../lib/file-integrity.mjs'
import { installPetConfig, recoverPendingPetConfig } from '../lib/pet-config.mjs'
import { appendManifest, readManifest, readStamp, recordApplied } from '../lib/pack-stamp.mjs'

const VERSION = '1.2.0'
const NO_PET_CONFIG = [
  'version: 1',
  'display:',
  '  theme: noir',
  'logging:',
  '  level: info',
  '',
].join('\n')

function fixture(contents = NO_PET_CONFIG) {
  const root = mkdtempSync(join(tmpdir(), 'hcgp-pet-config-'))
  const home = join(root, 'home')
  const configPath = join(home, 'config.yaml')
  mkdirSync(home)
  writeFileSync(configPath, contents)
  return { configPath, home, root }
}

function hashText(text) {
  return sha256(Buffer.from(text, 'utf8'))
}

function pendingReceipt({
  configPath,
  installedText,
  priorBlock = petConfigBlock(NO_PET_CONFIG),
  priorText = NO_PET_CONFIG,
  transactionId,
}) {
  return {
    type: 'pet-config',
    installedBlock: petConfigBlock(installedText),
    installedFileHash: hashText(installedText),
    installedHash: sha256(petConfigBlock(installedText) || ''),
    path: configPath,
    previousHash: hashText(priorText),
    priorBlock,
    rollbackBackup: `${configPath}.classic-gold-rollback-${transactionId}`,
    rollbackTemporary: `${configPath}.classic-gold-rollback-next-${transactionId}`,
    state: 'planned',
    temporary: `${configPath}.classic-gold-next-${transactionId}`,
    transactionId,
  }
}

function recordInstalledOrphan(home, receipt, priorText, installedText) {
  appendManifest(home, receipt)
  appendManifest(home, {
    type: 'pet-config-transaction',
    path: receipt.path,
    state: 'planned',
    transactionId: receipt.transactionId,
  })
  writeFileSync(receipt.rollbackBackup, priorText)
  writeFileSync(receipt.path, installedText)
  appendManifest(home, { ...receipt, state: 'installed' })
}

test('refuses a linked config before it writes a receipt or external file', t => {
  const root = mkdtempSync(join(tmpdir(), 'hcgp-pet-config-link-'))
  const home = join(root, 'home')
  const outside = join(root, 'outside.yaml')
  const configPath = join(home, 'config.yaml')
  mkdirSync(home)
  writeFileSync(outside, NO_PET_CONFIG)
  t.after(() => rmSync(root, { recursive: true, force: true }))

  try {
    symlinkSync(outside, configPath, 'file')
  } catch (error) {
    t.skip(`This environment cannot create a test link: ${error.code || error.message}`)
    return
  }

  assert.throws(
    () => installPetConfig({ home, configPath, slug: 'noir-neko-gold', version: VERSION }),
    /symbolic link or junction/,
  )
  assert.equal(readFileSync(outside, 'utf8'), NO_PET_CONFIG)
  assert.deepEqual(readManifest(home).entries, [])
  assert.equal(readStamp(home), null)
})

test('recovers an interrupted first install before a new transaction', t => {
  const { configPath, home, root } = fixture()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const installedText = activatePetInConfig(NO_PET_CONFIG, 'noir-neko-gold')
  const transactionId = 'first-install-orphan'
  const receipt = pendingReceipt({ configPath, installedText, transactionId })
  recordInstalledOrphan(home, receipt, NO_PET_CONFIG, installedText)

  const result = installPetConfig({
    home,
    configPath,
    slug: 'noir-neko-gold',
    version: VERSION,
  })

  assert.notEqual(result.receipt.transactionId, transactionId)
  assert.equal(result.receipt.priorBlock, null)
  assert.equal(readFileSync(configPath, 'utf8'), installedText)
  assert.equal(existsSync(receipt.rollbackBackup), false)
  assert.equal(readStamp(home).applied.petConfig.transactionId, result.receipt.transactionId)
  assert.ok(readManifest(home).entries.some(entry => {
    return entry.type === 'pet-config-transaction' && entry.transactionId === transactionId &&
      entry.state === 'committed'
  }))
})

test('reinstall orphan recovery preserves the first prior block', t => {
  const original = [
    'display:',
    '  pet:',
    '    enabled: false',
    '    slug: user-cat',
    '    scale: 2',
    '  theme: noir',
    '',
  ].join('\n')
  const { configPath, home, root } = fixture(original)
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const firstPriorBlock = petConfigBlock(original)
  const first = installPetConfig({
    home,
    configPath,
    slug: 'noir-neko-gold',
    version: VERSION,
  })
  const firstInstalledText = readFileSync(configPath, 'utf8')
  const orphanInstalledText = activatePetInConfig(firstInstalledText, 'noir-neko')
  const transactionId = 'reinstall-orphan'
  const receipt = pendingReceipt({
    configPath,
    installedText: orphanInstalledText,
    priorBlock: first.receipt.priorBlock,
    priorText: firstInstalledText,
    transactionId,
  })
  recordInstalledOrphan(home, receipt, firstInstalledText, orphanInstalledText)

  const result = installPetConfig({
    home,
    configPath,
    slug: 'noir-neko-gold-v2',
    version: VERSION,
  })

  assert.equal(first.receipt.priorBlock, firstPriorBlock)
  assert.equal(result.receipt.priorBlock, firstPriorBlock)
  assert.match(petConfigBlock(readFileSync(configPath, 'utf8')), /slug: noir-neko-gold-v2/)
  assert.equal(readStamp(home).applied.petConfig.transactionId, result.receipt.transactionId)
  assert.ok(readManifest(home).entries.some(entry => {
    return entry.type === 'pet-config-transaction' && entry.transactionId === transactionId &&
      entry.state === 'committed'
  }))
})

test('commits a recorded rollback temporary file during recovery', t => {
  const { configPath, home, root } = fixture()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const installedText = activatePetInConfig(NO_PET_CONFIG, 'noir-neko-gold')
  const transactionId = 'recorded-rollback-temporary'
  const receipt = pendingReceipt({ configPath, installedText, transactionId })
  recordInstalledOrphan(home, receipt, NO_PET_CONFIG, installedText)
  writeFileSync(receipt.rollbackTemporary, NO_PET_CONFIG)

  const result = recoverPendingPetConfig({ home, configPath, version: VERSION })

  assert.deepEqual(result, { status: 'rolled-back', transactionId })
  assert.equal(readFileSync(configPath, 'utf8'), NO_PET_CONFIG)
  assert.equal(existsSync(receipt.rollbackBackup), false)
  assert.equal(existsSync(receipt.rollbackTemporary), false)
  assert.equal(readStamp(home), null)
  assert.ok(readManifest(home).entries.some(entry => {
    return entry.type === 'pet-config-transaction' && entry.transactionId === transactionId &&
      entry.state === 'rolled-back'
  }))
})

test('cleanup failure stays consistent and blocks replacement until exact retry', t => {
  const { configPath, home, root } = fixture()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const installedText = activatePetInConfig(NO_PET_CONFIG, 'noir-neko-gold')
  const transactionId = 'committed-with-cleanup-failure'
  const receipt = pendingReceipt({ configPath, installedText, transactionId })
  appendManifest(home, receipt)
  appendManifest(home, {
    type: 'pet-config-transaction',
    path: configPath,
    state: 'planned',
    transactionId,
  })
  mkdirSync(receipt.rollbackBackup)
  writeFileSync(configPath, installedText)
  appendManifest(home, { ...receipt, state: 'installed' })
  appendManifest(home, {
    type: 'pet-config-transaction',
    path: configPath,
    state: 'ready',
    transactionId,
  })

  const result = recoverPendingPetConfig({ home, configPath, version: VERSION })

  assert.deepEqual(result, { status: 'committed', transactionId })
  assert.equal(readFileSync(configPath, 'utf8'), installedText)
  assert.equal(readStamp(home).applied.petConfig.transactionId, transactionId)
  assert.equal(existsSync(receipt.rollbackBackup), true)
  assert.equal(readManifest(home).entries.at(-1).state, 'committed')
  const entryCount = readManifest(home).entries.length

  assert.throws(
    () => installPetConfig({ home, configPath, slug: 'noir-neko', version: VERSION }),
    /rollback backup changed/,
  )
  assert.equal(readFileSync(configPath, 'utf8'), installedText)
  assert.equal(readStamp(home).applied.petConfig.transactionId, transactionId)
  assert.equal(readManifest(home).entries.length, entryCount)

  rmSync(receipt.rollbackBackup, { recursive: true })
  writeFileSync(receipt.rollbackBackup, NO_PET_CONFIG)
  const replacement = installPetConfig({
    home,
    configPath,
    slug: 'noir-neko',
    version: VERSION,
  })
  assert.equal(existsSync(receipt.rollbackBackup), false)
  assert.match(petConfigBlock(readFileSync(configPath, 'utf8')), /slug: noir-neko/)
  assert.equal(readStamp(home).applied.petConfig.transactionId, replacement.receipt.transactionId)
})

test('refuses an active stamp that does not match its installed receipt', t => {
  const installedText = activatePetInConfig(NO_PET_CONFIG, 'noir-neko-gold')
  const { configPath, home, root } = fixture(installedText)
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const transactionId = 'mismatched-active-receipt'
  const receipt = {
    ...pendingReceipt({ configPath, installedText, transactionId }),
    state: 'installed',
  }
  appendManifest(home, receipt)
  recordApplied(home, 'petConfig', {
    installedHash: sha256('different display.pet block'),
    path: configPath,
    transactionId,
  }, { version: VERSION })
  const entriesBefore = readManifest(home).entries.length

  assert.throws(
    () => installPetConfig({ home, configPath, slug: 'noir-neko', version: VERSION }),
    /active pet config stamp does not match its installed receipt/,
  )
  assert.equal(readFileSync(configPath, 'utf8'), installedText)
  assert.equal(readManifest(home).entries.length, entriesBefore)
  assert.equal(readStamp(home).applied.petConfig.transactionId, transactionId)
})
