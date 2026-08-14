#!/usr/bin/env node
// Prepare a legacy source install for the update-safe Classic Gold plug-in.
// This phase restores only files with a clean .orig file and exact ownership proof.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

import { resolveAgentRepo } from '../lib/agent-repo.mjs'
import { gitBlobHash, headBlobHash, indexBlobHash } from '../lib/git-blob.mjs'
import { findHermesHomes, resolveHermesHome } from '../lib/hermes-home.mjs'
import {
  appendManifest,
  clearApplied,
  readManifest,
  readStamp,
  recordApplied,
  TIER_SENTINELS,
  withHomeTransactionLock,
} from '../lib/pack-stamp.mjs'
import { knownLegacyPaths } from '../lib/legacy-targets.mjs'
import { assertSafeManagedPath } from '../lib/path-safety.mjs'
import { copyFileAtomically, fileSha256, uniqueSiblingPath } from '../lib/file-integrity.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const MIGRATION_DIR = '.classic-gold-migration'
const MIGRATION_KEY = 'legacyMigration'

function parseArgs(argv) {
  const args = { dryRun: false, home: undefined, repo: undefined, yes: false, unsupported: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--home' || argv[i] === '--repo') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) {
        args.unsupported.push(`${argv[i]} requires a value`)
        continue
      }
      if (argv[i] === '--home') args.home = value
      else args.repo = value
      i += 1
    }
    else if (argv[i] === '--dry-run' || argv[i] === '--plan') args.dryRun = true
    else if (argv[i] === '--yes' || argv[i] === '-y') args.yes = true
    else args.unsupported.push(argv[i])
  }
  return args
}

function currentHead(repo) {
  try {
    return execFileSync('git', gitArgs(repo, ['rev-parse', 'HEAD']), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return null
  }
}

function gitArgs(repo, args) {
  const safeRepo = repo.replaceAll('\\', '/')
  return ['-c', `safe.directory=${safeRepo}`, '-C', repo, ...args]
}

function walkFiles(root, prefix = '') {
  if (!existsSync(root)) return []
  const files = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...walkFiles(join(root, entry.name), rel))
    else if (entry.isFile()) files.push(rel)
  }
  return files
}

function latestFiles(entries) {
  const seen = new Set()
  const files = []
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry.type !== 'file' || seen.has(entry.rel)) continue
    seen.add(entry.rel)
    files.push(entry)
  }
  return files
}

function hasLegacySentinel(repo) {
  return Object.values(TIER_SENTINELS).some(({ file, marker }) => {
    try {
      return readFileSync(join(repo, file), 'utf8').includes(marker)
    } catch {
      return false
    }
  })
}

function exactHeadBackup(repo, rel, orig) {
  const expected = headBlobHash(repo, rel)
  const original = gitBlobHash(repo, orig, { asPath: rel })
  return Boolean(expected && original && expected === original)
}

function changedFromHead(repo, rel) {
  const expected = headBlobHash(repo, rel)
  const current = gitBlobHash(repo, rel, { asPath: rel })
  return Boolean(expected && current !== expected)
}

function bundledLegacyBlobs(repo) {
  const blobs = new Map()
  const tierRoots = [
    join(ROOT, 'advanced', 'statusbar', 'baselines'),
    join(ROOT, 'advanced', 'extras-caduceus', 'baselines')
  ]

  for (const tierRoot of tierRoots) {
    if (!existsSync(tierRoot)) continue
    for (const baseline of readdirSync(tierRoot, { withFileTypes: true })) {
      if (!baseline.isDirectory()) continue
      const filesRoot = join(tierRoot, baseline.name, 'files')
      for (const rel of walkFiles(filesRoot)) {
        const blob = gitBlobHash(repo, join(filesRoot, rel), { asPath: rel })
        if (!blob) continue
        if (!blobs.has(rel)) blobs.set(rel, new Set())
        blobs.get(rel).add(blob)
      }
    }
  }
  return blobs
}

function exactInstalledLegacy(repo, entry, knownBlobs) {
  const current = gitBlobHash(repo, entry.rel, { asPath: entry.rel })
  if (!current) return false
  if (entry.installedBlob) return current === entry.installedBlob
  return Boolean(knownBlobs.get(entry.rel)?.has(current))
}

