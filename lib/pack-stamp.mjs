// The pack's record layer — the single source of truth for "what's installed"
// (the STAMP) and "how to undo it" (the MANIFEST). Diagnostics, update-hermes,
// the watcher, and the uninstaller all branch off this instead of guessing.
//
//   <HERMES_HOME>/hermes-classic-gold-pack.json           — stamp (current state)
//   <HERMES_HOME>/hermes-classic-gold-pack.manifest.json  — manifest (undo receipts)
//
// The stamp MUST be written on every apply path (patch, copy, reconcile, and
// --no-build staging) or the update/uninstall/watch logic goes blind. `nowIso`
// is injected (Date is awkward to stamp deterministically in tests / resumes).
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

export const STAMP_FILE = 'hermes-classic-gold-pack.json'
export const MANIFEST_FILE = 'hermes-classic-gold-pack.manifest.json'
export const PACK_LOCK_OWNER_FILE = 'owner.json'
export const PACK_LOCK_STALE_MS = 30 * 60 * 1000
export const PACK_STATE_TEMP_SUFFIX = '.next'

const transactionContexts = new AsyncLocalStorage()
const lockRetrySignal = new Int32Array(new SharedArrayBuffer(4))

// Sentinel strings that prove a tier is currently applied in the live source —
// used to detect a revert (a Hermes update wiped the tier but the stamp remains).
export const TIER_SENTINELS = {
  statusbar: {
    file: 'apps/desktop/src/app/shell/statusbar-controls.tsx',
    marker: 'function TelemetryTape',
  },
  caduceus: {
    // Backdrop's braille-caduceus array — distinctive (stock Backdrop has none).
    // NOT intro.tsx's aria-label={WORDMARK}, which stock also has.
    file: 'apps/desktop/src/components/Backdrop.tsx',
    marker: 'HERMES_CADUCEUS',
  },
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`Classic Gold state file is not valid JSON: ${path}`, { cause: error })
  }
}

function assertStampStructure(stamp, path) {
  const applied = stamp?.applied
  const invalidApplied = applied !== undefined && (
    !applied
      || Array.isArray(applied)
      || typeof applied !== 'object'
      || Object.values(applied).some(value => !value || Array.isArray(value) || typeof value !== 'object')
  )
  const invalidMetadata = [stamp?.version, stamp?.base, stamp?.agentHead]
    .some(value => value !== undefined && typeof value !== 'string')
  if (!stamp || Array.isArray(stamp) || typeof stamp !== 'object' || invalidApplied || invalidMetadata) {
    throw new Error(`Classic Gold stamp has an invalid structure: ${path}`)
  }
  return stamp
}

function assertManifestStructure(manifest, path) {
  const invalidEntries = !Array.isArray(manifest?.entries) || manifest.entries.some(entry => (
    !entry || Array.isArray(entry) || typeof entry !== 'object'
  ))
  if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object' || invalidEntries) {
    throw new Error(`Classic Gold manifest has an invalid structure: ${path}`)
  }
  return manifest
}

/**
 * Return one stable identity for a profile path. Resolve real existing path
 * parts so aliases use the same lock even when the final child does not exist.
 */
export function canonicalHomeKey(home) {
  const absolute = resolve(home)
  let existing = absolute
  const missing = []

  while (!existsSync(existing)) {
    const parent = dirname(existing)
    if (parent === existing) break
    missing.unshift(basename(existing))
    existing = parent
  }

  let canonical = existing
  if (existsSync(existing)) canonical = realpathSync.native(existing)
  canonical = resolve(canonical, ...missing)
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

/** Return the canonical lock path for one Hermes profile. */
export function transactionLockPath(home) {
  const id = createHash('sha256').update(canonicalHomeKey(home)).digest('hex').slice(0, 24)
  return join(tmpdir(), `hermes-classic-gold-state-${id}.lock`)
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'ESRCH' ? false : null
  }
}

function lockOwner(path) {
  return readJson(join(path, PACK_LOCK_OWNER_FILE), null)
}

