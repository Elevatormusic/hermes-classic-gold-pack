#!/usr/bin/env node
// uninstall.mjs — reverse a Classic Gold install using the change manifest
// (HERMES_HOME/hermes-classic-gold-pack.manifest.json), so it restores YOUR real
// prior state (theme, mode, pets, config, source files) instead of guessing.
//
//   node scripts/uninstall.mjs [--home <path>] [--repo <path>]
//                              [--dry-run] [--no-build] [--theme-cleaned] [--yes]
//
// Safety: a source file is auto-restored ONLY from a same-version .orig backup.
// If it was applied by full-copy/reconcile or against a different Hermes HEAD,
// it's left alone and you're pointed to ai/repair.md (Issue #3 §4).
import { existsSync, readFileSync, rmSync, rmdirSync, unlinkSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { dirname as urlDirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { findHermesHomes, resolveHermesHome } from '../lib/hermes-home.mjs'
import {
  appendManifest,
  readStamp,
  readManifest,
  clearApplied,
  manifestPath,
  withHomeTransactionLock,
} from '../lib/pack-stamp.mjs'
import { resolveAgentRepo } from '../lib/agent-repo.mjs'
import {
  PLUGIN_BACKEND_FILES,
  pluginBackendRoot,
  pluginConfigState,
  recoverInterruptedPluginBackend,
  setPluginConfigState,
} from '../lib/plugin-backend.mjs'
import { desktopPluginPath, recoverInterruptedDesktopPlugin } from '../lib/desktop-plugin.mjs'
import { petConfigBlock, replacePetConfigBlock } from '../lib/config-edit.mjs'
import { copyFileAtomically, fileSha256, sha256, uniqueSiblingPath, writeTextAtomically } from '../lib/file-integrity.mjs'
import { gitBlobHash, headBlobHash } from '../lib/git-blob.mjs'
import { knownLegacyPaths } from '../lib/legacy-targets.mjs'
import { assertSafeManagedPath } from '../lib/path-safety.mjs'
import { recoverInterruptedPets } from '../lib/pets.mjs'
import { recoverPendingPetConfig } from '../lib/pet-config.mjs'

const ROOT = join(urlDirname(fileURLToPath(import.meta.url)), '..')
const PACK_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

function parseArgs(argv) {
  const a = {
    home: undefined, repo: undefined, dryRun: false, build: true,
    themeCleaned: false, yes: false, unsupported: [],
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--home' || argv[i] === '--repo') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) {
        a.unsupported.push(`${argv[i]} requires a value`)
        continue
      }
      if (argv[i] === '--home') a.home = value
      else a.repo = value
      i += 1
    }
    else if (argv[i] === '--dry-run' || argv[i] === '--plan') a.dryRun = true
    else if (argv[i] === '--no-build') a.build = false
    else if (argv[i] === '--theme-cleaned') a.themeCleaned = true
    else if (argv[i] === '--yes' || argv[i] === '-y') a.yes = true
    else a.unsupported.push(argv[i])
  }
  return a
}

function confirm(q) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(q, (ans) => {
      rl.close()
      resolve(/^y/i.test(ans.trim()))
    })
  })
}

/** Newest-first, one entry per key — the manifest is append-only, so a re-run
 *  can have several rows per file/config; we act on the latest. */
function latestByKey(entries, type, keyFn) {
  const seen = new Set()
  const out = []
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.type !== type) continue
    const k = keyFn(e)
    if (seen.has(k)) continue
    seen.add(k)
    if (e.state === 'rolled-back') continue
    out.push(e)
  }
  return out
}

function latestForTransaction(entries, type, keyFn, transactionId) {
  const scoped = transactionId
    ? entries.filter(entry => entry.transactionId === transactionId)
    : entries.filter(entry => !entry.transactionId)
  return latestByKey(scoped, type, keyFn)
}

function pathKey(path) {
  const value = resolve(path)
  return process.platform === 'win32' ? value.toLowerCase() : value
}

function samePath(left, right) {
  return Boolean(left && right && pathKey(left) === pathKey(right))
}

function inside(root, path) {
  if (!root || !path) return false
  const rel = relative(resolve(root), resolve(path))
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
}

function validSibling(path, target, label) {
  if (!path) return true
  return samePath(dirname(path), dirname(target)) && basename(path).startsWith(`${basename(target)}.${label}`)
}

function validRemovalSibling(path, target) {
  return Boolean(path) && samePath(dirname(path), dirname(target)) &&
    basename(path).startsWith(`${basename(target)}.classic-gold-uninstall-next-`)
}

function sourceTransactions(applied) {
  return {
    desktopPlugin: applied.desktopPlugin?.transactionId || null,
    petConfig: applied.petConfig?.transactionId || null,
    pets: applied.pets?.transactionId || null,
    pluginBackend: applied.pluginBackend?.transactionId || null,
  }
}

function configPlanKey(type, path) {
  return `${type}:${pathKey(path)}`
}

function latestPendingUninstall(entries) {
  const latest = [...entries].reverse().find(entry => entry.type === 'uninstall')
  return latest?.state === 'planned' ? latest : null
}

function exactLegacyThemeReceipt(appliedTheme, receipt) {
  if (!appliedTheme || !receipt || typeof receipt.priorTheme !== 'string' || !receipt.priorTheme) return null
  for (const key of ['value', 'mode', 'priorTheme', 'priorMode']) {
    const left = appliedTheme[key]
    const right = receipt[key]
    if ((left !== undefined || right !== undefined) && left !== right) return null
  }
  return receipt
}

function assertExactKeys(actual, expected, label) {
  if (!actual || Array.isArray(actual) || typeof actual !== 'object') {
    throw new Error(`The pending uninstall ${label} is invalid.`)
  }
  const actualKeys = Object.keys(actual).sort()
  const expectedKeys = Object.keys(expected).sort()
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error(`The pending uninstall ${label} does not match the active install.`)
  }
  for (const key of expectedKeys) {
    if (actual[key] !== expected[key]) {
      throw new Error(`The pending uninstall ${label} does not match the active install.`)
    }
  }
}

