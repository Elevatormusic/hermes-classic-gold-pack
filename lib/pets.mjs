// Install bundled pets with exact ownership receipts. The installer changes
// only bundled files. It does not delete the shared thumbnail cache.
import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { copyFileAtomically, fileSha256, missingDirectories, uniqueSiblingPath } from './file-integrity.mjs'
import { appendManifest, readManifest, readStamp, recordApplied, withHomeTransactionLock } from './pack-stamp.mjs'
import { assertSafeManagedPath } from './path-safety.mjs'

function listFiles(root, prefix = '') {
  const files = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const name = prefix ? join(prefix, entry.name) : entry.name
    if (entry.isDirectory()) files.push(...listFiles(join(root, entry.name), name))
    else if (entry.isFile()) files.push(name)
  }
  return files.sort()
}

function removeEmptyDirectories(directories) {
  for (const directory of [...directories].reverse()) {
    try {
      rmdirSync(directory)
    } catch {
      // Keep a directory when it is not empty or another process owns it.
    }
  }
}

function pathKey(path) {
  const value = resolve(path)
  return process.platform === 'win32' ? value.toLowerCase() : value
}

function inside(root, path) {
  const rel = relative(resolve(root), resolve(path))
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
}

function assertPetReceiptPaths(home, receipt) {
  assertSafeManagedPath(home, receipt.path, 'pet file target')
  if (receipt.backup) assertSafeManagedPath(home, receipt.backup, 'pet file backup')
  if (receipt.rollbackBackup) {
    assertSafeManagedPath(home, receipt.rollbackBackup, 'pet file rollback backup')
  }
  if (receipt.temporary) assertSafeManagedPath(home, receipt.temporary, 'pet file temporary path')
  for (const directory of receipt.createdDirectories || []) {
    assertSafeManagedPath(home, directory, 'pet file created directory')
    if (pathKey(directory) === pathKey(join(home, 'pets')) || !inside(directory, receipt.path)) {
      throw new Error(`Pet file receipt has an invalid created directory: ${receipt.path}`)
    }
  }
}

function validateActiveReceipt(receipt, root, home) {
  if (receipt) assertPetReceiptPaths(home, receipt)
  if (!receipt || !inside(root, receipt.path)) {
    throw new Error('The pet ownership stamp has a file outside the selected pets directory.')
  }
  if (!existsSync(receipt.path) || !receipt.installedHash || fileSha256(receipt.path) !== receipt.installedHash) {
    throw new Error(`Pet file changed after this pack wrote it: ${receipt.path}`)
  }
  if (receipt.preExisting) {
    const validBackup = receipt.backup &&
      pathKey(dirname(receipt.backup)) === pathKey(dirname(receipt.path)) &&
      basename(receipt.backup).startsWith(`${basename(receipt.path)}.pre-classic-gold`) &&
      receipt.backupHash && fileSha256(receipt.backup) === receipt.backupHash
    if (!validBackup) throw new Error(`Pet file backup changed or is missing: ${receipt.path}`)
  }
  for (const directory of receipt.createdDirectories || []) {
    if (pathKey(root) === pathKey(directory) ||
        !inside(root, directory) ||
        !inside(directory, receipt.path)) {
      throw new Error(`Pet file receipt has an invalid created directory: ${receipt.path}`)
    }
  }
}

function applyRetirement(plan, home) {
  const receipt = plan.receipt
  assertPetReceiptPaths(home, receipt)
  copyFileSync(receipt.path, receipt.rollbackBackup)
  if (fileSha256(receipt.rollbackBackup) !== receipt.previousHash) {
    throw new Error(`Pet file rollback backup verification failed: ${receipt.path}`)
  }
  if (receipt.preExisting) {
    if (fileSha256(receipt.backup) !== receipt.restoredHash) {
      throw new Error(`Pet file backup changed before restore: ${receipt.path}`)
    }
    copyFileAtomically(receipt.backup, receipt.path, receipt.temporary)
    unlinkSync(receipt.backup)
  } else {
    unlinkSync(receipt.path)
  }
  if (fileSha256(receipt.path) !== receipt.restoredHash) {
    throw new Error(`Pet file retirement verification failed: ${receipt.path}`)
  }
}

