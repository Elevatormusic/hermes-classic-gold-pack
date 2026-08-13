import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { recordApplied } from '../lib/pack-stamp.mjs'
import { main } from '../update-hermes.mjs'

function temporaryRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'classic-gold-update-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function output() {
  const messages = { error: [], log: [], warn: [] }
  return {
    io: {
      error: message => messages.error.push(message),
      log: message => messages.log.push(message),
      warn: message => messages.warn.push(message),
    },
    messages,
  }
}

test('update refuses multiple auto-detected homes before it runs Hermes', t => {
  const root = temporaryRoot(t)
  const preferred = join(root, 'preferred')
  const localAppData = join(root, 'local-app-data')
  const second = join(localAppData, 'hermes')
  mkdirSync(preferred, { recursive: true })
  mkdirSync(second, { recursive: true })
  writeFileSync(join(preferred, 'config.yaml'), 'display: {}\n')
  writeFileSync(join(second, 'config.yaml'), 'display: {}\n')
  const spawn = t.mock.fn(() => {
    throw new Error('Hermes must not run')
  })
  const { io, messages } = output()

  const status = main({
    env: {
      HERMES_HOME: preferred,
      LOCALAPPDATA: localAppData,
      USERPROFILE: join(root, 'profile'),
    },
    io,
    platform: 'win32',
    spawn,
  })

  assert.equal(status, 1)
  assert.equal(spawn.mock.callCount(), 0)
  assert.match(messages.error.join('\n'), /More than one Hermes install/)
  assert.match(messages.error.join('\n'), /--home <path>/)
})

test('update rejects a missing home value before it runs Hermes', t => {
  const spawn = t.mock.fn(() => {
    throw new Error('Hermes must not run')
  })
  const { io, messages } = output()

  const status = main({ argv: ['--home'], env: {}, io, platform: 'win32', spawn })

  assert.equal(status, 1)
  assert.equal(spawn.mock.callCount(), 0)
  assert.match(messages.error.join('\n'), /--home requires a value/)
})

test('explicit home ignores an unrelated repository environment value', t => {
  const root = temporaryRoot(t)
  const home = join(root, 'home')
  const externalRepo = join(root, 'external-repo')
  mkdirSync(join(externalRepo, 'apps', 'desktop'), { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'config.yaml'), 'display: {}\n')
  const spawn = t.mock.fn(() => {
    throw new Error('Hermes must not run')
  })
  const { io, messages } = output()

  const status = main({
    env: {
      HERMES_AGENT_REPO: externalRepo,
      LOCALAPPDATA: join(root, 'local-app-data'),
      USERPROFILE: root,
    },
    argv: ['--home', home],
    io,
    platform: 'win32',
    spawn,
  })

  assert.equal(status, 1)
  assert.equal(spawn.mock.callCount(), 0)
  assert.match(messages.error.join('\n'), /Not a hermes-agent checkout/)
  assert.match(messages.error.join('\n'), /home[\\/]hermes-agent/)
  assert.doesNotMatch(messages.error.join('\n'), /external-repo/)
})

test('explicit home and external repo form an approved association', t => {
  const root = temporaryRoot(t)
  const home = join(root, 'home')
  const repo = join(root, 'external-repo')
  mkdirSync(join(repo, 'apps', 'desktop'), { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'config.yaml'), 'display: {}\n')
  const spawn = t.mock.fn(() => ({ status: 0 }))
  const { io } = output()

  const status = main({
    argv: ['--home', home, '--repo', repo, '--branch', 'release/test'],
    env: {},
    io,
    platform: 'win32',
    spawn,
  })

  assert.equal(status, 0)
  assert.equal(spawn.mock.callCount(), 1)
  const [command, args, options] = spawn.mock.calls[0].arguments
  assert.equal(command, 'hermes')
  assert.deepEqual(args, ['update', '--branch', 'release/test'])
  assert.equal(options.cwd, repo)
})

test('a home-owned checkout is associated without an explicit repo', t => {
  const root = temporaryRoot(t)
  const home = join(root, 'home')
  const repo = join(home, 'hermes-agent')
  mkdirSync(join(repo, 'apps', 'desktop'), { recursive: true })
  writeFileSync(join(home, 'config.yaml'), 'display: {}\n')
  const spawn = t.mock.fn(() => ({ status: 0 }))
  const { io } = output()

  const status = main({
    argv: ['--home', home],
    env: {},
    io,
    platform: 'win32',
    spawn,
  })

  assert.equal(status, 0)
  assert.equal(spawn.mock.callCount(), 1)
  assert.equal(spawn.mock.calls[0].arguments[2].cwd, repo)
})

test('legacy refusal prints the exact explicit migration command', t => {
  const root = temporaryRoot(t)
  const home = join(root, 'home')
  const repo = join(root, 'external-repo')
  mkdirSync(join(repo, 'apps', 'desktop'), { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'config.yaml'), 'display: {}\n')
  recordApplied(home, 'statusbar', { via: 'patch' })
  const spawn = t.mock.fn(() => {
    throw new Error('Hermes must not run')
  })
  const { io, messages } = output()

  const status = main({
    argv: ['--home', home, '--repo', repo],
    env: {},
    io,
    platform: 'win32',
    spawn,
  })

  assert.equal(status, 1)
  assert.equal(spawn.mock.callCount(), 0)
  assert.match(messages.error.join('\n'), /Legacy Classic Gold source patches/)
  assert.ok(
    messages.error.includes(
      `  First run: node scripts/migrate-to-plugin.mjs --home ${JSON.stringify(home)} --repo ${JSON.stringify(repo)}`,
    ),
  )
})