function assertPendingUninstall({
  home,
  repo,
  pending,
  expectedSources,
  managedFiles,
  configDescriptors,
  legacyFiles,
}) {
  if (!pending || pending.type !== 'uninstall' || pending.state !== 'planned' ||
      typeof pending.transactionId !== 'string' || !pending.transactionId) {
    throw new Error('The pending uninstall receipt is invalid.')
  }
  assertExactKeys(pending.sourceTransactions, expectedSources, 'source transactions')

  if (!Array.isArray(pending.files) || pending.files.length !== managedFiles.length) {
    throw new Error('The pending uninstall managed target set does not match the active install.')
  }
  const expectedManaged = new Map(managedFiles.map(entry => [pathKey(entry.path), entry]))
  const seenManaged = new Set()
  for (const plan of pending.files) {
    const key = typeof plan?.path === 'string' ? pathKey(plan.path) : ''
    const entry = expectedManaged.get(key)
    if (!entry || seenManaged.has(key) ||
        plan.installedHash !== (entry.installedHash || null) ||
        plan.backupHash !== (entry.backupHash || null) ||
        plan.preExisting !== Boolean(entry.preExisting) ||
        !validRemovalSibling(plan.temporary, entry.path)) {
      throw new Error('The pending uninstall managed target set does not match the active install.')
    }
    assertSafeManagedPath(home, plan.path, 'pending uninstall managed target')
    assertSafeManagedPath(home, plan.temporary, 'pending uninstall managed temporary file')
    if (existsSync(plan.temporary)) {
      const expectedHash = plan.preExisting ? plan.backupHash : null
      if (!expectedHash || fileSha256(plan.temporary) !== expectedHash) {
        throw new Error('A pending uninstall managed temporary file changed after it was created.')
      }
    }
    seenManaged.add(key)
  }

  if (!Array.isArray(pending.configs) || pending.configs.length !== configDescriptors.length) {
    throw new Error('The pending uninstall config target set does not match the active install.')
  }
  const checkpoints = new Map()
  for (let index = 0; index < configDescriptors.length; index += 1) {
    const descriptor = configDescriptors[index]
    const plan = pending.configs[index]
    if (!plan || plan.type !== descriptor.type || !samePath(plan.path, descriptor.path) ||
        typeof plan.currentHash !== 'string' || typeof plan.restoredHash !== 'string' ||
        !validRemovalSibling(plan.temporary, descriptor.path)) {
      throw new Error('The pending uninstall config target set does not match the active install.')
    }
    assertSafeManagedPath(home, plan.path, 'pending uninstall config target')
    assertSafeManagedPath(home, plan.temporary, 'pending uninstall config temporary file')
    const key = pathKey(plan.path)
    const chain = checkpoints.get(key) || []
    if (chain.length > 0 && chain.at(-1).restoredHash !== plan.currentHash) {
      throw new Error('The pending uninstall config hash chain is invalid.')
    }
    chain.push(plan)
    checkpoints.set(key, chain)
    if (existsSync(plan.temporary) && fileSha256(plan.temporary) !== plan.restoredHash) {
      throw new Error('A pending uninstall config temporary file changed after it was created.')
    }
  }
  for (const chain of checkpoints.values()) {
    const path = chain[0].path
    const currentHash = fileSha256(path)
    const checkpoint = chain.findIndex(plan => plan.currentHash === currentHash)
    const completed = chain.at(-1).restoredHash === currentHash
    if (checkpoint < 0 && !completed) {
      throw new Error(`The pending uninstall config changed after planning: ${path}`)
    }
    if (checkpoint >= 0) {
      let text = readFileSync(path, 'utf8')
      for (let index = checkpoint; index < chain.length; index += 1) {
        const descriptor = configDescriptors.find(item => {
          return item.type === chain[index].type && samePath(item.path, path)
        })
        if (!descriptor || sha256(Buffer.from(text, 'utf8')) !== chain[index].currentHash) {
          throw new Error('The pending uninstall config hash chain is invalid.')
        }
        text = descriptor.restore(text)
        if (sha256(Buffer.from(text, 'utf8')) !== chain[index].restoredHash) {
          throw new Error('The pending uninstall config result does not match its receipt.')
        }
      }
    }
  }

  if (!Array.isArray(pending.legacyFiles) || pending.legacyFiles.length !== legacyFiles.length) {
    throw new Error('The pending uninstall legacy target set does not match the active install.')
  }
  const expectedLegacy = new Map(legacyFiles.map(entry => [entry.rel, entry]))
  const seenLegacy = new Set()
  for (const plan of pending.legacyFiles) {
    const entry = expectedLegacy.get(plan?.rel)
    const target = entry && repo ? join(repo, entry.rel) : null
    const original = entry && repo ? join(repo, entry.orig) : null
    const restoredHash = original ? fileSha256(original) : null
    if (!entry || seenLegacy.has(plan.rel) || plan.orig !== entry.orig ||
        plan.installedBlob !== entry.installedBlob || plan.restoredHash !== restoredHash ||
        (plan.temporary !== null && !validRemovalSibling(plan.temporary, target))) {
      throw new Error('The pending uninstall legacy target set does not match the active install.')
    }
    if (plan.temporary) {
      assertSafeManagedPath(repo, plan.temporary, 'pending legacy uninstall temporary file')
      if (existsSync(plan.temporary) && fileSha256(plan.temporary) !== plan.restoredHash) {
        throw new Error('A pending legacy uninstall temporary file changed after it was created.')
      }
    }
    seenLegacy.add(plan.rel)
  }
}

function removeVerifiedPendingTemporaries(home, repo, pending) {
  for (const plan of pending.files || []) {
    assertSafeManagedPath(home, plan.temporary, 'pending uninstall managed temporary file')
    if (existsSync(plan.temporary)) unlinkSync(plan.temporary)
  }
  for (const plan of pending.configs || []) {
    assertSafeManagedPath(home, plan.temporary, 'pending uninstall config temporary file')
    if (existsSync(plan.temporary)) unlinkSync(plan.temporary)
  }
  for (const plan of pending.legacyFiles || []) {
    if (!plan.temporary) continue
    assertSafeManagedPath(repo, plan.temporary, 'pending legacy uninstall temporary file')
    if (existsSync(plan.temporary)) unlinkSync(plan.temporary)
  }
}

function receiptPathProblem(entry, expectedPath, home) {
  if (!entry || !samePath(entry.path, expectedPath) || !inside(home, entry.path)) return 'target path is outside the selected profile'
  if (!validSibling(entry.backup, entry.path, 'pre-classic-gold')) return 'backup path is not a target sibling'
  if (!validSibling(entry.rollbackBackup, entry.path, 'classic-gold-rollback')) return 'rollback path is not a target sibling'
  if (!validSibling(entry.temporary, entry.path, 'classic-gold-next')) return 'temporary path is not a target sibling'
  if ((entry.createdDirectories || []).some(directory => (
    !inside(home, directory) ||
    samePath(dirname(directory), home) ||
    !inside(directory, entry.path)
  ))) return 'created directory is not an owned target ancestor'
  try {
    for (const [path, label] of [
      [entry.path, 'target'],
      [entry.backup, 'backup'],
      [entry.rollbackBackup, 'rollback backup'],
      [entry.temporary, 'temporary file'],
      ...(entry.createdDirectories || []).map(path => [path, 'created directory']),
    ]) {
      if (path) assertSafeManagedPath(home, path, label)
    }
  } catch (error) {
    return error.message
  }
  return null
}

