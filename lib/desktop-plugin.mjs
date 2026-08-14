// Install the update-safe Classic Gold desktop plug-in under HERMES_HOME.
// The write is reversible and records both the current state and an undo entry.
import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

import {
  copyFileAtomically,
  fileSha256,
  missingDirectories,
  sha256,
  uniqueSiblingPath,
  writeTextAtomically
} from './file-integrity.mjs'
import { assertSafeManagedPath, isPathInside, sameManagedPath } from './path-safety.mjs'
import {
  appendManifest,
  readManifest,
  readStamp,
  recordApplied,
  restoreApplied,
  withHomeTransactionLock
} from './pack-stamp.mjs'

export const DESKTOP_PLUGIN_ID = 'classic-gold'
export const DESKTOP_PLUGIN_RELATIVE_PATH = join('desktop-plugins', DESKTOP_PLUGIN_ID, 'plugin.js')
export const WORDMARK_TOKEN = '__CLASSIC_GOLD_WORDMARK_DATA_URI__'

// This is the released Pack 1.2 renderer payload before transaction receipts.
// It is only an adoption proof. It is not a user-file baseline.
const LEGACY_DESKTOP_PLUGIN_HASHES = new Set([
  '2692bd6a1cb18ca5bb52fbd9f1895b15220972e58de342a8cde40bc25aa58c8d'
])

const WORDMARK_SOURCE_RELATIVE_PATH = join(
  'advanced',
  'extras-caduceus',
  'baselines',
  '0.17.0-d7b3607',
  'files',
  'apps',
  'desktop',
  'src',
  'components',
  'chat',
  'intro.tsx'
)

export function desktopPluginPath (home) {
  return join(home, DESKTOP_PLUGIN_RELATIVE_PATH)
}

/** Build the one-file disk plug-in and embed the original pixel wordmark. */
export function buildDesktopPluginSource (source) {
  const plugin = readFileSync(source, 'utf8')
  if (!plugin.includes(WORDMARK_TOKEN)) return plugin

  const packRoot = join(dirname(source), '..', '..')
  const wordmarkSource = join(packRoot, WORDMARK_SOURCE_RELATIVE_PATH)
  const intro = readFileSync(wordmarkSource, 'utf8')
  const dataUri = intro.match(/src="(data:image\/png;base64,[A-Za-z0-9+/=]+)"/)?.[1]

  if (!dataUri) {
    throw new Error(`Could not read the Classic Gold wordmark from ${wordmarkSource}`)
  }

  return plugin.replaceAll(WORDMARK_TOKEN, dataUri)
}

/** Replace the watched file in one rename, so Hermes never reads half a file. */
function removeEmptyDirectories (directories) {
  for (const directory of [...directories].reverse()) {
    try {
      rmdirSync(directory)
    } catch {
      // Keep a directory when it is not empty or another process owns it.
    }
  }
}

function assertTransactionPaths (home, receipt) {
  const paths = [
    [receipt.path, 'desktop plug-in target'],
    [receipt.backup, 'desktop plug-in original backup'],
    [receipt.rollbackBackup, 'desktop plug-in rollback backup'],
    [receipt.temporary, 'desktop plug-in temporary file'],
    ...(receipt.createdDirectories || []).map(path => [path, 'desktop plug-in created directory'])
  ]
  for (const [path, label] of paths) {
    if (path) assertSafeManagedPath(home, path, label)
  }
  assertOwnedSibling(receipt.path, receipt.backup, 'pre-classic-gold', 'original backup')
  assertOwnedSibling(receipt.path, receipt.rollbackBackup, 'classic-gold-rollback', 'rollback backup')
  assertOwnedSibling(receipt.path, receipt.temporary, 'classic-gold-next', 'temporary file')
  for (const directory of receipt.createdDirectories || []) {
    if (sameManagedPath(dirname(directory), home) ||
        sameManagedPath(directory, receipt.path) ||
        !isPathInside(directory, receipt.path)) {
      throw new Error('Desktop plug-in receipt has an invalid created directory.')
    }
  }
}

/** Delete a Pack-created original backup only when its exact hash matches. */
export function removeVerifiedCreatedBackup (path, expectedHash) {
  if (!path || !existsSync(path)) return
  if (!expectedHash || fileSha256(path) !== expectedHash) {
    throw new Error('desktop plug-in original backup hash verification failed')
  }
  unlinkSync(path)
}