function lockIsRecoverable(path, nowMs) {
  let modifiedAt = null
  try {
    modifiedAt = statSync(path).mtimeMs
  } catch {
    return false
  }

  const owner = lockOwner(path)
  const acquiredAt = Number(owner?.acquiredAtUnixMs)
  const ageBase = Number.isFinite(acquiredAt) && acquiredAt > 0 ? acquiredAt : modifiedAt
  const stale = Number.isFinite(ageBase) && nowMs - ageBase >= PACK_LOCK_STALE_MS
  const alive = processIsAlive(Number(owner?.pid))
  if (alive === true) return false
  return alive === false || (alive === null && stale)
}

function removeLockDirectory(path, expectedToken = null) {
  const ownerPath = join(path, PACK_LOCK_OWNER_FILE)
  if (expectedToken && lockOwner(path)?.token !== expectedToken) return false
  try {
    if (existsSync(ownerPath)) unlinkSync(ownerPath)
    rmdirSync(path)
    return true
  } catch {
    return false
  }
}

function recoverLock(path) {
  const quarantine = `${path}.stale-${process.pid}-${randomUUID()}`
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      renameSync(path, quarantine)
      removeLockDirectory(quarantine)
      return
    } catch (error) {
      if (error?.code === 'ENOENT') return
      const transient = ['EACCES', 'EBUSY', 'EPERM'].includes(error?.code)
      if (!transient || attempt === 9) {
        throw new Error(`Classic Gold could not recover its stale transaction lock: ${path}`)
      }
      Atomics.wait(lockRetrySignal, 0, 0, 10)
    }
  }
}

function acquireTransactionLock(home, key) {
  const path = transactionLockPath(home)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      mkdirSync(path)
      const acquiredAtUnixMs = Date.now()
      const token = randomUUID()
      try {
        writeFileSync(join(path, PACK_LOCK_OWNER_FILE), JSON.stringify({
          acquiredAt: new Date(acquiredAtUnixMs).toISOString(),
          acquiredAtUnixMs,
          home: key,
          pid: process.pid,
          token,
        }, null, 2), { encoding: 'utf8', flag: 'wx' })
      } catch (error) {
        removeLockDirectory(path)
        throw error
      }
      return { path, token }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      if (!lockIsRecoverable(path, Date.now())) {
        const owner = lockOwner(path)
        const detail = owner?.pid ? ` (owner PID ${owner.pid})` : ''
        throw new Error(`Classic Gold is locked by another command${detail}: ${path}`)
      }
      recoverLock(path)
    }
  }
  throw new Error(`Classic Gold could not acquire its transaction lock: ${path}`)
}

/**
 * Hold the canonical lock for a complete profile transaction. The lock stays
 * active until an asynchronous callback settles. Nested state helpers for the
 * same profile are reentrant in the owning asynchronous context.
 */
export function withHomeTransactionLock(home, action) {
  const key = canonicalHomeKey(home)
  const currentContext = transactionContexts.getStore()
  const held = currentContext?.get(key)
  if (held?.active) {
    held.depth += 1
    let result
    try {
      result = action()
    } catch (error) {
      held.depth -= 1
      throw error
    }
    if (result && typeof result.then === 'function') {
      return Promise.resolve(result).finally(() => { held.depth -= 1 })
    }
    held.depth -= 1
    return result
  }

  const acquired = acquireTransactionLock(home, key)
  const transaction = { ...acquired, active: true, depth: 1 }
  const nextContext = new Map(currentContext || [])
  nextContext.set(key, transaction)
  const release = () => {
    if (!transaction.active) return
    transaction.active = false
    removeLockDirectory(transaction.path, transaction.token)
  }
  let result
  try {
    result = transactionContexts.run(nextContext, action)
  } catch (error) {
    release()
    throw error
  }
  if (result && typeof result.then === 'function') {
    return Promise.resolve(result).finally(release)
  }
  release()
  return result
}