function rollBackRetirement(plan, home) {
  const receipt = plan.receipt
  assertPetReceiptPaths(home, receipt)
  const currentHash = fileSha256(receipt.path)
  if (currentHash !== receipt.previousHash && currentHash !== receipt.restoredHash) {
    throw new Error(`Pet file changed before retirement rollback: ${receipt.path}`)
  }
  if (receipt.temporary && existsSync(receipt.temporary)) {
    const temporaryHash = fileSha256(receipt.temporary)
    if (temporaryHash !== receipt.previousHash && temporaryHash !== receipt.restoredHash) {
      throw new Error(`Pet retirement temporary file changed: ${receipt.path}`)
    }
    unlinkSync(receipt.temporary)
  }
  if (receipt.preExisting && !existsSync(receipt.backup)) {
    if (fileSha256(receipt.path) !== receipt.restoredHash) {
      throw new Error(`Pet file restore changed during rollback: ${receipt.path}`)
    }
    copyFileSync(receipt.path, receipt.backup)
    if (fileSha256(receipt.backup) !== receipt.restoredHash) {
      throw new Error(`Pet file backup verification failed during rollback: ${receipt.path}`)
    }
  }
  if (existsSync(receipt.rollbackBackup)) {
    if (fileSha256(receipt.rollbackBackup) !== receipt.previousHash) {
      throw new Error(`Pet file rollback backup changed: ${receipt.path}`)
    }
    if (fileSha256(receipt.path) !== receipt.previousHash) {
      if (!receipt.temporary) {
        throw new Error(`Pet retirement receipt has no recorded temporary path: ${receipt.path}`)
      }
      copyFileAtomically(receipt.rollbackBackup, receipt.path, receipt.temporary)
    }
    if (fileSha256(receipt.path) !== receipt.previousHash) {
      throw new Error(`Pet file rollback verification failed: ${receipt.path}`)
    }
    unlinkSync(receipt.rollbackBackup)
  } else if (fileSha256(receipt.path) !== receipt.previousHash) {
    throw new Error(`Pet file changed before retirement rollback: ${receipt.path}`)
  }
}

function newestPetTransaction(entries) {
  const types = new Set(['pet-file', 'pet-file-retirement', 'pet-transaction'])
  return [...entries].reverse().find(entry => {
    return types.has(entry.type) && typeof entry.transactionId === 'string'
  })?.transactionId || null
}

function latestTransactionReceipts(entries, transactionId, type) {
  const receipts = new Map()
  const planned = new Map()
  for (const entry of entries) {
    if (entry.transactionId !== transactionId || entry.type !== type ||
        entry.state !== 'planned' || typeof entry.path !== 'string') continue
    planned.set(pathKey(entry.path), entry)
  }
  for (const entry of [...entries].reverse()) {
    if (entry.transactionId !== transactionId || entry.type !== type ||
        typeof entry.path !== 'string') continue
    const key = pathKey(entry.path)
    if (!receipts.has(key)) receipts.set(key, entry)
  }
  return [...receipts.entries()].map(([key, receipt]) => ({
    ...receipt,
    temporary: receipt.temporary || planned.get(key)?.temporary || null,
  }))
}

function assertPetCleanupSibling(receipt, field, label) {
  const candidate = receipt[field]
  if (!candidate) return
  const expectedPrefix = `${basename(receipt.path)}.${label}-`
  const candidateName = basename(candidate)
  const hasPrefix = process.platform === 'win32'
    ? candidateName.toLowerCase().startsWith(expectedPrefix.toLowerCase())
    : candidateName.startsWith(expectedPrefix)
  if (pathKey(dirname(candidate)) !== pathKey(dirname(receipt.path)) || !hasPrefix) {
    throw new Error(`Pet receipt has an invalid ${field} cleanup path: ${receipt.path}`)
  }
}