function indexMatchesHead(repo, entry) {
  const staged = indexBlobHash(repo, entry.rel)
  const head = headBlobHash(repo, entry.rel)
  return Boolean(staged && head && staged === head)
}

function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const a = resolve(left)
  const b = resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function isInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function validBlobHash(value) {
  return typeof value === 'string' && /^[0-9a-f]{40,64}$/.test(value)
}

function rollbackRoot(home, transactionId) {
  return join(home, MIGRATION_DIR, transactionId)
}

function validateRollbackDirectory(home, transactionId) {
  assertSafeManagedPath(home, join(home, MIGRATION_DIR), 'migration rollback directory')
  assertSafeManagedPath(home, rollbackRoot(home, transactionId), 'migration rollback transaction directory')
}

function validateMigrationPaths(home, repo, transactionId, plans) {
  validateRollbackDirectory(home, transactionId)
  for (const plan of plans) {
    assertSafeManagedPath(repo, plan.path, 'migration source target')
    assertSafeManagedPath(repo, plan.orig, 'migration source backup')
    assertSafeManagedPath(repo, plan.temporary, 'migration source temporary file')
    assertSafeManagedPath(home, plan.rollback, 'migration rollback file')
  }
}

function migrationPlan(home, repo, entries, transactionId) {
  const root = rollbackRoot(home, transactionId)
  return entries.map((entry, index) => {
    const path = join(repo, entry.rel)
    const orig = join(repo, entry.orig)
    return {
      rel: entry.rel,
      path,
      orig,
      rollback: join(root, `${String(index).padStart(4, '0')}.rollback`),
      temporary: uniqueSiblingPath(path, 'classic-gold-migration-next'),
      previousHash: gitBlobHash(repo, path, { asPath: entry.rel }),
      restoredHash: headBlobHash(repo, entry.rel),
    }
  })
}

function validateMigrationPlan(home, repo, transactionId, plans, knownPaths) {
  if (!/^[0-9a-f-]{36}$/i.test(transactionId) || !Array.isArray(plans)) {
    throw new Error('The active migration stamp is invalid.')
  }
  const root = rollbackRoot(home, transactionId)
  validateRollbackDirectory(home, transactionId)
  const seen = new Set()
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index]
    const expectedPath = join(repo, plan?.rel || '')
    const expectedOrig = join(repo, `${plan?.rel || ''}.orig`)
    const expectedRollback = join(root, `${String(index).padStart(4, '0')}.rollback`)
    if (
      typeof plan?.rel !== 'string' ||
      !knownPaths.has(plan.rel) ||
      seen.has(plan.rel) ||
      !samePath(plan.path, expectedPath) ||
      !samePath(plan.orig, expectedOrig) ||
      !samePath(plan.rollback, expectedRollback) ||
      !samePath(dirname(plan.temporary), dirname(expectedPath)) ||
      !basename(plan.temporary).startsWith(`${basename(expectedPath)}.classic-gold-migration-next-`) ||
      !isInside(repo, plan.path) ||
      !isInside(repo, plan.orig) ||
      !isInside(repo, plan.temporary) ||
      !isInside(root, plan.rollback) ||
      !validBlobHash(plan.previousHash) ||
      !validBlobHash(plan.restoredHash)
    ) {
      throw new Error('The active migration stamp contains an unsafe file plan.')
    }
    seen.add(plan.rel)
  }
  validateMigrationPaths(home, repo, transactionId, plans)
}

function transactionEntries(home, transactionId) {
  return (readManifest(home).entries || []).filter(entry => {
    return entry.type === 'legacy-migration-file' && entry.transactionId === transactionId
  })
}

function stateByPath(entries, state) {
  return new Set(entries.filter(entry => entry.state === state).map(entry => entry.rel))
}

function receiptMatchesPlan(receipt, plan, transactionId) {
  return receipt.transactionId === transactionId &&
    receipt.rel === plan.rel &&
    samePath(receipt.path, plan.path) &&
    samePath(receipt.orig, plan.orig) &&
    samePath(receipt.rollback, plan.rollback) &&
    samePath(receipt.temporary, plan.temporary) &&
    receipt.previousHash === plan.previousHash &&
    receipt.restoredHash === plan.restoredHash
}

