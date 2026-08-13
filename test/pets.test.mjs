import { test } from 'node:test'
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

import { sha256 } from '../lib/file-integrity.mjs'
import { appendManifest, readManifest, readStamp } from '../lib/pack-stamp.mjs'
import { installPets } from '../lib/pets.mjs'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hcgp-pets-'))
  const bundled = join(root, 'bundled')
  const home = join(root, 'HERMES')
  const petsDir = join(home, 'pets')
  mkdirSync(join(bundled, 'noir-neko'), { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n')
  writeFileSync(join(bundled, 'noir-neko', 'pet.json'), '{"id":"noir-neko"}')
  writeFileSync(join(bundled, 'noir-neko', 'spritesheet.webp'), 'PNGDATA')
  return { bundled, home, petsDir, root }
}

test('copies pet files with planned and completed ownership receipts', () => {
  const { bundled, home, petsDir } = fixture()
  mkdirSync(join(petsDir, '.thumbs'), { recursive: true })
  writeFileSync(join(petsDir, '.thumbs', 'stale.png'), 'user cache')

  const installed = installPets(bundled, petsDir, { home, version: '1.2.0' })

  assert.deepEqual(installed.slugs, ['noir-neko'])
  assert.equal(readFileSync(join(petsDir, 'noir-neko', 'pet.json'), 'utf8'), '{"id":"noir-neko"}')
  assert.equal(existsSync(join(petsDir, '.thumbs', 'stale.png')), true)
  assert.equal(readStamp(home).applied.pets.transactionId, installed.transactionId)
  const receipts = readManifest(home).entries.filter(entry => entry.type === 'pet-file')
  assert.equal(receipts.filter(entry => entry.state === 'planned').length, 2)
  assert.equal(receipts.filter(entry => entry.state === 'installed').length, 2)
})

test('updates an owned pet but rejects a later user edit', () => {
  const { bundled, home, petsDir } = fixture()
  installPets(bundled, petsDir, { home, version: '1.2.0' })
  writeFileSync(join(bundled, 'noir-neko', 'pet.json'), '{"id":"noir-neko","version":2}')

  installPets(bundled, petsDir, { home, version: '1.2.1' })
  const target = join(petsDir, 'noir-neko', 'pet.json')
  assert.equal(readFileSync(target, 'utf8'), '{"id":"noir-neko","version":2}')

  writeFileSync(target, 'user edit')
  assert.throws(
    () => installPets(bundled, petsDir, { home, version: '1.2.2' }),
    /changed after this pack wrote it/
  )
  assert.equal(readFileSync(target, 'utf8'), 'user edit')
})

test('uses a unique backup for a pre-existing pet file', () => {
  const { bundled, home, petsDir } = fixture()
  const target = join(petsDir, 'noir-neko', 'pet.json')
  mkdirSync(join(petsDir, 'noir-neko'), { recursive: true })
  writeFileSync(target, 'user pet')
  writeFileSync(`${target}.pre-classic-gold`, 'unrelated backup')

  installPets(bundled, petsDir, { home, version: '1.2.0' })

  const receipt = [...readManifest(home).entries].reverse().find(entry => {
    return entry.type === 'pet-file' && entry.path === target && entry.state === 'installed'
  })
  assert.equal(receipt.preExisting, true)
  assert.notEqual(receipt.backup, `${target}.pre-classic-gold`)
  assert.equal(readFileSync(receipt.backup, 'utf8'), 'user pet')
  assert.equal(readFileSync(`${target}.pre-classic-gold`, 'utf8'), 'unrelated backup')
})

test('rejects an active pet stamp with an incomplete receipt set', () => {
  const { bundled, home, petsDir } = fixture()
  const installed = installPets(bundled, petsDir, { home, version: '1.2.0' })
  const stamp = readStamp(home)
  stamp.applied.pets.files.pop()
  writeFileSync(join(home, 'hermes-classic-gold-pack.json'), JSON.stringify(stamp, null, 2))

  assert.throws(
    () => installPets(bundled, petsDir, { home, version: '1.2.1' }),
    /incomplete manifest receipts/,
  )
  assert.equal(readStamp(home).applied.pets.transactionId, installed.transactionId)
})

test('adds new files and retires removed pack files during an upgrade', t => {
  const { bundled, home, petsDir, root } = fixture()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  installPets(bundled, petsDir, { home, version: '1.2.0' })

  unlinkSync(join(bundled, 'noir-neko', 'spritesheet.webp'))
  writeFileSync(join(bundled, 'noir-neko', 'badge.txt'), 'new badge')
  const upgraded = installPets(bundled, petsDir, { home, version: '1.3.0' })

  const removed = join(petsDir, 'noir-neko', 'spritesheet.webp')
  const added = join(petsDir, 'noir-neko', 'badge.txt')
  assert.equal(existsSync(removed), false)
  assert.equal(readFileSync(added, 'utf8'), 'new badge')
  const stamp = readStamp(home).applied.pets
  assert.equal(stamp.transactionId, upgraded.transactionId)
  assert.deepEqual(new Set(stamp.files), new Set([
    join(petsDir, 'noir-neko', 'badge.txt'),
    join(petsDir, 'noir-neko', 'pet.json'),
  ]))
  const activeFiles = readManifest(home).entries.filter(entry => {
    return entry.type === 'pet-file' && entry.state === 'installed' &&
      entry.transactionId === upgraded.transactionId
  })
  assert.equal(activeFiles.length, 2)
  assert.ok(readManifest(home).entries.some(entry => {
    return entry.type === 'pet-file-retirement' && entry.path === removed &&
      entry.state === 'installed' && entry.transactionId === upgraded.transactionId
  }))
})

test('pet reinstall retries exact active retirement cleanup', t => {
  const { bundled, home, petsDir, root } = fixture()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  installPets(bundled, petsDir, { home, version: '1.2.0' })
  const retiredTarget = join(petsDir, 'noir-neko', 'spritesheet.webp')
  unlinkSync(join(bundled, 'noir-neko', 'spritesheet.webp'))
  const upgraded = installPets(bundled, petsDir, { home, version: '1.3.0' })
  const entries = readManifest(home).entries
  const plannedRetirement = entries.find(entry => {
    return entry.type === 'pet-file-retirement' && entry.state === 'planned' &&
      entry.transactionId === upgraded.transactionId && entry.path === retiredTarget
  })
  const receiptCount = entries.length
  writeFileSync(plannedRetirement.rollbackBackup, 'changed cleanup artifact')

  assert.throws(
    () => installPets(bundled, petsDir, { home, version: '1.3.1' }),
    /active rollback backup changed before cleanup/,
  )
  assert.equal(readManifest(home).entries.length, receiptCount)
  assert.equal(readStamp(home).applied.pets.transactionId, upgraded.transactionId)
  assert.equal(existsSync(retiredTarget), false)
  assert.equal(readFileSync(plannedRetirement.rollbackBackup, 'utf8'), 'changed cleanup artifact')

  writeFileSync(plannedRetirement.rollbackBackup, 'PNGDATA')
  writeFileSync(plannedRetirement.temporary, 'PNGDATA')
  const reinstalled = installPets(bundled, petsDir, { home, version: '1.3.1' })

  assert.notEqual(reinstalled.transactionId, upgraded.transactionId)
  assert.equal(existsSync(plannedRetirement.rollbackBackup), false)
  assert.equal(existsSync(plannedRetirement.temporary), false)
  assert.equal(existsSync(retiredTarget), false)
})

test('restores a pre-existing pet file when the bundle retires it', t => {
  const { bundled, home, petsDir, root } = fixture()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const target = join(petsDir, 'noir-neko', 'spritesheet.webp')
  mkdirSync(join(petsDir, 'noir-neko'), { recursive: true })
  writeFileSync(target, 'user sprites')
  installPets(bundled, petsDir, { home, version: '1.2.0' })
  const oldStamp = readStamp(home).applied.pets
  const oldReceipt = readManifest(home).entries.find(entry => {
    return entry.type === 'pet-file' && entry.path === target &&
      entry.state === 'installed' && entry.transactionId === oldStamp.transactionId
  })

  unlinkSync(join(bundled, 'noir-neko', 'spritesheet.webp'))
  installPets(bundled, petsDir, { home, version: '1.3.0' })

  assert.equal(readFileSync(target, 'utf8'), 'user sprites')
  assert.equal(existsSync(oldReceipt.backup), false)
  assert.equal(readStamp(home).applied.pets.files.includes(target), false)
})

test('rolls back a retired pet file when a later upgrade write fails', t => {
  const { bundled, home, petsDir, root } = fixture()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const first = installPets(bundled, petsDir, { home, version: '1.2.0' })
  const retiredTarget = join(petsDir, 'noir-neko', 'spritesheet.webp')

  unlinkSync(join(bundled, 'noir-neko', 'spritesheet.webp'))
  mkdirSync(join(bundled, 'noir-neko', 'blocked'), { recursive: true })
  writeFileSync(join(bundled, 'noir-neko', 'blocked', 'child.txt'), 'next file')
  writeFileSync(join(petsDir, 'noir-neko', 'blocked'), 'user path blocker')

  assert.throws(
    () => installPets(bundled, petsDir, { home, version: '1.3.0' }),
    /EEXIST|ENOTDIR/,
  )

  assert.equal(readFileSync(retiredTarget, 'utf8'), 'PNGDATA')
  assert.equal(readFileSync(join(petsDir, 'noir-neko', 'blocked'), 'utf8'), 'user path blocker')
  assert.equal(readStamp(home).applied.pets.transactionId, first.transactionId)
  const retirementStates = readManifest(home).entries
    .filter(entry => entry.type === 'pet-file-retirement' && entry.path === retiredTarget)
    .map(entry => entry.state)
  assert.deepEqual(retirementStates.slice(-2), ['planned', 'rolled-back'])
})

test('rejects a linked pets directory before it writes a receipt or external file', t => {
  const { bundled, home, petsDir, root } = fixture()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const outside = join(root, 'outside-pets')
  mkdirSync(outside, { recursive: true })
  try {
    symlinkSync(outside, petsDir, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    t.skip(`This environment cannot create a test link: ${error.code || error.message}`)
    return
  }

  assert.throws(
    () => installPets(bundled, petsDir, { home }),
    /symbolic link or junction/,
  )
  assert.equal(existsSync(join(outside, 'noir-neko')), false)
  assert.deepEqual(readManifest(home).entries, [])
})

test('recovers an interrupted first pet install before it starts a new transaction', t => {
  const { bundled, home, petsDir, root } = fixture()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const target = join(petsDir, 'noir-neko', 'pet.json')
  const backup = `${target}.pre-classic-gold-interrupted`
  const rollbackBackup = `${target}.classic-gold-rollback-interrupted`
  const transactionId = 'interrupted-first-pet-install'
  const userContents = 'user pet'
  const packContents = readFileSync(join(bundled, 'noir-neko', 'pet.json'), 'utf8')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, packContents)
  writeFileSync(backup, userContents)
  writeFileSync(rollbackBackup, userContents)
  const receipt = {
    type: 'pet-file',
    slug: 'noir-neko',
    path: target,
    backup,
    backupCreated: true,
    backupHash: sha256(userContents),
    createdDirectories: [],
    installedHash: sha256(packContents),
    preExisting: true,
    previousHash: sha256(userContents),
    rollbackBackup,
    source: join('noir-neko', 'pet.json'),
      temporary: `${target}.classic-gold-next-abrupt`,
    transactionId,
  }
  appendManifest(home, { type: 'pet-transaction', state: 'planned', transactionId })
  appendManifest(home, { ...receipt, state: 'planned' })
  appendManifest(home, { ...receipt, state: 'installed' })

  const installed = installPets(bundled, petsDir, { home, version: '1.3.0' })

  assert.notEqual(installed.transactionId, transactionId)
  assert.equal(existsSync(rollbackBackup), false)
  assert.equal(existsSync(backup), false)
  assert.ok(readManifest(home).entries.some(entry => {
    return entry.type === 'pet-transaction' && entry.transactionId === transactionId &&
      entry.state === 'rolled-back'
  }))
  const activeReceipt = readManifest(home).entries.find(entry => {
    return entry.type === 'pet-file' && entry.path === target && entry.state === 'installed' &&
      entry.transactionId === installed.transactionId
  })
  assert.equal(readFileSync(activeReceipt.backup, 'utf8'), userContents)
  assert.equal(readFileSync(target, 'utf8'), packContents)
})

test('recovers an interrupted pet reinstall and keeps the old active stamp until commit', t => {
  const { bundled, home, petsDir, root } = fixture()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const first = installPets(bundled, petsDir, { home, version: '1.2.0' })
  const target = join(petsDir, 'noir-neko', 'pet.json')
  const oldContents = readFileSync(target, 'utf8')
  const nextContents = '{"id":"noir-neko","version":2}'
  const rollbackBackup = `${target}.classic-gold-rollback-interrupted`
  const transactionId = 'interrupted-pet-reinstall'
  const firstReceipt = readManifest(home).entries.find(entry => {
    return entry.type === 'pet-file' && entry.path === target && entry.state === 'installed' &&
      entry.transactionId === first.transactionId
  })
  writeFileSync(join(bundled, 'noir-neko', 'pet.json'), nextContents)
  writeFileSync(rollbackBackup, oldContents)
  writeFileSync(target, nextContents)
  const receipt = {
    ...firstReceipt,
    backupCreated: false,
    installedHash: sha256(nextContents),
    previousHash: sha256(oldContents),
    rollbackBackup,
    state: 'planned',
      temporary: `${target}.classic-gold-next-abrupt`,
    transactionId,
  }
  appendManifest(home, { type: 'pet-transaction', state: 'planned', transactionId })
  appendManifest(home, receipt)
  appendManifest(home, { ...receipt, state: 'installed' })

  const upgraded = installPets(bundled, petsDir, { home, version: '1.3.0' })

  assert.notEqual(upgraded.transactionId, transactionId)
  assert.notEqual(upgraded.transactionId, first.transactionId)
  assert.equal(readFileSync(target, 'utf8'), nextContents)
  assert.equal(existsSync(rollbackBackup), false)
  assert.ok(readManifest(home).entries.some(entry => {
    return entry.type === 'pet-transaction' && entry.transactionId === transactionId &&
      entry.state === 'rolled-back'
  }))
})

test('interrupted pet recovery fails closed on a later target change', t => {
  const { bundled, home, petsDir, root } = fixture()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const target = join(petsDir, 'noir-neko', 'pet.json')
  const rollbackBackup = `${target}.classic-gold-rollback-interrupted`
  const transactionId = 'changed-interrupted-pet-install'
  const priorContents = 'prior user pet'
  const packContents = readFileSync(join(bundled, 'noir-neko', 'pet.json'), 'utf8')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, 'later user change')
  writeFileSync(rollbackBackup, priorContents)
  appendManifest(home, { type: 'pet-transaction', state: 'planned', transactionId })
  appendManifest(home, {
    type: 'pet-file',
    slug: 'noir-neko',
    path: target,
    backup: null,
    backupCreated: false,
    backupHash: null,
    createdDirectories: [],
    installedHash: sha256(packContents),
    preExisting: true,
    previousHash: sha256(priorContents),
    rollbackBackup,
    source: join('noir-neko', 'pet.json'),
    state: 'installed',
    temporary: null,
    transactionId,
  })
  const receiptCount = readManifest(home).entries.length

  assert.throws(
    () => installPets(bundled, petsDir, { home }),
    /later changes/,
  )
  assert.equal(readFileSync(target, 'utf8'), 'later user change')
  assert.equal(readFileSync(rollbackBackup, 'utf8'), priorContents)
  assert.equal(readManifest(home).entries.length, receiptCount)
})
