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
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const STAMP_FILE = 'hermes-classic-gold-pack.json'
export const MANIFEST_FILE = 'hermes-classic-gold-pack.manifest.json'

// Sentinel strings that prove a tier is currently applied in the live source —
// used to detect a revert (a Hermes update wiped the tier but the stamp remains).
export const TIER_SENTINELS = {
  statusbar: {
    file: 'apps/desktop/src/app/shell/statusbar-controls.tsx',
    marker: 'function TelemetryTape',
  },
  caduceus: {
    file: 'apps/desktop/src/components/chat/intro.tsx',
    marker: 'aria-label={WORDMARK}',
  },
}

function readJson(path, fallback) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback
  } catch {
    return fallback // corrupt file — treat as absent
  }
}

export function stampPath(home) {
  return join(home, STAMP_FILE)
}

export function readStamp(home) {
  return readJson(stampPath(home), null)
}

/**
 * Merge an "applied" entry into the stamp and write it. Authoritative record of
 * one component being installed.
 * @param {string} home  HERMES_HOME
 * @param {string} key   'statusbar' | 'caduceus' | 'pets' | 'theme'
 * @param {object} entry component-specific fields (e.g. {via, agentHead})
 * @param {object} [meta] {version, base, agentHead, nowIso}
 * @returns {object} the written stamp
 */
export function recordApplied(home, key, entry, meta = {}) {
  const now = meta.nowIso || new Date().toISOString()
  const stamp = readStamp(home) || { pack: 'hermes-classic-gold-pack', applied: {} }
  if (meta.version) stamp.version = meta.version
  if (meta.base) stamp.base = meta.base
  if (meta.agentHead) stamp.agentHead = meta.agentHead
  stamp.applied = stamp.applied || {}
  stamp.applied[key] = { at: now, ...entry }
  writeFileSync(stampPath(home), JSON.stringify(stamp, null, 2))
  return stamp
}

/** Remove a component from the stamp (used by the uninstaller). */
export function clearApplied(home, key) {
  const stamp = readStamp(home)
  if (!stamp?.applied?.[key]) return
  delete stamp.applied[key]
  writeFileSync(stampPath(home), JSON.stringify(stamp, null, 2))
}

// --- manifest (append-only undo receipts) --------------------------------------

export function manifestPath(home) {
  return join(home, MANIFEST_FILE)
}

export function readManifest(home) {
  return readJson(manifestPath(home), { pack: 'hermes-classic-gold-pack', entries: [] })
}

/**
 * Append one undo receipt. Each entry is `{ type, at, ...fields }`; the
 * uninstaller reads them newest-first. Types:
 *   pet     { slug, dir, preExisting }
 *   config  { path, backup, priorSlug }
 *   file    { rel, orig, agentHead, method }   (advanced-tier source file)
 *   theme   { keys, priorTheme, priorMode }
 */
export function appendManifest(home, entry, nowIso) {
  const m = readManifest(home)
  m.entries.push({ at: nowIso || new Date().toISOString(), ...entry })
  writeFileSync(manifestPath(home), JSON.stringify(m, null, 2))
  return m
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
  if (a.theme) {
    lines.push(`  • theme: ${a.theme.value} / ${a.theme.mode}  → uninstall reverts to ${a.theme.priorTheme || 'nous'} / ${a.theme.priorMode || 'light'}`)
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
