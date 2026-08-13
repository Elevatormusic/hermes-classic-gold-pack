import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

import { activatePetInConfig, petConfigBlock } from './config-edit.mjs'
import { commitVerifiedTemporary, fileSha256, sha256, uniqueSiblingPath, writeTextAtomically } from './file-integrity.mjs'
import {
  appendManifest,
  readManifest,
  readStamp,
  recordApplied,
  withHomeTransactionLock,
} from './pack-stamp.mjs'
import { assertSafeManagedPath } from './path-safety.mjs'

const TRANSACTION_TYPE = 'pet-config-transaction'

function pathKey(path) {
  const value = resolve(path)
  return process.platform === 'win32' ? value.toLowerCase() : value
}

function samePath(left, right) {
  return Boolean(left && right && pathKey(left) === pathKey(right))
}

function validSibling(path, target, label) {
  if (!path) return true
  return samePath(dirname(path), dirname(target)) && basename(path).startsWith(`${basename(target)}.${label}-`)
}

function latestTransactionStates(entries) {
  const states = new Map()
  for (const entry of entries) {
    if (entry.type === TRANSACTION_TYPE && entry.transactionId) states.set(entry.transactionId, entry)
  }
  return [...states.values()]
}

function latestReceipt(entries, transactionId) {
  return [...entries].reverse().find(entry => {
    return entry.type === 'pet-config' && entry.transactionId === transactionId && entry.state !== 'rolled-back'
  }) || null
}

function assertReceipt(home, configPath, receipt) {
  if (!receipt || !samePath(receipt.path, configPath)) {
    throw new Error('The pending pet config receipt does not belong to the selected Hermes profile.')
  }
  if (!validSibling(receipt.rollbackBackup, configPath, 'classic-gold-rollback') ||
      !validSibling(receipt.rollbackTemporary, configPath, 'classic-gold-rollback-next') ||
      !validSibling(receipt.temporary, configPath, 'classic-gold-next')) {
    throw new Error('The pending pet config receipt has an invalid sibling path.')
  }
  assertSafeManagedPath(home, configPath, 'pet config')
  if (receipt.rollbackBackup) {
    assertSafeManagedPath(home, receipt.rollbackBackup, 'pet config rollback backup')
  }
  if (receipt.rollbackTemporary) {
    assertSafeManagedPath(home, receipt.rollbackTemporary, 'pet config rollback temporary file')
  }
  if (receipt.temporary) assertSafeManagedPath(home, receipt.temporary, 'pet config temporary file')
}

function removeVerified(path, expectedHash, label) {
  if (!path || !existsSync(path)) return
  if (!expectedHash || fileSha256(path) !== expectedHash) {
    throw new Error(`${label} changed; it was preserved at ${path}`)
  }
  unlinkSync(path)
}

function cleanupReceipt(receipt) {
  removeVerified(receipt.temporary, receipt.installedFileHash, 'The pet config temporary file')
  removeVerified(receipt.rollbackTemporary, receipt.previousHash, 'The pet config rollback temporary file')
  removeVerified(receipt.rollbackBackup, receipt.previousHash, 'The pet config rollback backup')
}

function markRolledBack(home, receipt) {
  appendManifest(home, { ...receipt, state: 'rolled-back' })
  appendManifest(home, {
    type: TRANSACTION_TYPE,
    path: receipt.path,
    state: 'rolled-back',
    transactionId: receipt.transactionId,
  })
}

/**
 * Finish or reverse an interrupted display.pet write before another command
 * uses its ownership record.
 */
export function recoverPendingPetConfig({ home, configPath, version }) {
  return withHomeTransactionLock(home, () => {
    const entries = readManifest(home).entries || []
    const pending = latestTransactionStates(entries).filter(entry => {
      return entry.state === 'planned' || entry.state === 'ready'
    })
    if (pending.length === 0) return { status: 'none' }
    if (pending.length > 1) {
      throw new Error('More than one unfinished pet config transaction exists; no config was changed.')
    }

    let marker = pending[0]
    const receipt = latestReceipt(entries, marker.transactionId)
    assertReceipt(home, configPath, receipt)
    const currentHash = fileSha256(configPath)

    if (receipt.rollbackTemporary && existsSync(receipt.rollbackTemporary)) {
      if (fileSha256(receipt.rollbackTemporary) !== receipt.previousHash ||
          currentHash !== receipt.installedFileHash) {
        throw new Error('The interrupted pet config rollback has later changes; no config was changed.')
      }
      commitVerifiedTemporary(configPath, receipt.rollbackTemporary, receipt.previousHash)
      if (fileSha256(configPath) !== receipt.previousHash) {
        throw new Error('The interrupted pet config rollback could not restore the prior file.')
      }
      cleanupReceipt(receipt)
      markRolledBack(home, receipt)
      return { status: 'rolled-back', transactionId: receipt.transactionId }
    }

    if (marker.state === 'planned' && currentHash === receipt.previousHash) {
      cleanupReceipt(receipt)
      markRolledBack(home, receipt)
      return { status: 'rolled-back', transactionId: receipt.transactionId }
    }

    if (marker.state === 'planned') {
      if (!receipt.installedFileHash || currentHash !== receipt.installedFileHash) {
        throw new Error('The interrupted pet config write has later changes; no config was changed.')
      }
      if (receipt.state !== 'installed') appendManifest(home, { ...receipt, state: 'installed' })
      marker = {
        type: TRANSACTION_TYPE,
        path: configPath,
        state: 'ready',
        transactionId: receipt.transactionId,
      }
      appendManifest(home, marker)
    }

    if (fileSha256(configPath) !== receipt.installedFileHash) {
      throw new Error('The interrupted pet config write changed before recovery; no config was changed.')
    }
    recordApplied(home, 'petConfig', {
      installedHash: receipt.installedHash,
      path: configPath,
      transactionId: receipt.transactionId,
    }, { version })
    appendManifest(home, { ...marker, state: 'committed' })
    try {
      cleanupReceipt(receipt)
    } catch {
      // The active stamp and installed receipt keep exact cleanup ownership.
    }
    return { status: 'committed', transactionId: receipt.transactionId }
  })
}