function appendMigrationReceipt(home, transactionId, plan, state) {
  appendManifest(home, {
    type: 'legacy-migration-file',
    ...plan,
    transactionId,
    state,
  })
}

function cleanupRollbacks(home, transactionId, plans, repo) {
  validateMigrationPaths(home, repo, transactionId, plans)
  for (const plan of plans) {
    if (existsSync(plan.temporary)) {
      const temporaryHash = gitBlobHash(repo, plan.temporary, { asPath: plan.rel })
      if (![plan.previousHash, plan.restoredHash].includes(temporaryHash)) {
        throw new Error(`The migration temporary file changed: ${plan.rel}`)
      }
      unlinkSync(plan.temporary)
    }
    if (!existsSync(plan.rollback)) continue
    const backupHash = gitBlobHash(repo, plan.rollback, { asPath: plan.rel })
    if (backupHash !== plan.previousHash) {
      throw new Error(`The migration rollback copy changed: ${plan.rel}`)
    }
    unlinkSync(plan.rollback)
  }
  try {
    rmdirSync(rollbackRoot(home, transactionId))
  } catch {
    // Keep a nonempty directory. It can contain data that this transaction does not own.
  }
  try {
    rmdirSync(join(home, MIGRATION_DIR))
  } catch {
    // Keep the shared migration directory when another transaction still uses it.
  }
}

function rollbackMigration(home, repo, transactionId, plans) {
  validateMigrationPaths(home, repo, transactionId, plans)
  const alreadyRolledBack = stateByPath(transactionEntries(home, transactionId), 'rolled-back')
  const checks = plans.map(plan => {
    const currentHash = gitBlobHash(repo, plan.path, { asPath: plan.rel })
    const backupHash = existsSync(plan.rollback)
      ? gitBlobHash(repo, plan.rollback, { asPath: plan.rel })
      : null
    if (currentHash !== plan.previousHash && currentHash !== plan.restoredHash) {
      throw new Error(`A source file changed during migration: ${plan.rel}`)
    }
    if (currentHash === plan.restoredHash && backupHash !== plan.previousHash) {
      throw new Error(`A migration rollback copy is missing: ${plan.rel}`)
    }
    return { plan, currentHash, backupHash }
  })

  for (const { plan, currentHash, backupHash } of checks.reverse()) {
    validateMigrationPaths(home, repo, transactionId, [plan])
    if (currentHash === plan.restoredHash) {
      if (existsSync(plan.temporary)) {
        const temporaryHash = gitBlobHash(repo, plan.temporary, { asPath: plan.rel })
        if (temporaryHash !== plan.previousHash) {
          throw new Error(`The migration rollback temporary file changed: ${plan.rel}`)
        }
        unlinkSync(plan.temporary)
      }
      copyFileAtomically(plan.rollback, plan.path, plan.temporary)
      const restored = gitBlobHash(repo, plan.path, { asPath: plan.rel })
      if (restored !== plan.previousHash) {
        throw new Error(`Migration rollback verification failed: ${plan.rel}`)
      }
    } else if (existsSync(plan.rollback) && backupHash !== plan.previousHash) {
      // The target still has its prior bytes. A partial backup cannot be needed.
      unlinkSync(plan.rollback)
    }
    if (!alreadyRolledBack.has(plan.rel)) {
      appendMigrationReceipt(home, transactionId, plan, 'rolled-back')
    }
  }
  cleanupRollbacks(home, transactionId, plans, repo)
  clearApplied(home, MIGRATION_KEY)
}

function finishMigration(home, repo, transactionId, plans) {
  validateMigrationPaths(home, repo, transactionId, plans)
  for (const plan of plans) {
    const currentHash = gitBlobHash(repo, plan.path, { asPath: plan.rel })
    if (currentHash !== plan.restoredHash) {
      throw new Error(`A restored source file changed before migration completed: ${plan.rel}`)
    }
  }
  cleanupRollbacks(home, transactionId, plans, repo)
  clearApplied(home, 'statusbar')
  clearApplied(home, 'caduceus')
  clearApplied(home, MIGRATION_KEY)
}

