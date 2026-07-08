import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activatePetInConfig } from '../lib/config-edit.mjs'

const BASE = [
  'model:',
  '  default: x',
  'display:',
  '  compact: false',
  '  pet:',
  '    enabled: false',
  '    slug: old-pet',
  '    scale: 0.66',
  'stt:',
  '  enabled: true',
  '',
].join('\n')

test('replaces slug and flips enabled to true', () => {
  const out = activatePetInConfig(BASE, 'noir-neko-ascii-fine')
  assert.match(out, /^ {4}slug: noir-neko-ascii-fine$/m)
  assert.match(out, /^ {4}enabled: true$/m)
  assert.match(out, /^ {4}scale: 0\.66$/m) // untouched sibling preserved
  assert.match(out, /^stt:$/m) // later blocks preserved
})

test('inserts slug/enabled when the pet block lacks them', () => {
  const text = ['display:', '  pet:', '    scale: 0.5', 'other: 1', ''].join('\n')
  const out = activatePetInConfig(text, 'noir-neko')
  assert.match(out, /^ {4}enabled: true$/m)
  assert.match(out, /^ {4}slug: noir-neko$/m)
  assert.match(out, /^ {4}scale: 0\.5$/m)
})

test('throws when there is no display block at all', () => {
  assert.throws(() => activatePetInConfig('model:\n  default: x\n', 'p'), /display/)
})

test('throws when display exists but has no pet block', () => {
  assert.throws(() => activatePetInConfig('display:\n  compact: false\n', 'p'), /pet/)
})
