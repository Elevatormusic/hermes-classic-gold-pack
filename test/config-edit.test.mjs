import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activatePetInConfig, petConfigBlock, replacePetConfigBlock } from '../lib/config-edit.mjs'

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

function assertPetApisReject(text, pattern) {
  assert.throws(() => activatePetInConfig(text, 'noir-neko'), pattern)
  assert.throws(() => petConfigBlock(text), pattern)
  assert.throws(() => replacePetConfigBlock(text, null), pattern)
}

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

test('creates a pet block when display exists but has none (clean config, issue #1)', () => {
  const text = ['model:', '  default: x', 'display:', '  compact: false', 'stt:', '  enabled: true', ''].join('\n')
  const out = activatePetInConfig(text, 'noir-neko-ascii-fine')
  assert.match(out, /^ {2}pet:$/m)
  assert.match(out, /^ {4}enabled: true$/m)
  assert.match(out, /^ {4}slug: noir-neko-ascii-fine$/m)
  assert.match(out, /^ {2}compact: false$/m) // sibling preserved
  assert.match(out, /^stt:$/m) // block after display preserved
  // valid single pet block (no duplicate keys)
  assert.equal((out.match(/^ {2}pet:$/gm) || []).length, 1)
})

test('creates pet block even when display is the last block with no children', () => {
  const out = activatePetInConfig('model:\n  x: 1\ndisplay:\n', 'noir-neko')
  assert.match(out, /^ {2}pet:$/m)
  assert.match(out, /^ {4}slug: noir-neko$/m)
})

test('restores only the prior pet block and keeps later settings', () => {
  const installed = activatePetInConfig(BASE, 'noir-neko-ascii-fine')
  const later = installed.replace('stt:\n', 'new_setting: keep\nstt:\n')
  const restored = replacePetConfigBlock(later, petConfigBlock(BASE))

  assert.equal(petConfigBlock(restored), petConfigBlock(BASE))
  assert.match(restored, /^new_setting: keep$/m)
})

test('removes a pack-created pet block without changing display siblings', () => {
  const original = 'display:\n  compact: false\nother: true\n'
  const installed = activatePetInConfig(original, 'noir-neko')
  const restored = replacePetConfigBlock(installed, null)

  assert.equal(restored, original)
})

test('rejects tab indentation', () => {
  const text = 'display:\n\tpet:\n\t  enabled: false\n'
  assertPetApisReject(text, /tab for indentation/)
})

test('rejects duplicate top-level display blocks', () => {
  const text = [
    'display:',
    '  compact: false',
    'display:',
    '  pet:',
    '    enabled: false',
    '',
  ].join('\n')
  assertPetApisReject(text, /duplicate top-level/)

  const quotedDuplicate = 'display:\n  compact: false\n"display":\n  compact: true\n'
  assertPetApisReject(quotedDuplicate, /duplicate top-level/)
})

test('rejects duplicate direct display.pet blocks', () => {
  const text = [
    'display:',
    '  pet:',
    '    enabled: false',
    '  pet:',
    '    slug: second',
    '',
  ].join('\n')
  assertPetApisReject(text, /duplicate direct/)
})

test('rejects a nested display.other.pet key', () => {
  const text = [
    'display:',
    '  other:',
    '    pet:',
    '      enabled: false',
    '',
  ].join('\n')
  assertPetApisReject(text, /nested "pet:"/)
})

test('rejects ambiguous display indentation', () => {
  const text = [
    'display:',
    '  compact: false',
    '   pet:',
    '      enabled: false',
    '',
  ].join('\n')
  assertPetApisReject(text, /ambiguous indentation/)
})

test('rejects duplicate direct slug and enabled keys', () => {
  for (const duplicate of [
    ['    slug: first', '    slug: second'],
    ['    enabled: false', '    enabled: true'],
  ]) {
    const text = ['display:', '  pet:', ...duplicate, ''].join('\n')
    assertPetApisReject(text, /duplicate "display\.pet\.(slug|enabled)"/)
  }
})

test('rejects non-scalar and nested display.pet children', () => {
  const nested = [
    'display:',
    '  pet:',
    '    appearance:',
    '      scale: 1',
    '',
  ].join('\n')
  const flowCollection = [
    'display:',
    '  pet:',
    '    tags: [gold, classic]',
    '',
  ].join('\n')
  assertPetApisReject(nested, /direct scalar/)
  assertPetApisReject(flowCollection, /direct scalar/)
})

test('preserves comments, CRLF, four-space indentation, and unrelated settings', () => {
  const input = [
    'display: # renderer settings',
    '    compact: false # keep this',
    '    pet: # selected pet',
    '    # child comment',
    '        enabled: false # state',
    '        slug: old-pet # name',
    '        scale: 0.66 # size',
    '    # next setting',
    '    color: gold',
    'stt:',
    '    enabled: true',
    '',
  ].join('\r\n')

  const output = activatePetInConfig(input, 'noir-neko')
  assert.match(output, /^ {8}enabled: true # state\r$/m)
  assert.match(output, /^ {8}slug: noir-neko # name\r$/m)
  assert.match(output, /^ {8}scale: 0\.66 # size\r$/m)
  assert.match(output, /^ {4}# next setting\r$/m)
  assert.match(output, /^ {4}color: gold\r$/m)
  assert.match(output, /^stt:\r$/m)
  assert.equal(output.replaceAll('\r\n', '').includes('\n'), false)

  const block = petConfigBlock(output)
  assert.match(block, /# child comment/)
  assert.doesNotMatch(block, /# next setting/)
})