function removeVerifiedTemporary (path, installedHash) {
  if (!path || !existsSync(path)) return
  if (!installedHash || fileSha256(path) !== installedHash) {
    throw new Error('desktop plug-in temporary file changed after the Pack created it')
  }
  unlinkSync(path)
}

function assertOwnedSibling (target, path, label, description) {
  if (!path) return
  const targetName = basename(target)
  const candidateName = basename(path)
  const expectedPrefix = `${targetName}.${label}-`
  const sameDirectory = sameManagedPath(dirname(target), dirname(path))
  const hasPrefix = process.platform === 'win32'
    ? candidateName.toLowerCase().startsWith(expectedPrefix.toLowerCase())
    : candidateName.startsWith(expectedPrefix)
  if (!sameDirectory || !hasPrefix) {
    throw new Error(`Desktop plug-in receipt has an invalid ${description} path.`)
  }
}

function activeDesktopCleanupReceipt (home, manifest, target, componentStamp) {
  if (!componentStamp?.transactionId) return null
  const matches = (manifest.entries || []).filter(entry => {
    return entry.type === 'desktop-plugin' &&
      sameManagedPath(entry.path, target) &&
      entry.transactionId === componentStamp.transactionId
  })
  const planned = matches.filter(entry => entry.state === 'planned')
  const installed = matches.filter(entry => entry.state === 'installed')
  if (planned.length === 0 && installed.length === 0) return null
  if (planned.length !== 1 || installed.length !== 1) {
    throw new Error('Desktop plug-in ownership stamp has an incomplete transaction receipt set.')
  }

  const plan = planned[0]
  const completed = installed[0]
  const sameCreatedDirectories = JSON.stringify(plan.createdDirectories || []) ===
    JSON.stringify(completed.createdDirectories || [])
  const stableFields = [
    'backup',
    'backupCreated',
    'backupHash',
    'installedHash',
    'preExisting',
    'previousHash',
    'rollbackBackup'
  ]
  if (!sameCreatedDirectories || stableFields.some(field => plan[field] !== completed[field])) {
    throw new Error('Desktop plug-in transaction receipts do not identify one exact cleanup set.')
  }
  if (completed.temporary && !sameManagedPath(completed.temporary, plan.temporary)) {
    throw new Error('Desktop plug-in transaction receipts have different temporary paths.')
  }

  assertTransactionPaths(home, plan)
  assertTransactionPaths(home, completed)
  const receipt = { ...completed, temporary: completed.temporary || plan.temporary || null }
  return receipt
}

/**
 * Adopt only the exact Pack 1.2 renderer receipt shape that predates
 * transaction receipts. The old receipt proves Pack ownership, not a user
 * baseline, because it records that no file existed before Pack installation.
 */
export function legacyDesktopPluginReceipt ({ componentStamp, currentHash, manifest, target, legacyHashes = LEGACY_DESKTOP_PLUGIN_HASHES }) {
  if (!componentStamp || componentStamp.via !== 'runtime-plugin' ||
      componentStamp.transactionId !== undefined || componentStamp.installedHash !== undefined ||
      !sameManagedPath(componentStamp.path, target) || !legacyHashes.has(currentHash)) {
    return null
  }
  const receipts = (manifest.entries || []).filter(entry => {
    return entry.type === 'desktop-plugin' && sameManagedPath(entry.path, target)
  })
  if (receipts.length === 0 || receipts.some(entry => {
    return entry.id !== DESKTOP_PLUGIN_ID || entry.state !== undefined ||
      entry.transactionId !== undefined || entry.installedHash !== undefined ||
      entry.preExisting !== false || entry.backup !== null
  })) {
    return null
  }
  return {
    backup: null,
    backupCreated: false,
    backupHash: null,
    createdDirectories: [],
    id: DESKTOP_PLUGIN_ID,
    installedHash: currentHash,
    path: target,
    preExisting: false,
    previousHash: null,
    rollbackBackup: null,
    temporary: null
  }
}

