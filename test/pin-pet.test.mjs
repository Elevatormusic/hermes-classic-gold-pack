import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pinPet, PINNED_FILE } from '../lib/pin-pet.mjs'

test('pinPet writes the pinned record into HERMES_HOME', () => {
  const home = mkdtempSync(join(tmpdir(), 'gold-pin-'))
  const p = pinPet(home, 'noir-neko', { nowIso: '2026-01-01T00:00:00Z' })
  assert.ok(existsSync(p))
  const rec = JSON.parse(readFileSync(join(home, PINNED_FILE), 'utf8'))
  assert.equal(rec.slug, 'noir-neko')
  assert.equal(rec.pinnedAt, '2026-01-01T00:00:00Z')
})