function recoverMigration(home, repo, knownPaths) {
  const active = readStamp(home)?.applied?.[MIGRATION_KEY]
  if (!active) return false
  if (!samePath(active.repo, repo)) {
    throw new Error('The active migration belongs to a different Hermes checkout.')
  }
  const { transactionId, phase, files: plans } = active
  validateMigrationPlan(home, repo, transactionId, plans, knownPaths)
  const entries = transactionEntries(home, transactionId)
  const planned = stateByPath(entries, 'planned')
  const completed = stateByPath(entries, 'completed')
  const rolledBack = stateByPath(entries, 'rolled-back')
  for (const plan of plans) {
    for (const state of ['planned', 'completed', 'rolled-back']) {
      const receipts = entries.filter(entry => entry.rel === plan.rel && entry.state === state)
      if (receipts.length > 1 || receipts.some(entry => !receiptMatchesPlan(entry, plan, transactionId))) {
        throw new Error('The active migration has an invalid file receipt.')
      }
    }
  }
  if (entries.some(entry => {
    const plan = plans.find(candidate => candidate.rel === entry.rel)
    return !plan || !['planned', 'completed', 'rolled-back'].includes(entry.state) ||
      !receiptMatchesPlan(entry, plan, transactionId)
  })) {
    throw new Error('The active migration has an unknown file receipt.')
  }

  if (phase === 'planning') {
    for (const plan of plans) {
      const currentHash = gitBlobHash(repo, plan.path, { asPath: plan.rel })
      if (currentHash !== plan.previousHash) {
        throw new Error(`A source file changed while migration planning stopped: ${plan.rel}`)
      }
    }
    for (const plan of plans.filter(plan => planned.has(plan.rel) && !rolledBack.has(plan.rel))) {
      appendMigrationReceipt(home, transactionId, plan, 'rolled-back')
    }
    cleanupRollbacks(home, transactionId, plans, repo)
    clearApplied(home, MIGRATION_KEY)
    return true
  }

  if (phase !== 'ready' || planned.size !== plans.length) {
    throw new Error('The active migration does not have a complete plan.')
  }
  if (completed.size === plans.length && rolledBack.size === 0) {
    finishMigration(home, repo, transactionId, plans)
    return true
  }
  rollbackMigration(home, repo, transactionId, plans)
  return true
}

/**
 * Restore legacy files in one rollback-safe transaction.
 * @param {string} home HERMES_HOME.
 * @param {string} repo Hermes Agent checkout.
 * @param {Array<object>} entries Verified legacy file receipts.
 * @param {object} [hooks] Test hooks.
 * @param {(plan: object) => void} [hooks.afterBackup] Called after an exact rollback copy.
 * @param {(plan: object) => void} [hooks.afterRestore] Called after an exact restore.
 */
export function executeMigration(
  home,
  repo,
  entries,
  { afterBackup = () => {}, afterRestore = () => {} } = {},
) {
  if (entries.length === 0) {
    clearApplied(home, 'statusbar')
    clearApplied(home, 'caduceus')
    return
  }
  const transactionId = randomUUID()
  const plans = migrationPlan(home, repo, entries, transactionId)
  validateMigrationPlan(home, repo, transactionId, plans, new Set(knownLegacyPaths(ROOT)))
  recordApplied(home, MIGRATION_KEY, {
    transactionId,
    phase: 'planning',
    repo: resolve(repo),
    files: plans,
  })
  try {
    for (const plan of plans) appendMigrationReceipt(home, transactionId, plan, 'planned')
    recordApplied(home, MIGRATION_KEY, {
      transactionId,
      phase: 'ready',
      repo: resolve(repo),
      files: plans,
    })
    validateMigrationPaths(home, repo, transactionId, plans)
    mkdirSync(rollbackRoot(home, transactionId), { recursive: true })
    for (const plan of plans) {
      validateMigrationPaths(home, repo, transactionId, [plan])
      if (indexBlobHash(repo, plan.rel) !== plan.restoredHash) {
        throw new Error(`The Git index changed during migration: ${plan.rel}`)
      }
      if (gitBlobHash(repo, plan.path, { asPath: plan.rel }) !== plan.previousHash) {
        throw new Error(`The source file changed during migration: ${plan.rel}`)
      }
      if (gitBlobHash(repo, plan.orig, { asPath: plan.rel }) !== plan.restoredHash) {
        throw new Error(`The source backup changed during migration: ${plan.rel}`)
      }
      copyFileSync(plan.path, plan.rollback)
      if (gitBlobHash(repo, plan.rollback, { asPath: plan.rel }) !== plan.previousHash) {
        throw new Error(`Migration rollback copy verification failed: ${plan.rel}`)
      }
      afterBackup(plan)
      validateMigrationPaths(home, repo, transactionId, [plan])
      if (existsSync(plan.temporary)) {
        if (fileSha256(plan.temporary) !== fileSha256(plan.orig)) {
          throw new Error(`The migration temporary file changed: ${plan.rel}`)
        }
        unlinkSync(plan.temporary)
      }
      copyFileAtomically(plan.orig, plan.path, plan.temporary)
      if (gitBlobHash(repo, plan.path, { asPath: plan.rel }) !== plan.restoredHash) {
        throw new Error(`Migration restore verification failed: ${plan.rel}`)
      }
      afterRestore(plan)
      appendMigrationReceipt(home, transactionId, plan, 'completed')
    }
    finishMigration(home, repo, transactionId, plans)
  } catch (error) {
    try {
      rollbackMigration(home, repo, transactionId, plans)
    } catch (rollbackError) {
      throw new Error(`${error.message}\nRollback also stopped: ${rollbackError.message}`)
    }
    throw error
  }
}