function assertReceiptPaths(home, entry, label) {
  for (const path of [
    entry.path,
    entry.backup,
    entry.rollbackBackup,
    entry.temporary,
    ...(entry.createdDirectories || []),
  ]) {
    if (path) assertSafeManagedPath(home, path, label)
  }
}

function managedFileProblem(entry) {
  const cleanupProblem = recordedCleanupProblem(entry)
  if (cleanupProblem) return cleanupProblem
  const currentHash = fileSha256(entry.path)
  if (entry.state === 'planned') {
    if (currentHash === entry.previousHash) {
      if (entry.backupCreated && entry.backup && existsSync(entry.backup) &&
          fileSha256(entry.backup) !== entry.previousHash) {
        return 'the planned original backup changed after it was created'
      }
      return null
    }
    if (entry.rollbackBackup && existsSync(entry.rollbackBackup)) {
      if (currentHash !== entry.installedHash) return 'the partial target changed after the planned write'
      if (entry.previousHash && fileSha256(entry.rollbackBackup) !== entry.previousHash) return 'the rollback backup hash does not match'
      return null
    }
    if (currentHash === null && entry.previousHash === null) return null
    return 'the planned write cannot be reversed safely'
  }
  if (currentHash === null && !entry.preExisting) return null
  if (entry.preExisting && entry.backupHash && currentHash === entry.backupHash) return null
  if (!entry.installedHash || currentHash !== entry.installedHash) return 'the installed target hash does not match'
  if (entry.preExisting) {
    if (!entry.backup || !existsSync(entry.backup)) return 'the original backup is missing'
    if (!entry.backupHash || fileSha256(entry.backup) !== entry.backupHash) return 'the original backup hash does not match'
  }
  return null
}

function recordedCleanupProblem(entry) {
  if (entry.temporary && existsSync(entry.temporary) &&
      (!entry.installedHash || fileSha256(entry.temporary) !== entry.installedHash)) {
    return 'the recorded temporary file changed after it was created'
  }
  if (entry.rollbackBackup && existsSync(entry.rollbackBackup) &&
      (!Object.hasOwn(entry, 'previousHash') || fileSha256(entry.rollbackBackup) !== entry.previousHash)) {
    return 'the recorded rollback backup changed after it was created'
  }
  if (entry.backupCreated && entry.backup && existsSync(entry.backup) &&
      (!Object.hasOwn(entry, 'previousHash') || fileSha256(entry.backup) !== entry.previousHash)) {
    return 'the recorded original backup changed after it was created'
  }
  return null
}

function assertRecordedCleanup(entry, label) {
  const problem = recordedCleanupProblem(entry)
  if (problem) throw new Error(`${label}: ${problem}`)
}

function removeEmptyDirectories(directories = []) {
  for (const directory of [...directories].reverse()) {
    try {
      rmdirSync(directory)
    } catch {
      // Keep directories that are not empty or are not owned by this receipt.
    }
  }
}

function removeRecordedTemporary(entry) {
  assertRecordedCleanup(entry, 'recorded cleanup')
  for (const path of [entry.temporary, entry.rollbackBackup]) {
    if (!path || !existsSync(path)) continue
    try {
      unlinkSync(path)
    } catch {
      return false
    }
  }
  return true
}

function reverseManagedFile(entry, label, home, removalTemporary) {
  assertReceiptPaths(home, entry, label)
  assertSafeManagedPath(home, removalTemporary, `${label} uninstall temporary file`)
  assertRecordedCleanup(entry, label)
  const currentHash = fileSha256(entry.path)

  if (entry.preExisting && entry.backupHash && currentHash === entry.backupHash) {
    if (entry.backup && existsSync(entry.backup)) {
      if (fileSha256(entry.backup) !== entry.backupHash) {
        console.warn(`! ${label} backup failed its hash check: ${entry.backup}`)
        return false
      }
      unlinkSync(entry.backup)
    }
    removeRecordedTemporary(entry)
    removeEmptyDirectories(entry.createdDirectories)
    return true
  }

  if (entry.state === 'planned' && currentHash === entry.previousHash) {
    const cleaned = removeRecordedTemporary(entry)
    if (entry.backupCreated && entry.backup && existsSync(entry.backup)) {
      if (!entry.previousHash || fileSha256(entry.backup) !== entry.previousHash) {
        console.warn(`! ${label} original backup changed; leaving it in place: ${entry.backup}`)
        return false
      }
      unlinkSync(entry.backup)
    }
    removeEmptyDirectories(entry.createdDirectories)
    return cleaned
  }

  if (entry.state === 'planned' && entry.rollbackBackup && existsSync(entry.rollbackBackup)) {
    if (currentHash !== entry.installedHash) {
      console.warn(`! ${label} changed after the planned write; leaving it in place: ${entry.path}`)
      return false
    }
    if (entry.previousHash && fileSha256(entry.rollbackBackup) !== entry.previousHash) {
      console.warn(`! ${label} rollback backup failed its hash check: ${entry.rollbackBackup}`)
      return false
    }
    copyFileAtomically(entry.rollbackBackup, entry.path, removalTemporary)
    if (entry.previousHash && fileSha256(entry.path) !== entry.previousHash) return false
    removeRecordedTemporary(entry)
    if (entry.backupCreated && entry.backup && existsSync(entry.backup)) unlinkSync(entry.backup)
    removeEmptyDirectories(entry.createdDirectories)
    return true
  }

  if (currentHash === null && !entry.preExisting) {
    removeRecordedTemporary(entry)
    removeEmptyDirectories(entry.createdDirectories)
    return true
  }
  if (!entry.installedHash || currentHash !== entry.installedHash) {
    console.warn(`! ${label} changed after Classic Gold installed it; leaving it in place: ${entry.path}`)
    return false
  }

  if (entry.preExisting) {
    if (!entry.backup || !existsSync(entry.backup)) {
      console.warn(`! ${label} backup is missing: ${entry.backup || '(not recorded)'}`)
      return false
    }
    if (entry.backupHash && fileSha256(entry.backup) !== entry.backupHash) {
      console.warn(`! ${label} backup failed its hash check: ${entry.backup}`)
      return false
    }
    copyFileAtomically(entry.backup, entry.path, removalTemporary)
    if (entry.backupHash && fileSha256(entry.path) !== entry.backupHash) return false
    unlinkSync(entry.backup)
  } else {
    unlinkSync(entry.path)
  }
  removeRecordedTemporary(entry)
  removeEmptyDirectories(entry.createdDirectories)
  return true
}

