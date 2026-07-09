import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  recordApplied, readStamp, clearApplied, appendManifest, readManifest, classifyState, formatReceipt, TIER_SENTINELS,
} from '../lib/pack-stamp.mjs'

function tmp() {
  return mkdtempSync(join(tmpdir(), 'hcgp-'))
}
const NOW = '2026-07-09T00:00:00.000Z'

test('recordApplied writes and merges; readStamp reads back', () => {
  const home = tmp()
  try {
    recordApplied(home, 'statusbar', { via: 'patch', agentHead: 'abc' }, { version: '1.0.0', base: 'abc', nowIso: NOW })
    recordApplied(home, 'caduceus', { via: 'copy' }, { nowIso: NOW })
    const s = readStamp(home)
    assert.equal(s.version, '1.0.0')
    assert.equal(s.base, 'abc')
    assert.equal(s.applied.statusbar.via, 'patch')
    assert.equal(s.applied.statusbar.at, NOW)
    assert.equal(s.applied.caduceus.via, 'copy') // merge kept both
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('clearApplied removes one component', () => {
  const home = tmp()
  try {
    recordApplied(home, 'pets', { slugs: ['x'] }, { nowIso: NOW })
    recordApplied(home, 'theme', { value: 'g' }, { nowIso: NOW })
    clearApplied(home, 'theme')
    const s = readStamp(home)
    assert.ok(s.applied.pets)
    assert.equal(s.applied.theme, undefined)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('appendManifest accumulates undo receipts', () => {
  const home = tmp()
  try {
    appendManifest(home, { type: 'pet', slug: 'a', preExisting: false }, NOW)
    appendManifest(home, { type: 'config', priorSlug: 'old' }, NOW)
    const m = readManifest(home)
    assert.equal(m.entries.length, 2)
    assert.equal(m.entries[0].type, 'pet')
    assert.equal(m.entries[1].priorSlug, 'old')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('formatReceipt: null when empty, lines with undo when applied', () => {
  const home = tmp()
  try {
    assert.equal(formatReceipt(home), null)
    recordApplied(home, 'pets', { slugs: ['a', 'b'], activated: 'a', previousSlug: 'old' }, { nowIso: NOW })
    recordApplied(home, 'theme', { value: 'hermes-classic-gold', mode: 'dark', priorTheme: 'nous', priorMode: 'light' }, { nowIso: NOW })
    const r = formatReceipt(home)
    assert.match(r, /node scripts\/uninstall\.mjs/)
    assert.match(r, /pets: a, b .*was: old/)
    assert.match(r, /theme: hermes-classic-gold.*reverts to nous/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

// classifyState — build a fake repo with/without the statusbar sentinel.
function fakeRepo(withMarker) {
  const repo = tmp()
  const sen = TIER_SENTINELS.statusbar
  const p = join(repo, sen.file)
  mkdirSync(join(repo, sen.file, '..'), { recursive: true })
  writeFileSync(p, withMarker ? `x\n${sen.marker}\ny` : 'stock file, no marker')
  return repo
}

test('classifyState: fresh (no stamp, no sentinel)', () => {
  const home = tmp()
  const repo = fakeRepo(false)
  try {
    const st = classifyState({ repo, home, base: 'B', agentHead: 'B', tiers: ['statusbar'] })
    assert.equal(st.tiers.statusbar, 'fresh')
    assert.equal(st.onBase, true)
  } finally {
    rmSync(home, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true })
  }
})

test('classifyState: applied (stamp + sentinel + on base)', () => {
  const home = tmp()
  const repo = fakeRepo(true)
  try {
    recordApplied(home, 'statusbar', { via: 'patch' }, { nowIso: NOW })
    const st = classifyState({ repo, home, base: 'B', agentHead: 'B', tiers: ['statusbar'] })
    assert.equal(st.tiers.statusbar, 'applied')
  } finally {
    rmSync(home, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true })
  }
})

test('classifyState: reverted (stamped, but an update wiped the sentinel)', () => {
  const home = tmp()
  const repo = fakeRepo(false)
  try {
    recordApplied(home, 'statusbar', { via: 'patch' }, { nowIso: NOW })
    const st = classifyState({ repo, home, base: 'B', agentHead: 'B', tiers: ['statusbar'] })
    assert.equal(st.tiers.statusbar, 'reverted')
  } finally {
    rmSync(home, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true })
  }
})

test('classifyState: caduceus detected from the Backdrop sentinel (not stock intro WORDMARK)', () => {
  const home = tmp()
  const repo = tmp()
  const sen = TIER_SENTINELS.caduceus
  mkdirSync(join(repo, sen.file, '..'), { recursive: true })
  try {
    writeFileSync(join(repo, sen.file), `x\nconst ${sen.marker} = []\n`)
    let st = classifyState({ repo, home, base: 'B', agentHead: 'B', tiers: ['caduceus'] })
    assert.equal(st.tiers.caduceus, 'applied')
    // stock Backdrop (no HERMES_CADUCEUS) → not applied, even though stock intro
    // has aria-label={WORDMARK} (the old, wrong sentinel).
    writeFileSync(join(repo, sen.file), 'stock backdrop, aria-label={WORDMARK} lives in intro\n')
    st = classifyState({ repo, home, base: 'B', agentHead: 'B', tiers: ['caduceus'] })
    assert.equal(st.tiers.caduceus, 'fresh')
  } finally {
    rmSync(home, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true })
  }
})

test('classifyState: diverged (sentinel present but HEAD != BASE)', () => {
  const home = tmp()
  const repo = fakeRepo(true)
  try {
    const st = classifyState({ repo, home, base: 'B', agentHead: 'DIFFERENT', tiers: ['statusbar'] })
    assert.equal(st.tiers.statusbar, 'diverged')
    assert.equal(st.onBase, false)
  } finally {
    rmSync(home, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true })
  }
})