function confirm(question) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, answer => {
      rl.close()
      resolve(/^y/i.test(answer.trim()))
    })
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.unsupported.length > 0) {
    console.error(`✗ Unsupported or incomplete option: ${args.unsupported.join(', ')}`)
    return 1
  }
  if (!args.home) {
    const homes = findHermesHomes()
    if (homes.length > 1) {
      console.error('✗ More than one Hermes install has a config.yaml. Migration will not guess:')
      for (const candidate of homes) console.error(`  - ${candidate}`)
      console.error('  Re-run with --home <path> and --repo <path>.')
      return 1
    }
  }
  const home = resolveHermesHome({ explicit: args.home })
  if (!home) {
    console.error('✗ Could not find HERMES_HOME. Pass --home <path>.')
    return 1
  }
  return withHomeTransactionLock(home, async () => {

  const repo = resolveAgentRepo({ explicit: args.repo, home })
  if (!args.repo && !samePath(repo, join(home, 'hermes-agent'))) {
    console.error('Error: The selected repository is not associated with HERMES_HOME.')
    console.error('  For an external checkout, pass both --home <path> and --repo <path>.')
    return 1
  }
  if (!existsSync(join(repo, 'apps', 'desktop'))) {
    console.error(`✗ Not a hermes-agent checkout: ${repo}`)
    return 1
  }

  const head = currentHead(repo)
  const knownPaths = new Set(knownLegacyPaths(ROOT))
  const pendingMigration = Boolean(readStamp(home)?.applied?.[MIGRATION_KEY])
  if (!args.dryRun && pendingMigration && !args.yes) {
    if (!process.stdin.isTTY) {
      console.error('\n✗ Refusing to recover an interrupted migration non-interactively without --yes.')
      return 1
    }
    if (!(await confirm(`Recover the interrupted migration in this Hermes profile? ${home} [y/N] `))) {
      console.log('Aborted. No recovery write was made.')
      return 0
    }
  }
  if (!args.dryRun) {
    try {
      if (recoverMigration(home, repo, knownPaths)) {
        console.log('Recovered an interrupted Classic Gold migration transaction.')
      }
    } catch (error) {
      console.error(`Could not recover the interrupted migration: ${error.message}`)
      console.error('No unproved source file was changed. Inspect the active migration receipts.')
      return 1
    }
  } else if (readStamp(home)?.applied?.legacyMigration) {
    console.log('  - pending migration recovery: report only; no recovery write in dry-run mode')
  }
  const stamp = readStamp(home)
  const legacyRecorded = Boolean(stamp?.applied?.statusbar || stamp?.applied?.caduceus)
  const legacyPresent = hasLegacySentinel(repo)
  const knownBlobs = bundledLegacyBlobs(repo)
  const rawFiles = legacyRecorded || legacyPresent ? latestFiles(readManifest(home).entries || []) : []
  const invalidReceipts = rawFiles.filter(entry => {
    return typeof entry.rel !== 'string' || !knownPaths.has(entry.rel) || entry.orig !== `${entry.rel}.orig`
  })
  if (invalidReceipts.length > 0) {
    console.error('✗ The legacy manifest contains a path outside the known Classic Gold targets.')
    console.error('  No source file was changed. Inspect the manifest before migration.')
    return 1
  }
  const files = rawFiles
  const changedFiles = files.filter(entry => changedFromHead(repo, entry.rel))
  const receiptRestorable = changedFiles.filter(entry => {
    const sameHead = !entry.agentHead || Boolean(head && entry.agentHead === head)
    const safeMethod = entry.method !== 'copy' && entry.method !== 'reconciled'
    return sameHead && safeMethod && exactHeadBackup(repo, entry.rel, entry.orig) &&
      exactInstalledLegacy(repo, entry, knownBlobs)
  })
  const receiptManual = changedFiles.filter(entry => !receiptRestorable.includes(entry))

  // A hand-reconciled install can have a stale manifest. Recover it only when
  // the .orig file equals HEAD and the live file equals a bundled Pack payload.
  // These two exact-blob proofs protect unrelated changes in the checkout.
  const discovered = []
  const discoveredManual = []
  if (legacyRecorded || legacyPresent) {
    for (const rel of knownPaths) {
      if (!existsSync(join(repo, rel)) || !changedFromHead(repo, rel)) continue
      const orig = `${rel}.orig`
      const entry = { rel, orig, agentHead: head, method: 'verified-orig' }
      if (existsSync(join(repo, orig)) && exactHeadBackup(repo, rel, orig) &&
          exactInstalledLegacy(repo, entry, knownBlobs)) discovered.push(entry)
      else discoveredManual.push(entry)
    }
  }

  const restorableByPath = new Map()
  for (const entry of [...receiptRestorable, ...discovered]) restorableByPath.set(entry.rel, entry)
  const manualByPath = new Map()
  for (const entry of [...receiptManual, ...discoveredManual]) {
    if (!restorableByPath.has(entry.rel)) manualByPath.set(entry.rel, entry)
  }
  const restorable = [...restorableByPath.values()]
  const unsafeIndex = restorable.filter(entry => !indexMatchesHead(repo, entry))
  const manual = [...new Set([...manualByPath.values(), ...unsafeIndex])]
  const safeRestorable = restorable.filter(entry => !unsafeIndex.includes(entry))

  if ((legacyRecorded || legacyPresent) && files.length === 0 && safeRestorable.length === 0) {
    console.error('✗ Legacy Gold source edits are present, but no change manifest can restore them safely.')
    console.error('  Use ai/repair.md or restore the Hermes checkout before this migration.')
    return 1
  }
  if (manual.length > 0) {
    console.error('✗ Migration stopped before any write. These source files do not have safe same-version backups:')
    for (const entry of manual) console.error(`  - ${entry.rel}`)
    console.error('  Use ai/repair.md. Do not force a restore across Hermes versions.')
    return 1
  }
  if (legacyPresent && safeRestorable.length === 0) {
    console.error('✗ A legacy source marker is present, but no exact Pack-owned file can be restored.')
    console.error('  Use ai/repair.md; this migration will not copy an unverified backup.')
    return 1
  }

  console.log('▶ Classic Gold migration plan')
  console.log(`  • restore ${safeRestorable.length} legacy source file(s) from recorded .orig backups`)
  console.log('  • clear only the restored legacy source receipts')
  console.log('  • do not install the run-time plug-in before Hermes has a clean build')

  if (args.dryRun) {
    console.log('\n(--dry-run: nothing changed.)')
    return 0
  }
  if (!args.yes && !pendingMigration) {
    if (!process.stdin.isTTY) {
      console.error('\n✗ Refusing to migrate non-interactively without --yes.')
      return 1
    }
    if (!(await confirm('\nProceed with migration? [y/N] '))) return 0
  }

  try {
    executeMigration(home, repo, safeRestorable)
  } catch (error) {
    console.error(`✗ Migration failed: ${error.message}`)
    console.error('  The command restored prior bytes when it could prove a safe rollback.')
    return 1
  }

  console.log('✓ Removed all safely recorded legacy source patches from the checkout.')
  console.log('  Next: run `hermes update`, then run `node install.mjs`.')
  console.log('  Restart Hermes Desktop only after both commands finish.')
  return 0
  })
}

if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  main().then(code => process.exit(code))
}