function currentHead(repo) {
  try {
    return execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

function legacyRestoreState(repo, entry) {
  if (!entry.installedBlob) return false
  const expected = headBlobHash(repo, entry.rel)
  const original = gitBlobHash(repo, join(repo, entry.orig), { asPath: entry.rel })
  const current = gitBlobHash(repo, join(repo, entry.rel), { asPath: entry.rel })
  if (!expected || original !== expected) return 'manual'
  if (current === entry.installedBlob) return 'restore'
  if (current === expected) return 'restored'
  return 'manual'
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
      console.error('✗ More than one Hermes profile is available. Pass --home <path>.')
      for (const candidate of homes) console.error(`  - ${candidate}`)
      return 1
    }
  }
  const home = resolveHermesHome({ explicit: args.home })
  if (!home) {
    console.error('✗ Could not find HERMES_HOME. Pass --home <path>.')
    return 1
  }
  return withHomeTransactionLock(home, async () => {
  const stamp = readStamp(home)
  const manifest = readManifest(home)
  if (!stamp && (!manifest.entries || manifest.entries.length === 0)) {
    console.log('• Nothing recorded for this pack at ' + home + '.')
    console.log('  If you installed an older build, uninstall by hand — see ai/uninstall.md.')
    return 0
  }

  const applied = stamp?.applied || {}
  const files = applied.statusbar || applied.caduceus
    ? latestByKey(manifest.entries, 'file', (e) => e.rel)
    : []
  const knownLegacy = new Set(knownLegacyPaths(ROOT))
  const invalidLegacy = files.filter(entry => {
    return typeof entry.rel !== 'string' || !knownLegacy.has(entry.rel) || entry.orig !== `${entry.rel}.orig`
  })
  if (invalidLegacy.length > 0) {
    console.error('✗ The legacy manifest contains a path outside the known Classic Gold targets.')
    console.error('  No file was changed. Inspect the manifest before uninstalling.')
    return 1
  }
  const repo = files.length > 0 ? resolveAgentRepo({ explicit: args.repo, home }) : null
  if (repo && !args.repo && !samePath(repo, join(home, 'hermes-agent'))) {
    console.error('Error: The selected repository is not associated with HERMES_HOME.')
    console.error('  For an external checkout, pass both --home <path> and --repo <path>.')
    return 1
  }
  if (files.length > 0 && !existsSync(join(repo, 'apps', 'desktop'))) {
    console.error(`✗ Legacy source receipts exist, but this is not a Hermes checkout: ${repo}`)
    console.error('  Pass --repo <path> before uninstalling the legacy source files.')
    return 1
  }
  const head = repo ? currentHead(repo) : null

  const activePetTransaction = applied.pets?.transactionId || null
  const pets = applied.pets && !activePetTransaction
    ? latestByKey(manifest.entries, 'pet', (e) => e.slug)
    : []
  const petFiles = applied.pets && activePetTransaction
    ? latestForTransaction(manifest.entries, 'pet-file', (e) => e.path, activePetTransaction)
    : []
  const legacyConfigs = applied.pets && !applied.petConfig
    ? latestByKey(manifest.entries, 'config', (e) => e.path)
    : []
  const petConfigTransaction = applied.petConfig?.transactionId || null
  const petConfigs = applied.petConfig
    ? latestForTransaction(manifest.entries, 'pet-config', (e) => e.path, petConfigTransaction)
    : applied.pets && !activePetTransaction
      ? latestByKey(manifest.entries, 'pet-config', (e) => e.path)
      : []
  const themeReceipt = applied.theme ? latestByKey(manifest.entries, 'theme', () => 'theme')[0] : null
  const theme = exactLegacyThemeReceipt(applied.theme, themeReceipt)
  const desktopTransaction = applied.desktopPlugin?.transactionId || null
  const desktopPlugin = applied.desktopPlugin
    ? latestForTransaction(manifest.entries, 'desktop-plugin', (e) => e.id || e.path, desktopTransaction)[0]
    : null
  const themeCleanupNeeded = Boolean(applied.theme || desktopPlugin)
  const backendTransaction = applied.pluginBackend?.transactionId || null
  const pluginBackendFiles = applied.pluginBackend
    ? latestForTransaction(manifest.entries, 'plugin-backend-file', (e) => e.path, backendTransaction)
    : []
  const pluginBackendConfig = applied.pluginBackend
    ? latestForTransaction(manifest.entries, 'plugin-backend-config', (e) => e.id || e.path, backendTransaction)[0]
    : null

  const boundaryProblems = []
  const configPath = join(home, 'config.yaml')
  if (desktopPlugin) {
    if (!samePath(applied.desktopPlugin.path, desktopPluginPath(home)) ||
        applied.desktopPlugin.transactionId !== desktopPlugin.transactionId ||
        applied.desktopPlugin.installedHash !== desktopPlugin.installedHash) {
      boundaryProblems.push('desktop plug-in: active stamp does not match its completed receipt')
    }
    const problem = receiptPathProblem(desktopPlugin, desktopPluginPath(home), home)
    if (problem) boundaryProblems.push(`desktop plug-in: ${problem}`)
  }
  const stampedPetFiles = applied.pets?.files
  if (activePetTransaction) {
    if (!Array.isArray(stampedPetFiles) || stampedPetFiles.length !== petFiles.length ||
        stampedPetFiles.some(path => !inside(join(home, 'pets'), path) ||
          !petFiles.some(entry => samePath(entry.path, path)))) {
      boundaryProblems.push('pet files: active stamp and manifest receipt set do not match')
    }
    for (const file of petFiles) {
      const expected = stampedPetFiles?.find(path => samePath(path, file.path))
      const problem = receiptPathProblem(file, expected, home)
      if (problem) boundaryProblems.push(`pet file: ${problem}`)
    }
  }
  for (const config of petConfigs) {
    if (applied.petConfig && (
      !samePath(applied.petConfig.path, configPath) ||
      applied.petConfig.transactionId !== config.transactionId ||
      applied.petConfig.installedHash !== config.installedHash
    )) {
      boundaryProblems.push('pet config: active stamp does not match its completed receipt')
    }
    if (!samePath(config.path, configPath)) boundaryProblems.push('pet config: path is outside the selected profile')
    if (!validSibling(config.rollbackBackup, config.path, 'classic-gold-rollback')) {
      boundaryProblems.push('pet config: rollback path is not a config sibling')
    }
    try {
      assertSafeManagedPath(home, config.path, 'pet config')
      if (config.rollbackBackup) {
        assertSafeManagedPath(home, config.rollbackBackup, 'pet config rollback backup')
      }
    } catch (error) {
      boundaryProblems.push(`pet config: ${error.message}`)
    }
  }
  const expectedBackendPaths = PLUGIN_BACKEND_FILES.map(path => join(pluginBackendRoot(home), path))
  if (applied.pluginBackend && (
    !samePath(applied.pluginBackend.path, pluginBackendRoot(home)) ||
    !samePath(applied.pluginBackend.configPath, configPath) ||
    applied.pluginBackend.transactionId !== backendTransaction ||
    !Array.isArray(applied.pluginBackend.files) ||
    applied.pluginBackend.files.length !== expectedBackendPaths.length ||
    expectedBackendPaths.some(path => !applied.pluginBackend.files.some(stamped => samePath(stamped, path)))
  )) {
    boundaryProblems.push('telemetry backend: active stamp does not match the expected managed paths')
  }
  if (applied.pluginBackend && (
    pluginBackendFiles.length !== expectedBackendPaths.length ||
    expectedBackendPaths.some(path => !pluginBackendFiles.some(entry => samePath(entry.path, path)))
  )) {
    boundaryProblems.push('telemetry backend: active stamp and file receipt set do not match')
  }
  for (const file of pluginBackendFiles) {
    const expected = expectedBackendPaths.find(path => samePath(path, file.path))
    const problem = receiptPathProblem(file, expected, home)
    if (problem) boundaryProblems.push(`telemetry backend: ${problem}`)
  }
  if (pluginBackendConfig && !samePath(pluginBackendConfig.path, configPath)) {
    boundaryProblems.push('telemetry backend config: path is outside the selected profile')
  }
  if (pluginBackendConfig) {
    try {
      assertSafeManagedPath(home, pluginBackendConfig.path, 'telemetry backend config')
      if (pluginBackendConfig.rollbackBackup) {
        assertSafeManagedPath(home, pluginBackendConfig.rollbackBackup, 'telemetry backend config rollback backup')
      }
    } catch (error) {
      boundaryProblems.push(`telemetry backend config: ${error.message}`)
    }
  }
  if (boundaryProblems.length > 0) {
    console.error('✗ Managed receipts do not belong to the selected HERMES_HOME:')
    for (const problem of boundaryProblems) console.error(`  - ${problem}`)
    console.error('  No file was changed.')
    return 1
  }

  // Classify each source file: restorable vs must-do-by-hand (Issue #3 §4 guard).
  const restorable = []
  const alreadyRestored = []
  const manual = []
  for (const f of files) {
    const orig = join(repo, f.orig)
    try {
      assertSafeManagedPath(repo, join(repo, f.rel), 'legacy source target')
      assertSafeManagedPath(repo, orig, 'legacy source backup')
    } catch {
      manual.push(f)
      continue
    }
    const sameHead = !f.agentHead || Boolean(head && f.agentHead === head)
    const safeMethod = f.method !== 'copy' && f.method !== 'reconciled'
    const restoreState = existsSync(orig) && sameHead && safeMethod
      ? legacyRestoreState(repo, f)
      : 'manual'
    if (restoreState === 'restore') restorable.push(f)
    else if (restoreState === 'restored') alreadyRestored.push(f)
    else manual.push(f)
  }
  const petsToDelete = []
  const petsToKeep = pets.filter((p) => p.preExisting)

  const safetyProblems = []
  if (manual.length > 0) safetyProblems.push(`${manual.length} legacy source file(s) lack exact restore proof`)
  if (pets.length > 0) safetyProblems.push('legacy directory-only pet receipts cannot prove current file ownership')
  if (legacyConfigs.length > 0) safetyProblems.push('legacy full-config receipts cannot be restored safely')
  if (desktopPlugin) {
    const problem = managedFileProblem(desktopPlugin)
    if (problem) safetyProblems.push(`desktop plug-in: ${problem}`)
  }
  for (const file of petFiles) {
    const problem = managedFileProblem(file)
    if (problem) safetyProblems.push(`pet file ${file.path}: ${problem}`)
  }
  for (const config of petConfigs) {
    try {
      const currentBlock = petConfigBlock(readFileSync(config.path, 'utf8'))
      const currentBlockHash = sha256(currentBlock || '')
      const priorBlockHash = sha256(config.priorBlock || '')
      if (!config.installedHash || (
        currentBlockHash !== config.installedHash && currentBlockHash !== priorBlockHash
      )) {
        safetyProblems.push('display.pet changed after install')
      }
    } catch (error) {
      safetyProblems.push(`pet config cannot be verified: ${error.message}`)
    }
  }
  for (const file of pluginBackendFiles) {
    const problem = managedFileProblem(file)
    if (problem) safetyProblems.push(`telemetry backend file ${file.path}: ${problem}`)
  }
  if (pluginBackendConfig) {
    try {
      const currentState = pluginConfigState(readFileSync(pluginBackendConfig.path, 'utf8'))
      const prior = pluginBackendConfig.prior || { disabled: false, enabled: false }
      const installed = pluginBackendConfig.installedState || { disabled: false, enabled: true }
      const matchesPrior = currentState.disabled === prior.disabled && currentState.enabled === prior.enabled
      const matchesInstalled = currentState.disabled === installed.disabled && currentState.enabled === installed.enabled
      if (!matchesPrior && !matchesInstalled) safetyProblems.push('telemetry backend config membership changed after install')
    } catch (error) {
      safetyProblems.push(`telemetry backend config cannot be verified: ${error.message}`)
    }
  }
  if (safetyProblems.length > 0) {
    console.error('✗ Uninstall stopped before any write because these items are not safely reversible:')
    for (const problem of safetyProblems) console.error(`  - ${problem}`)
    console.error('  The active stamps and files remain unchanged.')
    return 1
  }

  const managedEntries = [desktopPlugin, ...petFiles, ...pluginBackendFiles].filter(Boolean)
  const legacyEntries = [...restorable, ...alreadyRestored]
  const configDescriptors = [
    ...petConfigs.map(config => ({
      path: config.path,
      restore: text => replacePetConfigBlock(text, config.priorBlock ?? null),
      type: 'pet-config',
    })),
    ...(pluginBackendConfig ? [{
      path: pluginBackendConfig.path,
      restore: text => setPluginConfigState(
        text,
        pluginBackendConfig.prior || { disabled: false, enabled: false },
      ),
      type: 'plugin-backend-config',
    }] : []),
  ]
  const expectedSources = sourceTransactions(applied)
  const pendingRemoval = latestPendingUninstall(manifest.entries)
  if (pendingRemoval) {
    try {
      assertPendingUninstall({
        configDescriptors,
        expectedSources,
        home,
        legacyFiles: legacyEntries,
        managedFiles: managedEntries,
        pending: pendingRemoval,
        repo,
      })
    } catch (error) {
      console.error(`✗ ${error.message}`)
      console.error('  No file was changed. Inspect the pending uninstall receipt.')
      return 1
    }
  }

  // --- plan ---
  console.log('▶ Uninstall plan  (HERMES_HOME: ' + home + ')')
  if (pendingRemoval) console.log(`  • recovery: resume transaction ${pendingRemoval.transactionId}`)
  console.log(`  • source files: restore ${restorable.length} from exact .orig receipts` +
    (alreadyRestored.length ? `, ${alreadyRestored.length} already restored` : '') +
    (manual.length ? `, ${manual.length} need restore-only migration` : ''))
  if (restorable.length && args.build) console.log('    then rebuild (npm run pack)')
  console.log(`  • pet files: ${petFiles.length ? `restore or remove ${petFiles.length}` : 'no exact file receipts'}`)
  if (petsToKeep.length) console.log(`  • legacy pet folders: keep ${petsToKeep.length} pre-existing`)
  console.log(`  • pet config: ${petConfigs.length ? 'restore the recorded display.pet block' : '(unchanged)'}`)
  if (legacyConfigs.length) console.log('    legacy full-config backups are not applied automatically')
  console.log(`  • theme mirror: ${themeCleanupNeeded ? 'renderer cleanup required' : '(none recorded)'}`)
  if (themeCleanupNeeded && args.themeCleaned) {
    console.log('    confirm that the renderer cleanup was already completed')
  }
  console.log(`  • desktop plug-in: ${desktopPlugin ? (desktopPlugin.preExisting ? 'restore prior file' : 'remove pack file') : '(none recorded)'}`)
  console.log(`  • telemetry backend: ${pluginBackendFiles.length ? `restore or remove ${pluginBackendFiles.length} file(s)` : '(none recorded)'}`)
  if (pluginBackendConfig) console.log('    restore only the Classic Gold enabled and disabled list entries')
  for (const m of manual) console.log(`    ! ${m.rel} — applied via ${m.method}${m.agentHead && head && m.agentHead !== head ? ` @${m.agentHead.slice(0, 7)} (you're on ${head.slice(0, 7)})` : ''}`)

  if (args.dryRun) {
    console.log('\n(--dry-run: nothing changed.)')
    return 0
  }
  if (!args.yes) {
    if (!process.stdin.isTTY) {
      console.error('\n✗ Refusing to uninstall non-interactively without --yes.')
      return 1
    }
    const question = pendingRemoval
      ? '\nResume the pending uninstall after exact receipt checks? [y/N] '
      : '\nProceed with uninstall? [y/N] '
    if (!(await confirm(question))) {
      console.log('Aborted.')
      return 0
    }
  }

  if (!pendingRemoval) {
    const recovered = [
      recoverInterruptedDesktopPlugin({ home }),
      recoverInterruptedPets({ home }),
      recoverInterruptedPluginBackend({ home }),
    ]
    const petConfigRecovery = recoverPendingPetConfig({
      configPath: join(home, 'config.yaml'),
      home,
      version: PACK_VERSION,
    })
    if (recovered.some(Boolean) || petConfigRecovery.status !== 'none') {
      console.error('✗ An interrupted install was recovered. Run uninstall again to inspect the new active state.')
      return 1
    }
  } else {
    removeVerifiedPendingTemporaries(home, repo, pendingRemoval)
  }

  const removalTransactionId = pendingRemoval?.transactionId || randomUUID()
  const configRemovalPlans = new Map()
  if (pendingRemoval) {
    for (const plan of pendingRemoval.configs) {
      configRemovalPlans.set(configPlanKey(plan.type, plan.path), plan)
    }
  } else {
    const virtualText = new Map()
    for (const descriptor of configDescriptors) {
      const key = pathKey(descriptor.path)
      const current = virtualText.has(key)
        ? virtualText.get(key)
        : readFileSync(descriptor.path, 'utf8')
      const restored = descriptor.restore(current)
      const plan = {
        currentHash: sha256(Buffer.from(current, 'utf8')),
        path: descriptor.path,
        restoredHash: sha256(Buffer.from(restored, 'utf8')),
        temporary: uniqueSiblingPath(descriptor.path, 'classic-gold-uninstall-next'),
        type: descriptor.type,
      }
      configRemovalPlans.set(configPlanKey(plan.type, plan.path), plan)
      virtualText.set(key, restored)
    }
  }
  const managedFileRemovalPlans = new Map(
    managedEntries.map(entry => {
      const pendingPlan = pendingRemoval?.files.find(plan => samePath(plan.path, entry.path))
      const temporary = pendingPlan?.temporary || uniqueSiblingPath(entry.path, 'classic-gold-uninstall-next')
      assertSafeManagedPath(home, temporary, 'managed uninstall temporary file')
      return [pathKey(entry.path), { entry, temporary }]
    }),
  )
  const legacyFileRemovalPlans = new Map(
    restorable.map(entry => {
      const path = join(repo, entry.rel)
      const pendingPlan = pendingRemoval?.legacyFiles.find(plan => plan.rel === entry.rel)
      const temporary = pendingPlan?.temporary || uniqueSiblingPath(path, 'classic-gold-uninstall-next')
      assertSafeManagedPath(repo, temporary, 'legacy uninstall temporary file')
      return [entry.rel, { entry, temporary }]
    }),
  )
  const removalPlan = pendingRemoval || {
    type: 'uninstall',
    transactionId: removalTransactionId,
    sourceTransactions: expectedSources,
    files: [...managedFileRemovalPlans.values()].map(({ entry, temporary }) => ({
      backupHash: entry.backupHash || null,
      installedHash: entry.installedHash || null,
      path: entry.path,
      preExisting: Boolean(entry.preExisting),
      temporary,
    })),
    configs: configDescriptors.map(descriptor => {
      const entry = configRemovalPlans.get(configPlanKey(descriptor.type, descriptor.path))
      return {
      currentHash: entry.currentHash,
      path: entry.path,
      restoredHash: entry.restoredHash,
      temporary: entry.temporary,
      type: entry.type,
      }
    }),
    legacyFiles: legacyEntries.map(entry => ({
      installedBlob: entry.installedBlob,
      orig: entry.orig,
      rel: entry.rel,
      restoredHash: fileSha256(join(repo, entry.orig)),
      temporary: legacyFileRemovalPlans.get(entry.rel)?.temporary || null,
    })),
    state: 'planned',
  }
  if (!pendingRemoval) appendManifest(home, removalPlan)

  // --- execute ---
  // 1) source files
  let restoredAny = false
  let sourceOk = !(applied.statusbar || applied.caduceus) || (files.length > 0 && manual.length === 0)
  if ((applied.statusbar || applied.caduceus) && files.length === 0) {
    console.warn('! Legacy source stamps have no matching manifest receipts. Source files were not changed.')
  }
  for (const f of restorable) {
    try {
      assertSafeManagedPath(repo, join(repo, f.orig), 'legacy source backup')
      assertSafeManagedPath(repo, join(repo, f.rel), 'legacy source target')
      const plan = legacyFileRemovalPlans.get(f.rel)
      if (!plan) throw new Error('The legacy uninstall plan is missing')
      copyFileAtomically(join(repo, f.orig), join(repo, f.rel), plan.temporary)
      restoredAny = true
    } catch (e) {
      sourceOk = false
      console.warn(`! could not restore ${f.rel}: ${e.message}`)
    }
  }
  if (restoredAny) console.log(`✓ Restored ${restorable.length} source file(s) from .orig.`)
  if (manual.length) {
    console.warn(`! ${manual.length} legacy file(s) lack exact live, installed, and HEAD-backup proof.`)
    console.warn('  Use scripts/migrate-to-plugin.mjs or ai/repair.md. No unproved source file was changed.')
  }

  // 2) rebuild after a restore, including a retry after a prior build failure.
  const legacyBuildRequired = Boolean(
    (applied.statusbar || applied.caduceus) &&
    (restoredAny || alreadyRestored.length > 0),
  )
  if (legacyBuildRequired && args.build) {
    const desktop = join(repo, 'apps', 'desktop')
    console.log('• Rebuilding (npm run pack) — Hermes must be fully quit…')
    const b = spawnSync('npm', ['run', 'pack'], { cwd: desktop, stdio: 'inherit', shell: true })
    if (b.status !== 0) {
      sourceOk = false
      console.warn('! rebuild failed — quit Hermes and run `npm run pack` in ' + desktop)
    }
  }

  // 3) pets
  let petsOk = !applied.pets || (activePetTransaction ? petFiles.length > 0 : pets.length > 0)
  if (applied.pets && !petsOk) {
    console.warn('! The pet stamp has no matching manifest receipts. Pet files were not changed.')
  }
  for (const file of petFiles) {
    try {
      const plan = managedFileRemovalPlans.get(pathKey(file.path))
      if (!plan || !reverseManagedFile(file, 'pet file', home, plan.temporary)) petsOk = false
    } catch (error) {
      petsOk = false
      console.warn(`! could not restore or remove pet file ${file.path}: ${error.message}`)
    }
  }
  for (const p of petsToDelete) {
    try {
      if (existsSync(p.dir)) rmSync(p.dir, { recursive: true, force: true })
    } catch (e) {
      petsOk = false
      console.warn(`! could not delete pet ${p.slug}: ${e.message}`)
    }
  }
  if (petsToDelete.length) console.log(`✓ Deleted ${petsToDelete.length} pack pet(s)` + (petsToKeep.length ? `; kept ${petsToKeep.length} you already had.` : '.'))

  // 4) Restore only the recorded display.pet block. Never replace the full
  // live config with an old backup because that can erase later user changes.
  let petConfigOk = !applied.petConfig || petConfigs.length > 0
  if (applied.petConfig && !petConfigOk) {
    console.warn('! The pet config stamp has no matching manifest receipt. display.pet was not changed.')
  }
  for (const config of petConfigs) {
    try {
      const current = readFileSync(config.path, 'utf8')
      const currentBlock = petConfigBlock(current)
      const currentBlockHash = sha256(currentBlock || '')
      const priorBlockHash = sha256(config.priorBlock || '')
      if (!config.installedHash || (
        currentBlockHash !== config.installedHash && currentBlockHash !== priorBlockHash
      )) {
        petConfigOk = false
        console.warn(`! display.pet changed after install; leaving it in place: ${config.path}`)
        continue
      }
      if (currentBlockHash === priorBlockHash) {
        if (config.rollbackBackup && existsSync(config.rollbackBackup)) {
          if (!config.previousHash || fileSha256(config.rollbackBackup) !== config.previousHash) {
            throw new Error('display.pet rollback backup changed; it was preserved')
          }
          unlinkSync(config.rollbackBackup)
        }
        console.log(`OK: display.pet was already restored in ${config.path}.`)
        continue
      }
      assertSafeManagedPath(home, config.path, 'pet config')
      if (config.rollbackBackup) assertSafeManagedPath(home, config.rollbackBackup, 'pet config rollback backup')
      const plan = configRemovalPlans.get(configPlanKey('pet-config', config.path))
      if (!plan || fileSha256(config.path) !== plan.currentHash) {
        throw new Error('display.pet changed before the planned uninstall write')
      }
      assertSafeManagedPath(home, plan.temporary, 'pet config uninstall temporary file')
      const restored = replacePetConfigBlock(current, config.priorBlock ?? null)
      writeTextAtomically(config.path, restored, plan.temporary)
      if (fileSha256(config.path) !== plan.restoredHash) {
        throw new Error('display.pet uninstall hash verification failed')
      }
      if (petConfigBlock(readFileSync(config.path, 'utf8')) !== (config.priorBlock ?? null)) {
        throw new Error('display.pet validation failed')
      }
      console.log(`✓ Restored only display.pet in ${config.path}.`)
    } catch (error) {
      petConfigOk = false
      console.warn(`! could not restore display.pet: ${error.message}`)
    }
  }
  if (legacyConfigs.length > 0) {
    petConfigOk = false
    console.warn('! A legacy full-config backup was recorded. It was not applied because it can erase later settings.')
    console.warn('  Restore the old pet selection by hand in Settings → Pet.')
  }

  // 5) desktop plug-in. Restore a prior file or remove only the recorded file.
  let desktopPluginOk = !applied.desktopPlugin || Boolean(desktopPlugin)
  if (applied.desktopPlugin && !desktopPlugin) {
    console.warn('! The desktop plug-in stamp has no matching manifest receipt. Its file was not changed.')
  }
  if (desktopPlugin) {
    try {
      const plan = managedFileRemovalPlans.get(pathKey(desktopPlugin.path))
      desktopPluginOk = Boolean(plan) && reverseManagedFile(desktopPlugin, 'desktop plug-in', home, plan.temporary)
      if (desktopPluginOk) console.log(`✓ Restored or removed the desktop plug-in at ${desktopPlugin.path}.`)
    } catch (e) {
      desktopPluginOk = false
      console.warn(`! could not restore or remove the desktop plug-in: ${e.message}`)
    }
  }

  // 6) Remove backend files only when their installed hashes still match.
  // Restore config membership only after every file is safely reversed.
  let pluginBackendOk = !applied.pluginBackend || Boolean(pluginBackendConfig && pluginBackendFiles.length > 0)
  if (applied.pluginBackend && !pluginBackendOk) {
    console.warn('! The telemetry backend stamp has incomplete manifest receipts. Its files and config were not changed.')
  }
  for (const file of pluginBackendOk ? pluginBackendFiles : []) {
    try {
      const plan = managedFileRemovalPlans.get(pathKey(file.path))
      if (!plan || !reverseManagedFile(file, 'telemetry backend file', home, plan.temporary)) pluginBackendOk = false
    } catch (e) {
      pluginBackendOk = false
      console.warn(`! could not restore or remove backend file ${file.path}: ${e.message}`)
    }
  }
  if (pluginBackendOk && pluginBackendConfig && existsSync(pluginBackendConfig.path)) {
    try {
      const current = readFileSync(pluginBackendConfig.path, 'utf8')
      assertSafeManagedPath(home, pluginBackendConfig.path, 'telemetry backend config')
      if (pluginBackendConfig.rollbackBackup) {
        assertSafeManagedPath(home, pluginBackendConfig.rollbackBackup, 'telemetry backend config rollback backup')
      }
      const prior = pluginBackendConfig.prior || {
        disabled: false,
        enabled: false,
      }
      const currentState = pluginConfigState(current)
      const installedState = pluginBackendConfig.installedState || { disabled: false, enabled: true }
      if (currentState.disabled !== prior.disabled || currentState.enabled !== prior.enabled) {
        if (currentState.disabled !== installedState.disabled || currentState.enabled !== installedState.enabled) {
          throw new Error('plug-in membership changed after install; leaving it unchanged')
        }
        const plan = configRemovalPlans.get(configPlanKey(
          'plugin-backend-config',
          pluginBackendConfig.path,
        ))
        if (!plan || fileSha256(pluginBackendConfig.path) !== plan.currentHash) {
          throw new Error('plug-in membership changed before the planned uninstall write')
        }
        assertSafeManagedPath(home, plan.temporary, 'telemetry backend config uninstall temporary file')
        const restored = setPluginConfigState(current, prior)
        writeTextAtomically(pluginBackendConfig.path, restored, plan.temporary)
        if (fileSha256(pluginBackendConfig.path) !== plan.restoredHash) {
          throw new Error('telemetry backend config uninstall hash verification failed')
        }
      }
      if (pluginBackendConfig.rollbackBackup && existsSync(pluginBackendConfig.rollbackBackup)) {
        if (!pluginBackendConfig.previousHash ||
            fileSha256(pluginBackendConfig.rollbackBackup) !== pluginBackendConfig.previousHash) {
          throw new Error('telemetry backend config rollback backup changed; it was preserved')
        }
        unlinkSync(pluginBackendConfig.rollbackBackup)
      }
      console.log('✓ Restored the Classic Gold backend entries in config.yaml.')
    } catch (e) {
      pluginBackendOk = false
      console.warn(`! could not restore the Classic Gold backend config: ${e.message}`)
    }
  }
  if (pluginBackendOk && pluginBackendFiles.length) {
    console.log(`✓ Restored or removed ${pluginBackendFiles.length} telemetry backend file(s).`)
  }

  // 7) Theme state is in renderer localStorage. Print one safe command that
  // removes only the mirror that this pack owns and restores the prior choice.
  const themeOk = !themeCleanupNeeded || args.themeCleaned
  if (themeCleanupNeeded && !args.themeCleaned) {
    const priorTheme = typeof theme?.priorTheme === 'string' ? theme.priorTheme : null
    const priorMode = typeof theme?.priorMode === 'string' ? theme.priorMode : null
    console.log('\n── Revert the theme (paste in Hermes → Ctrl/Cmd+Shift+I → Console) ──')
    console.log(
      `(()=>{const r='hermes-desktop-user-themes-v1',o='hermes-classic-gold-pack.theme-mirror-v1',n='hermes-classic-gold';` +
        `const c=v=>Array.isArray(v)?'['+v.map(c).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+c(v[k])).join(',')+'}':JSON.stringify(v);` +
        `const a='hermes-desktop-theme-v2',m='hermes-desktop-mode-v1';` +
        (!priorTheme
          ? `if(localStorage.getItem(a)===n)throw new Error('Select another theme in Settings > Appearance, then run this command again.');`
          : '') +
        `let removed=false;try{const themes=JSON.parse(localStorage.getItem(r)||'{}'),owner=localStorage.getItem(o),current=themes[n];` +
        `if(current&&owner&&c(current)===owner){delete themes[n];localStorage.setItem(r,JSON.stringify(themes));removed=true}}catch{}localStorage.removeItem(o);` +
        (priorTheme
          ? `if(removed&&localStorage.getItem(a)===n){localStorage.setItem(a,${JSON.stringify(priorTheme)});` +
            (priorMode ? `localStorage.setItem(m,${JSON.stringify(priorMode)});` : '') + `}`
          : '') +
        `location.reload()})();`
    )
    console.log('────────────────────────────────────────────────────────────────────')
    console.log('After Hermes reloads, rerun this command with --theme-cleaned.')
  } else if (themeCleanupNeeded) {
    console.log('✓ Confirmed that the renderer theme cleanup is complete.')
  }

  // 8) Record the result before stamps change. A retry can safely repeat exact
  // removals if a process stops while the stamps are being cleared.
  const failed = !desktopPluginOk || !pluginBackendOk || !sourceOk || !petsOk || !petConfigOk || !themeOk
  appendManifest(home, {
    ...removalPlan,
    state: failed ? 'interrupted' : 'installed',
  })

  // Clear only components that were fully reversed. Keep failed component
  // stamps so a later uninstall can retry with the same receipts.
  if (desktopPluginOk && themeOk) clearApplied(home, 'desktopPlugin')
  if (pluginBackendOk) clearApplied(home, 'pluginBackend')
  if (sourceOk) {
    clearApplied(home, 'statusbar')
    clearApplied(home, 'caduceus')
  }
  if (petsOk) clearApplied(home, 'pets')
  if (petConfigOk) clearApplied(home, 'petConfig')
  if (themeOk) clearApplied(home, 'theme')
  if (pluginBackendFiles.length) console.log('  Fully restart Hermes Desktop to unload the telemetry backend.')
  if (failed) {
    if (!themeOk) {
      console.error('\n✗ File removal is complete, but renderer theme cleanup is pending.')
      console.error('  Paste the command above, wait for Hermes to reload, then rerun with --theme-cleaned.')
      return 1
    }
    console.error('\n✗ Uninstall stopped with protected or failed items. Their stamps remain for a safe retry.')
    console.error('  Manifest: ' + manifestPath(home))
    return 1
  }
  console.log('\n✓ File uninstall complete. The manifest remains at ' + manifestPath(home) + ' as history.')
  return 0
  })
}

main().then((code) => process.exit(code))
