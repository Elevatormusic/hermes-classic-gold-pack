import { test } from 'node:test'
import assert from 'node:assert/strict'
import { preflight } from '../lib/preflight.mjs'

test('passes with no requirements', () => {
  const r = preflight({})
  assert.equal(r.ok, true)
  assert.deepEqual(r.problems, [])
})

test('flags a Node version that is too old', () => {
  const r = preflight({ needsNode: 999 })
  assert.equal(r.ok, false)
  assert.match(r.problems[0], /Node 999\+ required/)
})

test('flags a missing apps/desktop/node_modules when building', () => {
  const r = preflight({ repo: '/definitely/not/a/real/repo', needsBuild: true })
  assert.equal(r.ok, false)
  assert.match(r.problems.join('\n'), /node_modules is missing/)
})

test('does not check build deps when needsBuild is false', () => {
  const r = preflight({ repo: '/definitely/not/a/real/repo', needsBuild: false })
  assert.equal(r.ok, true)
})
