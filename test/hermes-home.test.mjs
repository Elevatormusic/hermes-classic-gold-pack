import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { resolveHermesHome, findHermesHomes } from '../lib/hermes-home.mjs'

const existsFor = (...hits) => (p) => hits.includes(p)

test('prefers explicit --home when it has config.yaml', () => {
  const env = { HERMES_HOME: '/env/hermes', LOCALAPPDATA: 'C:\\la' }
  const got = resolveHermesHome({
    explicit: '/explicit', env, platform: 'win32',
    exists: existsFor(join('/explicit', 'config.yaml'), join('/env/hermes', 'config.yaml')),
  })
  assert.equal(got, '/explicit')
})

test('explicit --home is authoritative: returns null (no fallback) when it lacks config.yaml', () => {
  // Even though the real LOCALAPPDATA/hermes has config.yaml, a bad --home must fail.
  const laHome = join('C:\\la', 'hermes')
  const got = resolveHermesHome({
    explicit: '/typo', env: { LOCALAPPDATA: 'C:\\la' }, platform: 'win32',
    exists: existsFor(join(laHome, 'config.yaml')),
  })
  assert.equal(got, null)
})

test('windows falls back to LOCALAPPDATA/hermes', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local', USERPROFILE: 'C:\\Users\\x' }
  const laHome = join('C:\\Users\\x\\AppData\\Local', 'hermes')
  const got = resolveHermesHome({
    env, platform: 'win32', exists: existsFor(join(laHome, 'config.yaml')),
  })
  assert.equal(got, laHome)
})

test('darwin uses Application Support', () => {
  const env = { HOME: '/Users/x' }
  const mac = join('/Users/x', 'Library', 'Application Support', 'hermes')
  const got = resolveHermesHome({ env, platform: 'darwin', exists: existsFor(join(mac, 'config.yaml')) })
  assert.equal(got, mac)
})

test('returns null when nothing has config.yaml', () => {
  const got = resolveHermesHome({ env: { HOME: '/Users/x' }, platform: 'linux', exists: () => false })
  assert.equal(got, null)
})

test('findHermesHomes flags ambiguity: >1 install with config.yaml', () => {
  const env = { HERMES_HOME: '/env/hermes', LOCALAPPDATA: 'C:\\la', USERPROFILE: 'C:\\Users\\x' }
  const la = join('C:\\la', 'hermes')
  const all = findHermesHomes({
    env, platform: 'win32', exists: existsFor(join('/env/hermes', 'config.yaml'), join(la, 'config.yaml')),
  })
  assert.deepEqual(all, ['/env/hermes', la])
  assert.equal(all.length > 1, true) // install.mjs refuses to guess in this case
})

test('findHermesHomes de-dupes when HERMES_HOME equals a default', () => {
  const la = join('C:\\la', 'hermes')
  const all = findHermesHomes({
    env: { HERMES_HOME: la, LOCALAPPDATA: 'C:\\la' }, platform: 'win32',
    exists: existsFor(join(la, 'config.yaml')),
  })
  assert.deepEqual(all, [la]) // one physical dir, not two
})