function cleanActiveDesktopArtifacts (home, receipt) {
  if (!receipt) return
  assertTransactionPaths(home, receipt)
  if (fileSha256(receipt.path) !== receipt.installedHash) {
    throw new Error('The installed desktop plug-in changed before cleanup.')
  }
  if (receipt.preExisting && (
    !receipt.backup ||
    !receipt.backupHash ||
    fileSha256(receipt.backup) !== receipt.backupHash
  )) {
    throw new Error('The desktop plug-in original backup changed before cleanup.')
  }
  if (receipt.temporary && existsSync(receipt.temporary) &&
      fileSha256(receipt.temporary) !== receipt.installedHash) {
    throw new Error('Desktop plug-in active temporary file hash verification failed.')
  }
  if (receipt.rollbackBackup && existsSync(receipt.rollbackBackup) && (
    !receipt.previousHash || fileSha256(receipt.rollbackBackup) !== receipt.previousHash
  )) {
    throw new Error('Desktop plug-in active rollback backup hash verification failed.')
  }

  removeVerifiedTemporary(receipt.temporary, receipt.installedHash)
  if (receipt.rollbackBackup && existsSync(receipt.rollbackBackup)) {
    unlinkSync(receipt.rollbackBackup)
  }
}

function latestUncommittedTransaction (manifest, target, componentStamp) {
  const latest = [...(manifest.entries || [])].reverse().find(entry => {
    return entry.type === 'desktop-plugin' && sameManagedPath(entry.path, target) && entry.transactionId
  })
  if (!latest || latest.state === 'rolled-back' || latest.state === 'committed') return null
  if (componentStamp?.transactionId === latest.transactionId) return null
  const planned = (manifest.entries || []).find(entry => {
    return entry.type === 'desktop-plugin' &&
      sameManagedPath(entry.path, target) &&
      entry.transactionId === latest.transactionId &&
      entry.state === 'planned'
  })
  if (!planned) {
    throw new Error('Desktop plug-in has an uncommitted transaction without a planned receipt.')
  }
  return planned
}

function recoverDesktopTransaction (home, manifest, target, componentStamp, nowIso) {
  const planned = latestUncommittedTransaction(manifest, target, componentStamp)
  if (!planned) return false
  assertTransactionPaths(home, planned)

  const currentHash = fileSha256(target)
  const previousHash = planned.previousHash || null
  const rollbackHash = fileSha256(planned.rollbackBackup)
  const priorIsPresent = currentHash === previousHash
  const installedIsPresent = Boolean(planned.installedHash && currentHash === planned.installedHash)

  if (planned.rollbackBackup && existsSync(planned.rollbackBackup) &&
      (!previousHash || rollbackHash !== previousHash)) {
    throw new Error('Desktop plug-in orphan rollback backup hash verification failed.')
  }
  if (planned.temporary && existsSync(planned.temporary) &&
      (!planned.installedHash || fileSha256(planned.temporary) !== planned.installedHash)) {
    throw new Error('Desktop plug-in orphan temporary file hash verification failed.')
  }
  if (planned.backupCreated && planned.backup && existsSync(planned.backup) &&
      (!planned.backupHash || fileSha256(planned.backup) !== planned.backupHash)) {
    throw new Error('Desktop plug-in orphan original backup hash verification failed.')
  }
  removeVerifiedTemporary(planned.temporary, planned.installedHash)

  if (previousHash) {
    if (!priorIsPresent) {
      if (!installedIsPresent && currentHash !== null) {
        throw new Error('Desktop plug-in orphan recovery found an unowned target change.')
      }
      if (!planned.rollbackBackup || rollbackHash !== previousHash) {
        throw new Error('Desktop plug-in orphan recovery cannot prove the prior file.')
      }
      if (!planned.temporary) {
        throw new Error('Desktop plug-in orphan recovery has no recorded temporary path.')
      }
      copyFileAtomically(planned.rollbackBackup, target, planned.temporary)
      if (fileSha256(target) !== previousHash) {
        throw new Error('Desktop plug-in orphan recovery could not restore the prior file.')
      }
    }
  } else if (currentHash !== null) {
    if (!installedIsPresent) {
      throw new Error('Desktop plug-in orphan recovery found an unowned target file.')
    }
    unlinkSync(target)
  }

  if (planned.rollbackBackup && existsSync(planned.rollbackBackup)) {
    if (!previousHash || fileSha256(planned.rollbackBackup) !== previousHash) {
      throw new Error('Desktop plug-in orphan rollback backup hash verification failed.')
    }
    unlinkSync(planned.rollbackBackup)
  }
  if (planned.backupCreated) {
    removeVerifiedCreatedBackup(planned.backup, planned.backupHash)
  }
  removeEmptyDirectories(planned.createdDirectories || [])
  appendManifest(home, { ...planned, state: 'rolled-back' }, nowIso)
  return true
}