export const withPackTransaction = withHomeTransactionLock

function renameStateFile(source, target) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(source, target)
      return
    } catch (error) {
      const transient = process.platform === 'win32' && ['EACCES', 'EBUSY', 'EPERM'].includes(error?.code)
      if (!transient || attempt === 9) throw error
      Atomics.wait(lockRetrySignal, 0, 0, 10)
    }
  }
}

function stateTemporaryPath(path) {
  return `${path}${PACK_STATE_TEMP_SUFFIX}`
}

function recoverStateTemporary(path, validate) {
  const temporary = stateTemporaryPath(path)
  if (!existsSync(temporary)) return false

  const state = lstatSync(temporary)
  if (!state.isFile() || state.nlink !== 1) {
    if (state.isDirectory()) {
      throw new Error(`Classic Gold state temporary path is not a file: ${temporary}`)
    }
    unlinkSync(temporary)
    return false
  }

  try {
    validate(readJson(temporary, null), temporary)
  } catch {
    unlinkSync(temporary)
    return false
  }
  renameStateFile(temporary, path)
  return true
}

function writeJsonAtomically(path, value, validate) {
  validate(value, path)
  const temporary = stateTemporaryPath(path)
  let handle = null
  try {
    handle = openSync(temporary, 'wx')
    writeFileSync(handle, JSON.stringify(value, null, 2), 'utf8')
    fsyncSync(handle)
    closeSync(handle)
    handle = null
    renameStateFile(temporary, path)
  } finally {
    if (handle !== null) closeSync(handle)
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

export function stampPath(home) {
  return join(home, STAMP_FILE)
}

export function readStamp(home) {
  const path = stampPath(home)
  const stamp = readJson(path, null)
  return stamp === null ? null : assertStampStructure(stamp, path)
}

/**
 * Merge an "applied" entry into the stamp and write it. Authoritative record of
 * one component being installed.
 * @param {string} home  HERMES_HOME
 * @param {string} key   'desktopPlugin' | 'pluginBackend' | 'statusbar' | 'caduceus' | 'pets' | 'petConfig' | 'theme'
 * @param {object} entry component-specific fields (e.g. {via, agentHead})
 * @param {object} [meta] {version, base, agentHead, nowIso}
 * @returns {object} the written stamp
 */
export function recordApplied(home, key, entry, meta = {}) {
  return withHomeTransactionLock(home, () => {
    recoverStateTemporary(stampPath(home), assertStampStructure)
    const now = meta.nowIso || new Date().toISOString()
    const stamp = readStamp(home) || { pack: 'hermes-classic-gold-pack', applied: {} }
    if (meta.version) stamp.version = meta.version
    if (meta.base) stamp.base = meta.base
    if (meta.agentHead) stamp.agentHead = meta.agentHead
    stamp.applied = stamp.applied || {}
    stamp.applied[key] = { at: now, ...entry }
    writeJsonAtomically(stampPath(home), stamp, assertStampStructure)
    return stamp
  })
}

/** Remove a component from the stamp (used by the uninstaller). */
export function clearApplied(home, key) {
  return withHomeTransactionLock(home, () => {
    recoverStateTemporary(stampPath(home), assertStampStructure)
    const stamp = readStamp(home)
    if (!stamp?.applied?.[key]) return
    delete stamp.applied[key]
    writeJsonAtomically(stampPath(home), stamp, assertStampStructure)
  })
}

// --- manifest (append-only undo receipts) --------------------------------------

export function manifestPath(home) {
  return join(home, MANIFEST_FILE)
}

export function readManifest(home) {
  const path = manifestPath(home)
  return assertManifestStructure(
    readJson(path, { pack: 'hermes-classic-gold-pack', entries: [] }),
    path,
  )
}

/**
 * Append one undo receipt. Each entry is `{ type, at, ...fields }`; the
 * uninstaller reads them newest-first. Types:
 *   pet     { slug, dir, preExisting }
 *   pet-file { slug, path, backup, preExisting, installedHash, transactionId, state }
 *   config  { path, backup, priorSlug }        (legacy full-config receipt)
 *   pet-config { path, priorBlock, installedBlock, installedHash, state }
 *   file    { rel, orig, agentHead, method, installedBlob } (legacy source file)
 *   theme   { keys, priorTheme, priorMode }
 *   desktop-plugin        { id, path, backup, preExisting, installedHash, state }
 *   plugin-backend-file   { id, path, backup, preExisting, installedHash, state }
 *   plugin-backend-config { id, path, prior, installedState, state }
 */
export function appendManifest(home, entry, nowIso) {
  return withHomeTransactionLock(home, () => {
    recoverStateTemporary(manifestPath(home), assertManifestStructure)
    const m = readManifest(home)
    m.entries.push({ at: nowIso || new Date().toISOString(), ...entry })
    writeJsonAtomically(manifestPath(home), m, assertManifestStructure)
    return m
  })
}

/**
 * A plain-language "here's what changed, here's the undo" receipt from the stamp.
 * Returns null when nothing is applied. (Issue #3 §4.)
 */
export function formatReceipt(home) {
  const stamp = readStamp(home)
  const a = stamp?.applied
  if (!a || !Object.keys(a).length) return null
  const lines = ['── What the pack changed (undo any time: node scripts/uninstall.mjs) ──']
  if (a.pets) {
    const was = a.pets.previousSlug || 'none'
    lines.push(
      `  • pets: ${(a.pets.slugs || []).join(', ')}` +
        (a.pets.activated ? ` (active: ${a.pets.activated}; was: ${was})` : '') +
        '  → uninstall restores your prior pet + config.yaml'
    )
  }
  if (a.petConfig) {
    lines.push(`  • pet config: ${a.petConfig.path}  → uninstall restores only the prior display.pet block`)
  }
  if (a.theme) {
    lines.push(`  • theme: ${a.theme.value} / ${a.theme.mode}  → uninstall reverts to ${a.theme.priorTheme || 'nous'} / ${a.theme.priorMode || 'light'}`)
  }
  if (a.desktopPlugin) {
    lines.push(`  • desktop plug-in: ${a.desktopPlugin.path}  → uninstall removes it or restores the prior file`)
  }
  if (a.pluginBackend) {
    lines.push(`  • telemetry backend: ${a.pluginBackend.path || a.pluginBackend.id}  → uninstall removes its files and restores its config lists`)
  }
  for (const t of ['statusbar', 'caduceus']) {
    if (a[t]) lines.push(`  • ${t}: applied via ${a[t].via}  → uninstall restores source from .orig (same Hermes version)`)
  }
  return lines.join('\n')
}

// --- state classifier ----------------------------------------------------------

function tierState({ repo, tier, stamp, agentHead, base }) {
  const sen = TIER_SENTINELS[tier]
  let present = false
  try {
    present = sen && existsSync(join(repo, sen.file)) && readFileSync(join(repo, sen.file), 'utf8').includes(sen.marker)
  } catch {
    present = false
  }
  const recorded = Boolean(stamp?.applied?.[tier])
  if (!recorded && !present) return 'fresh'
  if (recorded && !present) return 'reverted' // an update wiped it; re-apply needed
  // present in source:
  if (agentHead && base && agentHead !== base) return 'diverged'
  return 'applied'
}

/**
 * Classify the whole install so callers can plan instead of blindly redoing
 * work. Pure w.r.t. injected fs/git reads.
 * @returns {{ agentHead, base, onBase, stamp, tiers: Record<string,string> }}
 */
export function classifyState({ repo, home, base, agentHead, tiers = ['statusbar', 'caduceus'] }) {
  const stamp = readStamp(home)
  const out = { agentHead: agentHead || null, base: base || null, onBase: Boolean(agentHead && base && agentHead === base), stamp, tiers: {} }
  for (const t of tiers) out.tiers[t] = tierState({ repo, tier: t, stamp, agentHead, base })
  return out
}