function exactActivePetReceipts(entries, transactionId, type) {
  const planned = new Map()
  const installed = new Map()
  for (const entry of entries) {
    if (entry.transactionId !== transactionId || entry.type !== type) continue
    if (entry.state !== 'planned' && entry.state !== 'installed') continue
    if (typeof entry.path !== 'string') {
      throw new Error('The pet ownership stamp has incomplete manifest receipts.')
    }
    const receipts = entry.state === 'planned' ? planned : installed
    const key = pathKey(entry.path)
    if (receipts.has(key)) {
      throw new Error('The pet ownership stamp has ambiguous manifest receipts.')
    }
    receipts.set(key, entry)
  }
  if (planned.size !== installed.size || [...planned.keys()].some(key => !installed.has(key))) {
    throw new Error('The pet ownership stamp has incomplete manifest receipts.')
  }

  const stableFields = [
    'backup',
    'backupCreated',
    'installedHash',
    'preExisting',
    'previousHash',
    'restoredHash',
    'rollbackBackup',
    'sourceTransactionId',
  ]
  return [...installed.entries()].map(([key, completed]) => {
    const plan = planned.get(key)
    const sameCreatedDirectories = JSON.stringify(plan.createdDirectories || []) ===
      JSON.stringify(completed.createdDirectories || [])
    if (!sameCreatedDirectories || stableFields.some(field => plan[field] !== completed[field])) {
      throw new Error('Pet transaction receipts do not identify one exact cleanup set.')
    }
    if (completed.temporary && pathKey(completed.temporary) !== pathKey(plan.temporary)) {
      throw new Error('Pet transaction receipts have different temporary paths.')
    }
    const receipt = { ...completed, temporary: completed.temporary || plan.temporary || null }
    assertPetCleanupSibling(receipt, 'backup', 'pre-classic-gold')
    assertPetCleanupSibling(receipt, 'rollbackBackup', 'classic-gold-rollback')
    assertPetCleanupSibling(receipt, 'temporary', 'classic-gold-next')
    return receipt
  })
}

function validatePetCleanupReceipt(receipt, petsDir, home) {
  assertPetReceiptPaths(home, receipt)
  if (!inside(petsDir, receipt.path)) {
    throw new Error('The pet cleanup receipt has a file outside the selected pets directory.')
  }
  for (const directory of receipt.createdDirectories || []) {
    if (pathKey(petsDir) === pathKey(directory) ||
        !inside(petsDir, directory) ||
        !inside(directory, receipt.path)) {
      throw new Error(`Pet cleanup receipt has an invalid created directory: ${receipt.path}`)
    }
  }

  if (receipt.type === 'pet-file') {
    validateActiveReceipt(receipt, petsDir, home)
  } else {
    if (fileSha256(receipt.path) !== receipt.restoredHash) {
      throw new Error(`Retired pet target changed before cleanup: ${receipt.path}`)
    }
    if (receipt.preExisting && (
      !receipt.backup || !receipt.backupHash || receipt.restoredHash !== receipt.backupHash
    )) {
      throw new Error(`Retired pet backup receipt is incomplete: ${receipt.path}`)
    }
    if (receipt.backup && existsSync(receipt.backup)) {
      throw new Error(`Retired pet original backup reappeared before cleanup: ${receipt.path}`)
    }
  }

  if (receipt.rollbackBackup && existsSync(receipt.rollbackBackup) && (
    !receipt.previousHash || fileSha256(receipt.rollbackBackup) !== receipt.previousHash
  )) {
    throw new Error(`Pet active rollback backup changed before cleanup: ${receipt.path}`)
  }
  if (receipt.temporary && existsSync(receipt.temporary)) {
    const temporaryHash = fileSha256(receipt.temporary)
    const expectedHashes = receipt.type === 'pet-file-retirement'
      ? new Set([receipt.previousHash, receipt.restoredHash].filter(Boolean))
      : new Set([receipt.installedHash].filter(Boolean))
    if (!expectedHashes.has(temporaryHash)) {
      throw new Error(`Pet active temporary file changed before cleanup: ${receipt.path}`)
    }
  }
}