/** Reverse the newest uncommitted desktop plug-in transaction, if present. */
export function recoverInterruptedDesktopPlugin ({ home, nowIso } = {}) {
  return withHomeTransactionLock(home, () => {
    const target = desktopPluginPath(home)
    return recoverDesktopTransaction(
      home,
      readManifest(home),
      target,
      readStamp(home)?.applied?.desktopPlugin,
      nowIso
    )
  })
}

/**
 * Copy the bundled plug-in to HERMES_HOME and record a reversible receipt.
 * Keep the first backup because it is the user's state before this pack.
 */
export function installDesktopPlugin ({ home, retainRollbackBackup = false, source, nowIso, version }) {
  return withHomeTransactionLock(home, () => {
    const target = desktopPluginPath(home)
    let manifest = readManifest(home)
    let componentStamp = readStamp(home)?.applied?.desktopPlugin
    if (recoverDesktopTransaction(home, manifest, target, componentStamp, nowIso)) {
      manifest = readManifest(home)
      componentStamp = readStamp(home)?.applied?.desktopPlugin
    }
    if (componentStamp && !sameManagedPath(componentStamp.path, target)) {
      throw new Error('Desktop plug-in ownership stamp points to a different path.')
    }
    const activeStamp = sameManagedPath(componentStamp?.path, target)
    let priorReceipt = activeStamp
      ? activeDesktopCleanupReceipt(home, manifest, target, componentStamp)
      : null
    const currentExists = existsSync(target)
    const currentHash = currentExists ? fileSha256(target) : null
    if (activeStamp && !priorReceipt) {
      priorReceipt = legacyDesktopPluginReceipt({
        componentStamp,
        currentHash,
        manifest,
        target
      })
    }
    if (activeStamp && (!priorReceipt || componentStamp.installedHash !== priorReceipt.installedHash)) {
      if (priorReceipt && componentStamp.installedHash === undefined) {
        // Legacy active stamps have no installed hash. The hash is proven above.
      } else {
        throw new Error('Desktop plug-in ownership stamp has no completed manifest receipt.')
      }
    }
    const managedBefore = Boolean(activeStamp && priorReceipt)
    const preExisting = managedBefore ? Boolean(priorReceipt.preExisting) : currentExists
    const contents = buildDesktopPluginSource(source)
    const installedHash = sha256(contents)
    const previousHash = currentHash
    if (managedBefore && (!currentExists || !priorReceipt.installedHash || previousHash !== priorReceipt.installedHash)) {
      throw new Error('The installed desktop plug-in changed after this pack wrote it. Preserve it and merge manually.')
    }
    if (managedBefore && priorReceipt.preExisting && (
      !priorReceipt.backup ||
      !priorReceipt.backupHash ||
      fileSha256(priorReceipt.backup) !== priorReceipt.backupHash
    )) {
      throw new Error('The desktop plug-in backup changed or is missing. Preserve it and merge manually.')
    }
    cleanActiveDesktopArtifacts(home, priorReceipt)
    const backup = managedBefore
      ? priorReceipt?.backup || null
      : preExisting
        ? uniqueSiblingPath(target, 'pre-classic-gold')
        : null
    const rollbackBackup = currentExists ? uniqueSiblingPath(target, 'classic-gold-rollback') : null
    const temporary = uniqueSiblingPath(target, 'classic-gold-next')
    const transactionId = randomUUID()
    const createdDirectories = missingDirectories(dirname(target), home)
    const planned = {
      type: 'desktop-plugin',
      id: DESKTOP_PLUGIN_ID,
      path: target,
      backup,
      backupCreated: Boolean(!managedBefore && preExisting && backup),
      backupHash: managedBefore ? priorReceipt?.backupHash || null : backup ? previousHash : null,
      createdDirectories,
      installedHash,
      preExisting,
      previousHash,
      rollbackBackup,
      state: 'planned',
      temporary,
      transactionId
    }

    assertTransactionPaths(home, planned)
    appendManifest(home, planned, nowIso)
    let stampRecorded = false
    try {
      assertTransactionPaths(home, planned)
      mkdirSync(dirname(target), { recursive: true })
      if (rollbackBackup) {
        copyFileSync(target, rollbackBackup)
        if (fileSha256(rollbackBackup) !== previousHash) {
          throw new Error('desktop plug-in rollback backup hash verification failed')
        }
      }
      if (!managedBefore && preExisting && backup) {
        copyFileSync(target, backup)
        if (fileSha256(backup) !== planned.backupHash) {
          throw new Error('desktop plug-in original backup hash verification failed')
        }
      }
      writeTextAtomically(target, contents, temporary)
      if (fileSha256(target) !== installedHash) throw new Error('desktop plug-in hash verification failed')

      const installed = {
        ...planned,
        backupHash: backup ? fileSha256(backup) : null,
        state: 'installed',
        temporary: null
      }
      appendManifest(home, installed, nowIso)
      recordApplied(home, 'desktopPlugin', {
        via: 'runtime-plugin',
        installedHash,
        path: target,
        transactionId
      }, { nowIso, version })
      stampRecorded = true
      try {
        appendManifest(home, { ...installed, state: 'committed' }, nowIso)
      } catch {
        // The active stamp and installed receipt prove this transaction committed.
      }
      if (!retainRollbackBackup) {
        try {
          if (rollbackBackup && existsSync(rollbackBackup)) {
            if (!previousHash || fileSha256(rollbackBackup) !== previousHash) {
              throw new Error('desktop plug-in rollback backup changed after commit')
            }
            unlinkSync(rollbackBackup)
          }
        } catch {
          // The installed receipt records this path for later cleanup.
        }
      }
      return {
        backup,
        path: target,
        preExisting,
        previousHash,
        rollbackBackup,
        transactionId
      }
    } catch (error) {
      if (stampRecorded) throw error
      try {
        if (existsSync(temporary)) {
          if (fileSha256(temporary) !== installedHash) {
            throw new Error('desktop plug-in temporary file changed before rollback')
          }
          unlinkSync(temporary)
        }
        if (rollbackBackup && existsSync(rollbackBackup)) {
          if (previousHash && fileSha256(rollbackBackup) !== previousHash) {
            throw new Error('desktop plug-in rollback backup hash verification failed')
          }
          const currentHash = fileSha256(target)
          if (currentHash !== previousHash) {
            if (currentHash !== installedHash) {
              throw new Error('desktop plug-in changed before rollback')
            }
            copyFileAtomically(rollbackBackup, target, temporary)
          }
          if (previousHash && fileSha256(target) !== previousHash) {
            throw new Error('desktop plug-in rollback hash verification failed')
          }
          unlinkSync(rollbackBackup)
        } else if (!currentExists && fileSha256(target) === installedHash) {
          unlinkSync(target)
        }
        if (planned.backupCreated) removeVerifiedCreatedBackup(backup, planned.backupHash)
        removeEmptyDirectories(createdDirectories)
        appendManifest(home, { ...planned, state: 'rolled-back' }, nowIso)
      } catch {
        // The planned receipt remains available for a later safe uninstall.
      }
      throw error
    }
  })
}

