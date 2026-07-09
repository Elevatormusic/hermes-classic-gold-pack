import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { resolveAgentRepo, hermesExePath } from '../lib/agent-repo.mjs'

const existsFor = (...hits) => (p) => hits.includes(p)

test('explicit --repo wins', () => {
  assert.equal(resolveAgentRepo({ explicit: '/x/repo', exists: () => true }), '/x/repo')
})

test('HERMES_AGENT_REPO env is honoured', () => {
  assert.equal(resolveAgentRepo({ env: { HERMES_AGENT_REPO: '/env/repo' }, exists: () => false }), '/env/repo')
})

test('prefers HERMES_HOME/hermes-agent when it is a checkout', () => {
  const home = '/h'
  const got = resolveAgentRepo({
    env: { HERMES_HOME: home, LOCALAPPDATA: 'C:\\la' },
    platform: 'win32',
    exists: existsFor(join(home, 'config.yaml'), join(home, 'hermes-agent', 'apps', 'desktop')),
  })
  assert.equal(got, join(home, 'hermes-agent'))
})

test('falls back to LOCALAPPDATA/hermes/hermes-agent when HERMES_HOME has no checkout', () => {
  const la = 'C:\\la'
  const laRepo = join(la, 'hermes', 'hermes-agent')
  const got = resolveAgentRepo({
    env: { LOCALAPPDATA: la }, // no HERMES_HOME with config.yaml
    platform: 'win32',
    exists: existsFor(join(la, 'hermes', 'config.yaml'), join(laRepo, 'apps', 'desktop')),
  })
  assert.equal(got, laRepo)
})

test('returns a best-guess path when nothing is a checkout', () => {
  const got = resolveAgentRepo({ env: { LOCALAPPDATA: 'C:\\la' }, platform: 'win32', exists: () => false })
  assert.equal(got, join('C:\\la', 'hermes', 'hermes-agent'))
})

test('hermesExePath points at the packaged exe', () => {
  assert.equal(hermesExePath('/r'), join('/r', 'apps', 'desktop', 'release', 'win-unpacked', 'Hermes.exe'))
})