function removeOwnedEmptyPetDirectories(home, directories) {
  for (const directory of [...directories].reverse()) {
    assertSafeManagedPath(home, directory, 'pet file created directory')
    if (!existsSync(directory) || readdirSync(directory).length > 0) continue
    rmdirSync(directory)
  }
}

function cleanActivePetArtifacts(home, petsDir, entries, transactionId, activeReceipts) {
  if (!transactionId) return
  const files = exactActivePetReceipts(entries, transactionId, 'pet-file')
  const retirements = exactActivePetReceipts(entries, transactionId, 'pet-file-retirement')
  if (files.length !== activeReceipts.size || files.some(receipt => {
    return !activeReceipts.has(pathKey(receipt.path))
  })) {
    throw new Error('The pet ownership stamp has incomplete manifest receipts.')
  }

  const cleanupPaths = new Map()
  const addCleanupPath = (path, expectedHash) => {
    if (!path || !existsSync(path)) return
    const key = pathKey(path)
    if (cleanupPaths.has(key) && cleanupPaths.get(key).expectedHash !== expectedHash) {
      throw new Error(`Pet transaction has an ambiguous cleanup path: ${path}`)
    }
    cleanupPaths.set(key, { expectedHash, path })
  }
  for (const receipt of [...files, ...retirements]) {
    validatePetCleanupReceipt(receipt, petsDir, home)
    addCleanupPath(receipt.rollbackBackup, receipt.previousHash)
    if (receipt.temporary && existsSync(receipt.temporary)) {
      addCleanupPath(receipt.temporary, fileSha256(receipt.temporary))
    }
  }

  for (const { expectedHash, path } of cleanupPaths.values()) {
    if (!expectedHash || fileSha256(path) !== expectedHash) {
      throw new Error(`Pet cleanup artifact changed before removal: ${path}`)
    }
    unlinkSync(path)
  }
  for (const receipt of retirements) {
    removeOwnedEmptyPetDirectories(home, receipt.createdDirectories || [])
  }
}

function recoverPetFile(receipt, home) {
  assertPetReceiptPaths(home, receipt)
  if (!Object.hasOwn(receipt, 'previousHash') || !receipt.installedHash) {
    throw new Error(`Interrupted pet receipt is incomplete: ${receipt.path}`)
  }
  if (receipt.temporary && existsSync(receipt.temporary)) {
    if (fileSha256(receipt.temporary) !== receipt.installedHash) {
      throw new Error(`Interrupted pet temporary file changed: ${receipt.path}`)
    }
    unlinkSync(receipt.temporary)
  }
  const currentHash = fileSha256(receipt.path)
  if (currentHash !== receipt.previousHash) {
    if (currentHash !== receipt.installedHash) {
      throw new Error(`Interrupted pet target has later changes: ${receipt.path}`)
    }
    if (receipt.rollbackBackup && existsSync(receipt.rollbackBackup)) {
      if (fileSha256(receipt.rollbackBackup) !== receipt.previousHash) {
        throw new Error(`Interrupted pet rollback backup changed: ${receipt.path}`)
      }
      if (!receipt.temporary) {
        throw new Error(`Interrupted pet receipt has no recorded temporary path: ${receipt.path}`)
      }
      copyFileAtomically(receipt.rollbackBackup, receipt.path, receipt.temporary)
    } else if (receipt.backupCreated && receipt.backup && existsSync(receipt.backup)) {
      if (fileSha256(receipt.backup) !== receipt.previousHash) {
        throw new Error(`Interrupted pet original backup changed: ${receipt.path}`)
      }
      if (!receipt.temporary) {
        throw new Error(`Interrupted pet receipt has no recorded temporary path: ${receipt.path}`)
      }
      copyFileAtomically(receipt.backup, receipt.path, receipt.temporary)
    } else if (receipt.previousHash === null) {
      unlinkSync(receipt.path)
    } else {
      throw new Error(`Interrupted pet file has no exact rollback backup: ${receipt.path}`)
    }
  }
  if (fileSha256(receipt.path) !== receipt.previousHash) {
    throw new Error(`Interrupted pet rollback verification failed: ${receipt.path}`)
  }
  if (receipt.rollbackBackup && existsSync(receipt.rollbackBackup)) {
    if (fileSha256(receipt.rollbackBackup) !== receipt.previousHash) {
      throw new Error(`Interrupted pet rollback backup changed: ${receipt.path}`)
    }
    unlinkSync(receipt.rollbackBackup)
  }
  if (receipt.backupCreated && receipt.backup && existsSync(receipt.backup)) {
    if (fileSha256(receipt.backup) !== receipt.previousHash) {
      throw new Error(`Interrupted pet original backup changed: ${receipt.path}`)
    }
    unlinkSync(receipt.backup)
  }
  for (const directory of receipt.createdDirectories || []) {
    assertSafeManagedPath(home, directory, 'pet file created directory')
  }
  removeEmptyDirectories(receipt.createdDirectories || [])
}

