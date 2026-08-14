import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  appendManifest,
  canonicalHomeKey,
  classifyState,
  clearApplied,
  formatReceipt,
  PACK_LOCK_OWNER_FILE,
  PACK_LOCK_STALE_MS,
  PACK_STATE_TEMP_SUFFIX,
  readManifest,
  readStamp,
  recordApplied,
  manifestPath,
  stampPath,
  TIER_SENTINELS,
  transactionLockPath,
  withHomeTransactionLock,
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

test('a valid deterministic stamp temporary file completes before mutation', () => {
  const home = tmp()
  const temporary = `${stampPath(home)}${PACK_STATE_TEMP_SUFFIX}`
  try {
    writeFileSync(temporary, JSON.stringify({
      pack: 'hermes-classic-gold-pack',
      applied: { pets: { at: NOW, slugs: ['noir-neko-gold'] } },
    }))

    recordApplied(home, 'theme', { value: 'gold' }, { nowIso: NOW })

    assert.equal(existsSync(temporary), false)
    assert.deepEqual(readStamp(home).applied.pets.slugs, ['noir-neko-gold'])
    assert.equal(readStamp(home).applied.theme.value, 'gold')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a truncated deterministic manifest temporary file is removed before mutation', () => {
  const home = tmp()
  const temporary = `${manifestPath(home)}${PACK_STATE_TEMP_SUFFIX}`
  try {
    appendManifest(home, { type: 'test', transactionId: 'committed' }, NOW)
    writeFileSync(temporary, '{truncated')

    appendManifest(home, { type: 'test', transactionId: 'after-recovery' }, NOW)

    assert.equal(existsSync(temporary), false)
    assert.deepEqual(
      readManifest(home).entries.map(entry => entry.transactionId),
      ['committed', 'after-recovery'],
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('mutation reads reject corrupt and structurally invalid state', () => {
  const home = tmp()
  try {
    writeFileSync(stampPath(home), '{not-json')
    assert.throws(() => readStamp(home), /not valid JSON/)
    assert.throws(() => recordApplied(home, 'theme', { value: 'gold' }), /not valid JSON/)

    writeFileSync(stampPath(home), JSON.stringify({ applied: [] }))
    assert.throws(() => readStamp(home), /invalid structure/)
    assert.throws(() => recordApplied(home, 'theme', { value: 'gold' }), /invalid structure/)

    writeFileSync(manifestPath(home), JSON.stringify({ entries: [null] }))
    assert.throws(() => readManifest(home), /invalid structure/)
    assert.throws(() => appendManifest(home, { type: 'test' }), /invalid structure/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('the canonical profile lock is reentrant for state helpers', () => {
  const home = tmp()
  const alias = join(home, 'missing-child', '..')
  const lock = transactionLockPath(home)
  try {
    assert.equal(canonicalHomeKey(alias), canonicalHomeKey(home))
    assert.equal(transactionLockPath(alias), lock)

    withHomeTransactionLock(alias, () => {
      assert.equal(existsSync(lock), true)
      const owner = JSON.parse(readFileSync(join(lock, PACK_LOCK_OWNER_FILE), 'utf8'))
      assert.equal(owner.pid, process.pid)
      assert.equal(typeof owner.acquiredAtUnixMs, 'number')
      appendManifest(home, { type: 'test', transactionId: 'nested' }, NOW)
      recordApplied(home, 'theme', { value: 'gold' }, { nowIso: NOW })
    })

    assert.equal(existsSync(lock), false)
    assert.equal(readManifest(home).entries.length, 1)
    assert.equal(readStamp(home).applied.theme.value, 'gold')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('the profile lock stays active until an asynchronous callback settles', async () => {
  const home = tmp()
  const lock = transactionLockPath(home)
  let release
  const gate = new Promise(resolve => { release = resolve })
  try {
    const pending = withHomeTransactionLock(home, async () => {
      await gate
    })
    assert.equal(existsSync(lock), true)
    assert.throws(
      () => withHomeTransactionLock(home, () => {}),
      /locked by another command/,
    )
    release()
    await pending
    assert.equal(existsSync(lock), false)
  } finally {
    release?.()
    rmSync(home, { recursive: true, force: true })
  }
})

test('an old lock with a live owner is not recovered', () => {
  const home = tmp()
  const lock = transactionLockPath(home)
  try {
    mkdirSync(lock)
    const acquiredAtUnixMs = Date.now() - PACK_LOCK_STALE_MS - 1_000
    writeFileSync(join(lock, PACK_LOCK_OWNER_FILE), JSON.stringify({
      acquiredAtUnixMs,
      pid: process.pid,
      token: 'stale-owner',
    }))

    assert.throws(
      () => appendManifest(home, { type: 'test', transactionId: 'must-not-write' }, NOW),
      /locked by another command/,
    )
    assert.equal(readManifest(home).entries.length, 0)
    assert.equal(existsSync(lock), true)
  } finally {
    rmSync(lock, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

test('a proved-dead owner lock is recovered before a state write', () => {
  const home = tmp()
  const lock = transactionLockPath(home)
  try {
    const exited = spawnSync(process.execPath, ['-e', 'process.exit(0)'])
    assert.equal(exited.status, 0)
    assert.equal(typeof exited.pid, 'number')
    mkdirSync(lock)
    writeFileSync(join(lock, PACK_LOCK_OWNER_FILE), JSON.stringify({
      acquiredAtUnixMs: Date.now(),
      pid: exited.pid,
      token: 'dead-owner',
    }))

    appendManifest(home, { type: 'test', transactionId: 'after-dead-owner' }, NOW)

    assert.equal(readManifest(home).entries.at(-1).transactionId, 'after-dead-owner')
    assert.equal(existsSync(lock), false)
  } finally {
    rmSync(lock, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

test('a fresh lock without proved ownership is not recovered', () => {
  const home = tmp()
  const lock = transactionLockPath(home)
  try {
    mkdirSync(lock)

    assert.throws(
      () => appendManifest(home, { type: 'test', transactionId: 'must-not-write' }, NOW),
      /locked by another command/,
    )
    assert.equal(readManifest(home).entries.length, 0)
  } finally {
    rmSync(lock, { recursive: true, force: true })
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