/** Restore the renderer after a later install step fails. */
export function compensateDesktopPlugin ({ home, previousApplied, transactionId, nowIso }) {
  return withHomeTransactionLock(home, () => {
    const target = desktopPluginPath(home)
    const manifest = readManifest(home)
    const componentStamp = readStamp(home)?.applied?.desktopPlugin
    const completed = manifest.entries.some(entry => (
      entry.type === 'desktop-plugin-compensation' &&
      entry.desktopTransactionId === transactionId &&
      entry.state === 'rolled-back'
    ))
    if (completed) return false

    const pending = [...manifest.entries].reverse().find(entry => (
      entry.type === 'desktop-plugin-compensation' &&
      entry.desktopTransactionId === transactionId &&
      entry.state === 'planned'
    ))
    const currentTransaction = componentStamp?.transactionId === transactionId &&
      sameManagedPath(componentStamp.path, target)
    const previousTransaction = Boolean(pending) && JSON.stringify(componentStamp || null) ===
      JSON.stringify(pending?.previousApplied || null)
    if (!currentTransaction && !previousTransaction) {
      throw new Error('Desktop plug-in compensation cannot prove the current renderer ownership.')
    }

    const receipt = currentTransaction
      ? activeDesktopCleanupReceipt(home, manifest, target, componentStamp)
      : manifest.entries.find(entry => (
        entry.type === 'desktop-plugin' &&
        entry.transactionId === transactionId &&
        entry.state === 'installed' &&
        sameManagedPath(entry.path, target)
      ))
    if (!receipt || receipt.transactionId !== transactionId) {
      throw new Error('Desktop plug-in compensation has no completed renderer receipt.')
    }
    assertTransactionPaths(home, receipt)

    const compensation = pending || (() => {
      const temporary = uniqueSiblingPath(target, 'classic-gold-compensate')
      assertSafeManagedPath(home, temporary, 'desktop plug-in compensation temporary file')
      assertOwnedSibling(target, temporary, 'classic-gold-compensate', 'compensation temporary file')
      const planned = {
        type: 'desktop-plugin-compensation',
        path: target,
        desktopTransactionId: transactionId,
        installedHash: receipt.installedHash,
        previousApplied,
        previousHash: receipt.previousHash,
        rollbackBackup: receipt.rollbackBackup,
        state: 'planned',
        temporary,
        transactionId: randomUUID()
      }
      appendManifest(home, planned, nowIso)
      return planned
    })()

    if (compensation.installedHash !== receipt.installedHash ||
        compensation.previousHash !== receipt.previousHash ||
        compensation.rollbackBackup !== receipt.rollbackBackup ||
        !sameManagedPath(compensation.path, target)) {
      throw new Error('Desktop plug-in compensation receipt does not match the renderer transaction.')
    }
    assertSafeManagedPath(home, compensation.temporary, 'desktop plug-in compensation temporary file')
    assertOwnedSibling(target, compensation.temporary, 'classic-gold-compensate', 'compensation temporary file')

    const currentHash = fileSha256(target)
    if (currentHash === receipt.installedHash) {
      if (receipt.previousHash) {
        if (!receipt.rollbackBackup || !existsSync(receipt.rollbackBackup) ||
            fileSha256(receipt.rollbackBackup) !== receipt.previousHash) {
          throw new Error('Desktop plug-in compensation cannot prove the prior renderer.')
        }
        copyFileAtomically(receipt.rollbackBackup, target, compensation.temporary)
        if (fileSha256(target) !== receipt.previousHash) {
          throw new Error('Desktop plug-in compensation could not restore the prior renderer.')
        }
      } else {
        unlinkSync(target)
        if (fileSha256(target) !== null) {
          throw new Error('Desktop plug-in compensation could not remove the new renderer.')
        }
      }
    } else if (currentHash !== receipt.previousHash) {
      throw new Error('Desktop plug-in changed before compensation.')
    }

    if (currentTransaction) restoreApplied(home, 'desktopPlugin', compensation.previousApplied)
    if (receipt.rollbackBackup && existsSync(receipt.rollbackBackup)) {
      if (!receipt.previousHash || fileSha256(receipt.rollbackBackup) !== receipt.previousHash) {
        throw new Error('Desktop plug-in compensation backup changed before cleanup.')
      }
      unlinkSync(receipt.rollbackBackup)
    }
    if (!receipt.previousHash) removeEmptyDirectories(receipt.createdDirectories || [])
    appendManifest(home, { ...compensation, state: 'rolled-back' }, nowIso)
    return true
  })
}