function recoverInterruptedPetTransaction(home, entries, activeTransaction, nowIso) {
  const transactionId = newestPetTransaction(entries)
  if (!transactionId || transactionId === activeTransaction) return false
  const marker = [...entries].reverse().find(entry => {
    return entry.type === 'pet-transaction' && entry.transactionId === transactionId
  })
  if (marker?.state === 'committed' || marker?.state === 'rolled-back') return false

  const files = latestTransactionReceipts(entries, transactionId, 'pet-file')
  const retirements = latestTransactionReceipts(entries, transactionId, 'pet-file-retirement')
  if (files.length === 0 && retirements.length === 0) {
    appendManifest(home, { type: 'pet-transaction', state: 'rolled-back', transactionId }, nowIso)
    return true
  }

  for (const receipt of files) {
    if (receipt.state === 'rolled-back') continue
    recoverPetFile(receipt, home)
    appendManifest(home, { ...receipt, state: 'rolled-back' }, nowIso)
  }
  for (const receipt of retirements) {
    if (receipt.state === 'rolled-back') continue
    assertPetReceiptPaths(home, receipt)
    mkdirSync(dirname(receipt.path), { recursive: true })
    rollBackRetirement({ receipt }, home)
    appendManifest(home, { ...receipt, state: 'rolled-back' }, nowIso)
  }
  appendManifest(home, { type: 'pet-transaction', state: 'rolled-back', transactionId }, nowIso)
  return true
}

/** Reverse the newest uncommitted pet-file transaction, if present. */
export function recoverInterruptedPets({ home, nowIso } = {}) {
  return withHomeTransactionLock(home, () => {
    const entries = readManifest(home).entries || []
    const activeTransaction = readStamp(home)?.applied?.pets?.transactionId || null
    return recoverInterruptedPetTransaction(home, entries, activeTransaction, nowIso)
  })
}

/**
 * Install every bundled pet file and record an exact rollback receipt.
 *
 * @returns {{slugs: string[], transactionId: string}}
 */
