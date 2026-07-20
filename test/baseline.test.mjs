import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectBaseline, compareSemver } from '../lib/baseline.mjs'

const BL = [
  { id: '0.17.0-4d7f8ad', commit: 'aaa', appVersion: '0.17.0', electronExt: 'cjs' },
  { id: '0.17.0-d7b3607', commit: 'bbb', appVersion: '0.17.0', electronExt: 'ts' }
]
const io = (head, ver, ext) => ({ readHead: () => head, readAppVersion: () => ver, detectElectronExt: () => ext })

test('compareSemver orders x.y.z', () => {
  assert.equal(compareSemver('0.17.0', '0.17.0'), 0)
  assert.equal(compareSemver('0.16.9', '0.17.0'), -1)
  assert.equal(compareSemver('1.0.0', '0.17.0'), 1)
})

test('exact commit wins', () => {
  const r = selectBaseline({ repo: '.', baselines: BL, io: io('bbb', '0.17.0', 'ts') })
  assert.equal(r.matchType, 'commit')
  assert.equal(r.baseline.id, '0.17.0-d7b3607')
})

test('unknown commit, same semver → electron probe picks ts', () => {
  const r = selectBaseline({ repo: '.', baselines: BL, io: io('zzz', '0.17.0', 'ts') })
  assert.equal(r.matchType, 'electron')
  assert.equal(r.baseline.id, '0.17.0-d7b3607')
})

test('unknown commit, same semver → electron probe picks cjs', () => {
  const r = selectBaseline({ repo: '.', baselines: BL, io: io('zzz', '0.17.0', 'cjs') })
  assert.equal(r.matchType, 'electron')
  assert.equal(r.baseline.id, '0.17.0-4d7f8ad')
})

test('electron era with no matching baseline → none', () => {
  const r = selectBaseline({ repo: '.', baselines: BL, io: io('zzz', '0.18.0', 'mjs') })
  assert.equal(r.matchType, 'none')
  assert.equal(r.baseline, null)
})

test('appVersion below all baselines → none', () => {
  const r = selectBaseline({ repo: '.', baselines: BL, io: io('zzz', '0.15.0', 'ts') })
  assert.equal(r.matchType, 'none')
})

test('empty/malformed list → none, no throw', () => {
  const r = selectBaseline({ repo: '.', baselines: [], io: io('x', '0.17.0', 'ts') })
  assert.equal(r.matchType, 'none')
})