/** Remove a renderer rollback backup after all later install steps succeed. */
export function finalizeDesktopPlugin ({ home, transactionId, nowIso }) {
  return withHomeTransactionLock(home, () => {
    const target = desktopPluginPath(home)
    const componentStamp = readStamp(home)?.applied?.desktopPlugin
    if (componentStamp?.transactionId !== transactionId || !sameManagedPath(componentStamp.path, target)) {
      throw new Error('Desktop plug-in finalization cannot prove the current renderer ownership.')
    }
    const receipt = activeDesktopCleanupReceipt(home, readManifest(home), target, componentStamp)
    if (!receipt || receipt.transactionId !== transactionId) {
      throw new Error('Desktop plug-in finalization has no completed renderer receipt.')
    }
    assertTransactionPaths(home, receipt)
    const finalization = {
      type: 'desktop-plugin-finalization',
      path: target,
      desktopTransactionId: transactionId,
      rollbackBackup: receipt.rollbackBackup,
      state: 'planned',
      transactionId: randomUUID()
    }
    appendManifest(home, finalization, nowIso)
    if (fileSha256(target) !== receipt.installedHash) {
      throw new Error('Desktop plug-in changed before finalization.')
    }
    if (receipt.rollbackBackup) {
      if (!receipt.previousHash || !existsSync(receipt.rollbackBackup) ||
          fileSha256(receipt.rollbackBackup) !== receipt.previousHash) {
        throw new Error('Desktop plug-in finalization cannot prove the rollback backup.')
      }
      unlinkSync(receipt.rollbackBackup)
    }
    appendManifest(home, { ...finalization, state: 'committed' }, nowIso)
    return true
  })
}