export function installPets(bundledPetsDir, petsDir, options = {}) {
  const home = options.home || dirname(petsDir)
  const nowIso = options.nowIso
  const version = options.version
  const transactionId = randomUUID()
  const stamp = readStamp(home)
  const componentStamp = stamp?.applied?.pets || null
  const activeTransaction = componentStamp?.transactionId || null
  let entries = readManifest(home).entries || []
  if (recoverInterruptedPetTransaction(home, entries, activeTransaction, nowIso)) {
    entries = readManifest(home).entries || []
  }
  const legacyBySlug = new Map()
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.type === 'pet' && !legacyBySlug.has(entry.slug)) legacyBySlug.set(entry.slug, entry)
  }

  const slugs = readdirSync(bundledPetsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
  const nextTargets = slugs.flatMap(slug => {
    const sourceRoot = join(bundledPetsDir, slug)
    return listFiles(sourceRoot).map(sourceRelative => join(petsDir, slug, sourceRelative))
  })
  const activeReceipts = new Map()
  if (activeTransaction) {
    let receiptCount = 0
    for (const entry of [...entries].reverse()) {
      if (entry.type !== 'pet-file' || entry.state !== 'installed' ||
          entry.transactionId !== activeTransaction) continue
      receiptCount += 1
      if (typeof entry.path !== 'string') {
        throw new Error('The pet ownership stamp has incomplete manifest receipts.')
      }
      const key = pathKey(entry.path)
      if (!activeReceipts.has(key)) activeReceipts.set(key, entry)
    }
    const stampedFiles = componentStamp.files
    const stampedPathsValid = Array.isArray(stampedFiles) &&
      stampedFiles.every(path => typeof path === 'string')
    const stampedKeys = stampedPathsValid ? stampedFiles.map(pathKey) : []
    if (!stampedPathsValid || stampedKeys.length !== new Set(stampedKeys).size ||
        receiptCount !== activeReceipts.size || stampedFiles.length !== activeReceipts.size ||
        stampedFiles.some(target => !activeReceipts.has(pathKey(target)))) {
      throw new Error('The pet ownership stamp has incomplete manifest receipts.')
    }
    for (const receipt of activeReceipts.values()) validateActiveReceipt(receipt, petsDir, home)
    cleanActivePetArtifacts(home, petsDir, entries, activeTransaction, activeReceipts)
  }
  const plans = []

  for (const slug of slugs) {
    const sourceRoot = join(bundledPetsDir, slug)
    for (const sourceRelative of listFiles(sourceRoot)) {
      const source = join(sourceRoot, sourceRelative)
      const target = join(petsDir, slug, sourceRelative)
      assertSafeManagedPath(home, target, 'pet file target')
      const priorReceipt = activeTransaction ? activeReceipts.get(pathKey(target)) : null
      const currentExists = existsSync(target)
      const currentHash = currentExists ? fileSha256(target) : null
      const sourceHash = fileSha256(source)
      const legacy = legacyBySlug.get(slug)
      const adoptLegacy = Boolean(!activeTransaction && stamp?.applied?.pets && legacy &&
        !legacy.preExisting && currentHash === sourceHash)
      const managedBefore = Boolean(priorReceipt || adoptLegacy)

      if (!activeTransaction && stamp?.applied?.pets && legacy?.preExisting) {
        throw new Error(`Legacy pet ${slug} replaced pre-existing files without file backups. Preserve it and merge manually.`)
      }
      if (!activeTransaction && stamp?.applied?.pets && !managedBefore && currentExists) {
        throw new Error(`Legacy pet file changed after install: ${target}`)
      }

      const preExisting = priorReceipt ? Boolean(priorReceipt.preExisting) : managedBefore ? false : currentExists
      const backup = priorReceipt
        ? priorReceipt.backup || null
        : preExisting
          ? uniqueSiblingPath(target, 'pre-classic-gold')
          : null
      plans.push({
        currentExists,
        source,
        receipt: {
          type: 'pet-file',
          slug,
          path: target,
          backup,
          backupCreated: Boolean(!priorReceipt && preExisting && backup),
          backupHash: priorReceipt?.backupHash || null,
          createdDirectories: missingDirectories(dirname(target), home),
          installedHash: sourceHash,
          preExisting,
          previousHash: currentHash,
          rollbackBackup: currentExists ? uniqueSiblingPath(target, 'classic-gold-rollback') : null,
          source: relative(bundledPetsDir, source),
          state: 'planned',
          temporary: uniqueSiblingPath(target, 'classic-gold-next'),
          transactionId,
        },
      })
    }
  }

  const nextTargetKeys = new Set(nextTargets.map(pathKey))
  const retirements = []
  for (const priorReceipt of activeReceipts.values()) {
    if (nextTargetKeys.has(pathKey(priorReceipt.path))) continue
    retirements.push({
      receipt: {
        type: 'pet-file-retirement',
        slug: priorReceipt.slug,
        path: priorReceipt.path,
        backup: priorReceipt.backup || null,
        backupHash: priorReceipt.backupHash || null,
        createdDirectories: priorReceipt.createdDirectories || [],
        preExisting: Boolean(priorReceipt.preExisting),
        previousHash: priorReceipt.installedHash,
        restoredHash: priorReceipt.preExisting ? priorReceipt.backupHash : null,
        rollbackBackup: uniqueSiblingPath(priorReceipt.path, 'classic-gold-rollback'),
        sourceTransactionId: activeTransaction,
        state: 'planned',
        temporary: uniqueSiblingPath(priorReceipt.path, 'classic-gold-next'),
        transactionId,
      },
    })
  }

  appendManifest(home, { type: 'pet-transaction', state: 'planned', transactionId }, nowIso)
  for (const plan of plans) {
    assertPetReceiptPaths(home, plan.receipt)
    appendManifest(home, plan.receipt, nowIso)
  }
  for (const plan of retirements) {
    assertPetReceiptPaths(home, plan.receipt)
    appendManifest(home, plan.receipt, nowIso)
  }
  try {
    for (const plan of retirements) {
      applyRetirement(plan, home)
      for (const directory of plan.receipt.createdDirectories) {
        assertSafeManagedPath(home, directory, 'pet file created directory')
      }
      removeEmptyDirectories(plan.receipt.createdDirectories)
    }

    for (const plan of plans) {
      const receipt = plan.receipt
      assertPetReceiptPaths(home, receipt)
      mkdirSync(dirname(receipt.path), { recursive: true })
      if (receipt.rollbackBackup) {
        copyFileSync(receipt.path, receipt.rollbackBackup)
        if (fileSha256(receipt.rollbackBackup) !== receipt.previousHash) {
          throw new Error(`Pet file rollback backup verification failed: ${receipt.path}`)
        }
      }
      if (receipt.backupCreated && receipt.backup) {
        copyFileSync(receipt.path, receipt.backup)
        if (fileSha256(receipt.backup) !== receipt.previousHash) {
          throw new Error(`Pet file backup verification failed: ${receipt.path}`)
        }
      }
      copyFileAtomically(plan.source, receipt.path, receipt.temporary)
      if (fileSha256(receipt.path) !== receipt.installedHash) {
        throw new Error(`Pet file hash verification failed: ${receipt.path}`)
      }
    }

    for (const plan of plans) {
      const receipt = plan.receipt
      appendManifest(home, {
        ...receipt,
        backupHash: receipt.backup ? fileSha256(receipt.backup) : null,
        state: 'installed',
        temporary: null,
      }, nowIso)
    }
    for (const plan of retirements) {
      appendManifest(home, { ...plan.receipt, state: 'installed' }, nowIso)
    }
    recordApplied(home, 'pets', {
      activated: null,
      files: plans.map(plan => plan.receipt.path),
      previousSlug: null,
      slugs,
      transactionId,
    }, {
      nowIso,
      version,
    })
    try {
      appendManifest(home, { type: 'pet-transaction', state: 'committed', transactionId }, nowIso)
    } catch {
      // The active stamp also proves that this transaction committed.
    }

    for (const plan of plans) {
      const rollback = plan.receipt.rollbackBackup
      try {
        assertPetReceiptPaths(home, plan.receipt)
        if (rollback && existsSync(rollback)) {
          if (fileSha256(rollback) !== plan.receipt.previousHash) {
            throw new Error(`Pet rollback backup changed after commit: ${plan.receipt.path}`)
          }
          unlinkSync(rollback)
        }
      } catch {
        // The completed receipt keeps the cleanup path.
      }
    }
    for (const plan of retirements) {
      try {
        assertPetReceiptPaths(home, plan.receipt)
        if (existsSync(plan.receipt.rollbackBackup)) {
          if (fileSha256(plan.receipt.rollbackBackup) !== plan.receipt.previousHash) {
            throw new Error(`Pet retirement rollback backup changed after commit: ${plan.receipt.path}`)
          }
          unlinkSync(plan.receipt.rollbackBackup)
        }
        removeEmptyDirectories(plan.receipt.createdDirectories)
      } catch {
        // The completed retirement receipt keeps the cleanup path.
      }
    }
    return { slugs, transactionId }
  } catch (error) {
    let rollbackComplete = true
    for (const plan of [...plans].reverse()) {
      const receipt = plan.receipt
      try {
        assertPetReceiptPaths(home, receipt)
        if (existsSync(receipt.temporary)) {
          if (!receipt.installedHash || fileSha256(receipt.temporary) !== receipt.installedHash) {
            throw new Error(`Pet file temporary changed: ${receipt.path}`)
          }
          unlinkSync(receipt.temporary)
        }
        if (receipt.rollbackBackup && existsSync(receipt.rollbackBackup)) {
          if (fileSha256(receipt.rollbackBackup) !== receipt.previousHash) {
            throw new Error(`Pet file rollback backup changed: ${receipt.path}`)
          }
          const currentHash = fileSha256(receipt.path)
          if (currentHash !== receipt.previousHash) {
            if (currentHash !== receipt.installedHash) {
              throw new Error(`Pet file changed before rollback: ${receipt.path}`)
            }
            copyFileAtomically(receipt.rollbackBackup, receipt.path, receipt.temporary)
          }
          if (fileSha256(receipt.path) !== receipt.previousHash) {
            throw new Error(`Pet file rollback verification failed: ${receipt.path}`)
          }
          unlinkSync(receipt.rollbackBackup)
        } else if (plan.currentExists) {
          if (fileSha256(receipt.path) !== receipt.previousHash) {
            throw new Error(`Pet file changed during rollback: ${receipt.path}`)
          }
        } else if (!plan.currentExists && fileSha256(receipt.path) === receipt.installedHash) {
          unlinkSync(receipt.path)
        } else if (fileSha256(receipt.path) !== null) {
          throw new Error(`New pet file changed during rollback: ${receipt.path}`)
        }
        if (receipt.backupCreated && receipt.backup && existsSync(receipt.backup)) {
          if (fileSha256(receipt.backup) !== receipt.previousHash) {
            throw new Error(`Pet file backup changed during rollback: ${receipt.path}`)
          }
          unlinkSync(receipt.backup)
        }
        removeEmptyDirectories(receipt.createdDirectories)
        appendManifest(home, { ...receipt, state: 'rolled-back' }, nowIso)
      } catch {
        rollbackComplete = false
        // The planned receipt remains available for a later safe uninstall.
      }
    }
    for (const plan of [...retirements].reverse()) {
      try {
        assertPetReceiptPaths(home, plan.receipt)
        mkdirSync(dirname(plan.receipt.path), { recursive: true })
        rollBackRetirement(plan, home)
        appendManifest(home, { ...plan.receipt, state: 'rolled-back' }, nowIso)
      } catch {
        rollbackComplete = false
        // The planned retirement receipt remains available for safe recovery.
      }
    }
    if (rollbackComplete) {
      try {
        appendManifest(home, { type: 'pet-transaction', state: 'rolled-back', transactionId }, nowIso)
      } catch {
        // Individual rolled-back receipts still describe the recovered state.
      }
    }
    throw error
  }
}
