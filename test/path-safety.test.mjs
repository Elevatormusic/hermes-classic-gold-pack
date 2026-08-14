import assert from 'node:assert/strict'
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { assertSafeManagedPath, isPathInside, sameManagedPath } from '../lib/path-safety.mjs'

function temporaryRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'classic-gold-path-'))
  t.after(() => rmSync(root, { force: true, recursive: true }))
  return root
}

test('managed paths must stay inside the selected root', t => {
  const root = temporaryRoot(t)
  const outside = temporaryRoot(t)

  assert.equal(isPathInside(root, join(root, 'plugins', 'classic-gold')), true)
  assert.equal(isPathInside(root, outside), false)
  assert.throws(
    () => assertSafeManagedPath(root, join(outside, 'plugin.js')),
    /outside the selected root/,
  )
})

test('managed paths reject an existing symbolic-link ancestor', t => {
  const root = temporaryRoot(t)
  const outside = temporaryRoot(t)
  const linked = join(root, 'desktop-plugins')
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, 'keep.txt'), 'outside\n')
  try {
    symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    t.skip(`This environment cannot create a test link: ${error.code || error.message}`)
    return
  }

  assert.throws(
    () => assertSafeManagedPath(root, join(linked, 'classic-gold', 'plugin.js')),
    /symbolic link or junction/,
  )
})

test('managed paths allow missing normal descendants', t => {
  const root = temporaryRoot(t)
  assert.doesNotThrow(() => {
    assertSafeManagedPath(root, join(root, 'plugins', 'classic-gold', 'dashboard', 'plugin_api.py'))
  })
})

test('managed paths reject an existing hard-linked file', t => {
  const root = temporaryRoot(t)
  const outside = temporaryRoot(t)
  const target = join(root, 'plugin.js')
  const source = join(outside, 'outside.js')
  writeFileSync(source, 'outside\n')
  try {
    linkSync(source, target)
  } catch (error) {
    t.skip(`This environment cannot create a hard link: ${error.code || error.message}`)
    return
  }

  assert.throws(
    () => assertSafeManagedPath(root, target),
    /hard-linked file/,
  )
})

test('Windows managed path identity ignores path casing', () => {
  assert.equal(
    sameManagedPath('C:\\Users\\Example\\Hermes', 'c:\\users\\example\\hermes', { platform: 'win32' }),
    true,
  )
})