/** Install one display.pet selection with a recoverable ownership receipt. */
export function installPetConfig({ home, configPath, slug, version }) {
  return withHomeTransactionLock(home, () => {
    recoverPendingPetConfig({ home, configPath, version })
    assertSafeManagedPath(home, configPath, 'pet config')

    const original = readFileSync(configPath, 'utf8')
    const currentBlock = petConfigBlock(original)
    const activeConfig = readStamp(home)?.applied?.petConfig
    const entries = readManifest(home).entries || []
    const priorReceipt = activeConfig?.transactionId
      ? [...entries].reverse().find(entry => {
        return entry.type === 'pet-config' && entry.state === 'installed' &&
          entry.transactionId === activeConfig.transactionId
      })
      : null
    if (activeConfig && (!samePath(activeConfig.path, configPath) || !priorReceipt ||
        !samePath(priorReceipt.path, configPath) ||
        activeConfig.installedHash !== priorReceipt.installedHash)) {
      throw new Error('The active pet config stamp does not match its installed receipt.')
    }
    if (priorReceipt) assertReceipt(home, configPath, priorReceipt)
    if (activeConfig && sha256(currentBlock || '') !== priorReceipt.installedHash) {
      throw new Error('display.pet changed after this pack wrote it; preserve it and merge manually')
    }
    if (priorReceipt) cleanupReceipt(priorReceipt)

    const updated = activatePetInConfig(original, slug)
    const installedBlock = petConfigBlock(updated)
    const transactionId = randomUUID()
    const changed = updated !== original
    const receipt = {
      type: 'pet-config',
      path: configPath,
      priorBlock: priorReceipt ? priorReceipt.priorBlock : currentBlock,
      installedBlock,
      installedHash: sha256(installedBlock || ''),
      installedFileHash: sha256(Buffer.from(updated, 'utf8')),
      previousHash: sha256(Buffer.from(original, 'utf8')),
      rollbackBackup: changed ? uniqueSiblingPath(configPath, 'classic-gold-rollback') : null,
      rollbackTemporary: changed ? uniqueSiblingPath(configPath, 'classic-gold-rollback-next') : null,
      state: 'planned',
      temporary: changed ? uniqueSiblingPath(configPath, 'classic-gold-next') : null,
      transactionId,
    }
    assertReceipt(home, configPath, receipt)
    appendManifest(home, receipt)
    appendManifest(home, {
      type: TRANSACTION_TYPE,
      path: configPath,
      state: 'planned',
      transactionId,
    })

    let stampRecorded = false
    try {
      if (changed) {
        assertReceipt(home, configPath, receipt)
        copyFileSync(configPath, receipt.rollbackBackup)
        if (fileSha256(receipt.rollbackBackup) !== receipt.previousHash) {
          throw new Error('Pet config rollback backup verification failed.')
        }
        if (fileSha256(configPath) !== receipt.previousHash) {
          throw new Error('Pet config changed before the planned write.')
        }
        writeTextAtomically(configPath, updated, receipt.temporary)
      }
      if (fileSha256(configPath) !== receipt.installedFileHash ||
          sha256(petConfigBlock(readFileSync(configPath, 'utf8')) || '') !== receipt.installedHash) {
        throw new Error('Pet config post-write validation failed.')
      }
      appendManifest(home, { ...receipt, state: 'installed' })
      appendManifest(home, {
        type: TRANSACTION_TYPE,
        path: configPath,
        state: 'ready',
        transactionId,
      })
      recordApplied(home, 'petConfig', {
        installedHash: receipt.installedHash,
        path: configPath,
        transactionId,
      }, { version })
      stampRecorded = true
      appendManifest(home, {
        type: TRANSACTION_TYPE,
        path: configPath,
        state: 'committed',
        transactionId,
      })
      try {
        cleanupReceipt(receipt)
      } catch {
        // The active stamp and installed receipt keep exact cleanup ownership.
      }
      return { priorBlock: receipt.priorBlock, receipt }
    } catch (error) {
      if (stampRecorded) throw error
      try {
        const currentHash = fileSha256(configPath)
        if (currentHash === receipt.installedFileHash && receipt.previousHash !== receipt.installedFileHash) {
          if (!receipt.rollbackBackup || !existsSync(receipt.rollbackBackup) ||
              fileSha256(receipt.rollbackBackup) !== receipt.previousHash) {
            throw new Error('The exact pet config rollback backup is unavailable.')
          }
          if (fileSha256(configPath) !== receipt.installedFileHash) {
            throw new Error('Pet config changed before rollback.')
          }
          assertSafeManagedPath(home, receipt.rollbackTemporary, 'pet config rollback temporary file')
          writeTextAtomically(configPath, readFileSync(receipt.rollbackBackup, 'utf8'), receipt.rollbackTemporary)
        } else if (currentHash !== receipt.previousHash) {
          throw new Error('Pet config changed after the failed write; the later change was preserved.')
        }
        cleanupReceipt(receipt)
        markRolledBack(home, receipt)
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Pet activation failed and exact rollback could not complete.')
      }
      throw error
    }
  })
}
