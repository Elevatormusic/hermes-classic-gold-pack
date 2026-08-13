import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { gitBlobHash } from '../lib/git-blob.mjs'
import { appendManifest, readManifest, readStamp, recordApplied, TIER_SENTINELS } from '../lib/pack-stamp.mjs'
import { executeMigration } from '../scripts/migrate-to-plugin.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout.trim()
}

function removeFixture(path) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true })
      return
    } catch (error) {
      if (!['EACCES', 'EBUSY', 'EPERM'].includes(error?.code) || attempt === 9) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
    }
  }
}

test('migration restores a recorded legacy patch without changing the clean index', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'classic-gold-migration-'))
  t.after(() => removeFixture(fixture))

  const home = join(fixture, 'home')
  const repo = join(fixture, 'hermes-agent')
  const sentinel = TIER_SENTINELS.statusbar
  const target = join(repo, sentinel.file)
  const original = 'export const stockStatusbar = true\n'
  const patched = `${original}\n${sentinel.marker}() {}\n`

  mkdirSync(dirname(target), { recursive: true })
  mkdirSync(join(home, 'pets'), { recursive: true })
  writeFileSync(join(home, 'config.yaml'), 'display:\n  pet:\n    enabled: false\n')
  writeFileSync(target, original)

  run('git', ['init'], repo)
  run('git', ['add', sentinel.file], repo)
  run('git', ['-c', 'user.name=Classic Gold Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'], repo)
  const head = run('git', ['rev-parse', 'HEAD'], repo)

  writeFileSync(`${target}.orig`, original)
  writeFileSync(target, patched)
  recordApplied(home, 'statusbar', { agentHead: head, via: 'patch' }, { agentHead: head })
  appendManifest(home, {
    type: 'file',
    tier: 'statusbar',
    rel: sentinel.file,
    orig: `${sentinel.file}.orig`,
    agentHead: head,
    method: 'patch',
    installedBlob: gitBlobHash(repo, sentinel.file, { asPath: sentinel.file })
  })

  const migrated = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts', 'migrate-to-plugin.mjs'), '--yes', '--home', home, '--repo', repo],
    { encoding: 'utf8' }
  )

  assert.equal(migrated.status, 0, migrated.stderr || migrated.stdout)
  assert.equal(readFileSync(target, 'utf8'), original)
  assert.equal(run('git', ['diff', '--cached', '--name-only'], repo), '')
  assert.equal(existsSync(join(home, 'desktop-plugins', 'classic-gold', 'plugin.js')), false)
  assert.equal(existsSync(join(home, 'plugins', 'classic-gold', 'dashboard', 'plugin_api.py')), false)
  assert.equal(readStamp(home).applied.statusbar, undefined)
  assert.equal(readStamp(home).applied.desktopPlugin, undefined)
  assert.match(migrated.stdout, /hermes update/)
  assert.match(migrated.stdout, /node install\.mjs/)
})

test('migration discovers a reconciled legacy file when the manifest is stale', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'classic-gold-reconcile-'))
  t.after(() => removeFixture(fixture))

  const home = join(fixture, 'home')
  const repo = join(fixture, 'hermes-agent')
  const sentinel = TIER_SENTINELS.statusbar
  const target = join(repo, sentinel.file)
  const original = 'export const stockStatusbar = true\n'

  mkdirSync(dirname(target), { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'config.yaml'), 'display:\n  pet:\n    enabled: false\n')
  writeFileSync(target, original)
  run('git', ['init'], repo)
  run('git', ['add', sentinel.file], repo)
  run('git', ['-c', 'user.name=Classic Gold Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'], repo)
  const head = run('git', ['rev-parse', 'HEAD'], repo)

  writeFileSync(`${target}.orig`, original)
  const bundled = join(
    ROOT,
    'advanced',
    'statusbar',
    'baselines',
    '0.17.0-d7b3607',
    'files',
    sentinel.file,
  )
  writeFileSync(target, readFileSync(bundled, 'utf8'))
  recordApplied(home, 'statusbar', { agentHead: head, via: 'reconcile' }, { agentHead: head })
  appendManifest(home, {
    type: 'file',
    tier: 'statusbar',
    rel: 'apps/desktop/electron/main.cjs',
    orig: 'apps/desktop/electron/main.cjs.orig',
    agentHead: 'older-head',
    method: 'patch'
  })

  const migrated = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts', 'migrate-to-plugin.mjs'), '--yes', '--home', home, '--repo', repo],
    { encoding: 'utf8' }
  )

  assert.equal(migrated.status, 0, migrated.stderr || migrated.stdout)
  assert.equal(readFileSync(target, 'utf8'), original)
  assert.equal(readStamp(home).applied.statusbar, undefined)
  assert.equal(readStamp(home).applied.desktopPlugin, undefined)
})

test('migration refuses a legacy target with later user edits', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'classic-gold-user-edit-'))
  t.after(() => removeFixture(fixture))

  const home = join(fixture, 'home')
  const repo = join(fixture, 'hermes-agent')
  const sentinel = TIER_SENTINELS.statusbar
  const target = join(repo, sentinel.file)
  const original = 'export const stockStatusbar = true\n'

  mkdirSync(dirname(target), { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'config.yaml'), 'display:\n  pet:\n    enabled: false\n')
  writeFileSync(target, original)
  run('git', ['init'], repo)
  run('git', ['add', sentinel.file], repo)
  run('git', ['-c', 'user.name=Classic Gold Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'], repo)
  const head = run('git', ['rev-parse', 'HEAD'], repo)

  writeFileSync(`${target}.orig`, original)
  writeFileSync(target, `${original}\n${sentinel.marker}() {}\nexport const userEdit = true\n`)
  recordApplied(home, 'statusbar', { agentHead: head, via: 'patch' }, { agentHead: head })
  appendManifest(home, {
    type: 'file', tier: 'statusbar', rel: sentinel.file,
    orig: `${sentinel.file}.orig`, agentHead: head, method: 'patch',
  })

  const migrated = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts', 'migrate-to-plugin.mjs'), '--yes', '--home', home, '--repo', repo],
    { encoding: 'utf8' },
  )

  assert.equal(migrated.status, 1)
  assert.match(migrated.stderr, /do not have safe same-version backups/)
  assert.match(readFileSync(target, 'utf8'), /userEdit/)
  assert.ok(readStamp(home).applied.statusbar)
})

test('migration refuses when a recorded current legacy target is deleted', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'classic-gold-deleted-target-'))
  t.after(() => removeFixture(fixture))

  const home = join(fixture, 'home')
  const repo = join(fixture, 'hermes-agent')
  const sentinel = TIER_SENTINELS.statusbar
  const target = join(repo, sentinel.file)
  const original = 'export const stockStatusbar = true\n'

  mkdirSync(dirname(target), { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'config.yaml'), 'display:\n  pet:\n    enabled: false\n')
  writeFileSync(target, original)
  run('git', ['init'], repo)
  run('git', ['add', sentinel.file], repo)
  run('git', ['-c', 'user.name=Classic Gold Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'], repo)
  const head = run('git', ['rev-parse', 'HEAD'], repo)
  writeFileSync(`${target}.orig`, original)
  rmSync(target)
  recordApplied(home, 'statusbar', { agentHead: head, via: 'patch' }, { agentHead: head })
  appendManifest(home, {
    type: 'file', tier: 'statusbar', rel: sentinel.file,
    orig: `${sentinel.file}.orig`, agentHead: head, method: 'patch',
  })

  const migrated = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts', 'migrate-to-plugin.mjs'), '--yes', '--home', home, '--repo', repo],
    { encoding: 'utf8' },
  )

  assert.equal(migrated.status, 1)
  assert.equal(existsSync(target), false)
  assert.ok(readStamp(home).applied.statusbar)
})

test('migration refuses to guess between auto-detected Hermes homes', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'classic-gold-ambiguous-home-'))
  t.after(() => removeFixture(fixture))

  const preferred = join(fixture, 'preferred')
  const localAppData = join(fixture, 'local-app-data')
  const second = join(localAppData, 'hermes')
  mkdirSync(preferred, { recursive: true })
  mkdirSync(second, { recursive: true })
  writeFileSync(join(preferred, 'config.yaml'), 'display: {}\n')
  writeFileSync(join(second, 'config.yaml'), 'display: {}\n')

  const migrated = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts', 'migrate-to-plugin.mjs'), '--yes', '--repo', join(fixture, 'hermes-agent')],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        HERMES_HOME: preferred,
        LOCALAPPDATA: localAppData,
        USERPROFILE: join(fixture, 'profile'),
      },
    },
  )

  assert.equal(migrated.status, 1)
  assert.match(migrated.stderr, /More than one Hermes install/)
  assert.equal(readStamp(preferred), null)
  assert.equal(readStamp(second), null)
})

test('migration rejects an incomplete home option before auto-detection', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'classic-gold-incomplete-home-'))
  t.after(() => removeFixture(fixture))
  const home = join(fixture, 'home')
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'config.yaml'), 'display: {}\n')

  const migrated = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts', 'migrate-to-plugin.mjs'), '--home'],
    { encoding: 'utf8', env: { ...process.env, HERMES_HOME: home } },
  )

  assert.equal(migrated.status, 1)
  assert.match(migrated.stderr, /--home requires a value/)
  assert.equal(readStamp(home), null)
})

test('explicit home ignores an unrelated repository environment value', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'classic-gold-migration-repo-association-'))
  t.after(() => removeFixture(fixture))

  const home = join(fixture, 'home')
  const externalRepo = join(fixture, 'external-repo')
  mkdirSync(join(externalRepo, 'apps', 'desktop'), { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'config.yaml'), 'display: {}\n')
  writeFileSync(join(externalRepo, 'outside-marker.txt'), 'unchanged\n')

  const migrated = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts', 'migrate-to-plugin.mjs'), '--yes', '--home', home],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        HERMES_AGENT_REPO: externalRepo,
        LOCALAPPDATA: join(fixture, 'local-app-data'),
      },
    },
  )

  assert.equal(migrated.status, 1)
  assert.match(migrated.stderr, /Not a hermes-agent checkout/)
  assert.match(migrated.stderr, /home[\\/]hermes-agent/)
  assert.doesNotMatch(migrated.stderr, /external-repo/)
  assert.equal(readFileSync(join(externalRepo, 'outside-marker.txt'), 'utf8'), 'unchanged\n')
  assert.equal(readStamp(home), null)
  assert.deepEqual(readManifest(home).entries, [])
})

test('migration preserves a staged user version of a Pack target', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'classic-gold-staged-user-edit-'))
  t.after(() => removeFixture(fixture))
  const home = join(fixture, 'home')
  const repo = join(fixture, 'hermes-agent')
  const sentinel = TIER_SENTINELS.statusbar
  const target = join(repo, sentinel.file)
  const original = 'export const stockStatusbar = true\n'
  const patched = `${original}${sentinel.marker}() {}\n`
  const stagedUser = `${patched}export const stagedUserEdit = true\n`
  mkdirSync(dirname(target), { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'config.yaml'), 'display: {}\n')
  writeFileSync(target, original)
  run('git', ['init'], repo)
  run('git', ['add', sentinel.file], repo)
  run('git', ['-c', 'user.name=Classic Gold Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'], repo)
  const head = run('git', ['rev-parse', 'HEAD'], repo)
  writeFileSync(`${target}.orig`, original)
  writeFileSync(target, patched)
  const installedBlob = gitBlobHash(repo, target, { asPath: sentinel.file })
  writeFileSync(target, stagedUser)
  run('git', ['add', sentinel.file], repo)
  writeFileSync(target, patched)
  recordApplied(home, 'statusbar', { agentHead: head, via: 'patch' }, { agentHead: head })
  appendManifest(home, {
    type: 'file', tier: 'statusbar', rel: sentinel.file,
    orig: `${sentinel.file}.orig`, agentHead: head, method: 'patch', installedBlob,
  })

  const migrated = spawnSync(process.execPath, [
    join(ROOT, 'scripts', 'migrate-to-plugin.mjs'), '--yes', '--home', home, '--repo', repo,
  ], { encoding: 'utf8' })

  assert.equal(migrated.status, 1)
  assert.match(migrated.stderr, /do not have safe same-version backups/)
  assert.equal(readFileSync(target, 'utf8'), patched)
  assert.equal(run('git', ['show', `:${sentinel.file}`], repo), stagedUser.trim())
  assert.ok(readStamp(home).applied.statusbar)
})

test('migration transaction restores prior bytes when a source write fails', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'classic-gold-transaction-rollback-'))
  t.after(() => removeFixture(fixture))
  const home = join(fixture, 'home')
  const repo = join(fixture, 'hermes-agent')
  const sentinel = TIER_SENTINELS.statusbar
  const target = join(repo, sentinel.file)
  const original = 'export const stockStatusbar = true\n'
  const patched = `${original}${sentinel.marker}() {}\n`
  mkdirSync(dirname(target), { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'config.yaml'), 'display: {}\n')
  writeFileSync(target, original)
  run('git', ['init'], repo)
  run('git', ['add', sentinel.file], repo)
  run('git', ['-c', 'user.name=Classic Gold Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'], repo)
  const head = run('git', ['rev-parse', 'HEAD'], repo)
  writeFileSync(`${target}.orig`, original)
  writeFileSync(target, patched)
  recordApplied(home, 'statusbar', { agentHead: head, via: 'patch' }, { agentHead: head })

  assert.throws(() => executeMigration(home, repo, [{
    rel: sentinel.file,
    orig: `${sentinel.file}.orig`,
  }], {
    afterRestore: () => { throw new Error('injected migration failure') },
  }), /injected migration failure/)

  assert.equal(readFileSync(target, 'utf8'), patched)
  assert.equal(run('git', ['show', `:${sentinel.file}`], repo), original.trim())
  assert.ok(readStamp(home).applied.statusbar)
  assert.equal(readStamp(home).applied.legacyMigration, undefined)
  assert.equal(existsSync(join(home, '.classic-gold-migration')), false)
  const receipts = readManifest(home).entries.filter(entry => entry.type === 'legacy-migration-file')
  assert.equal(receipts.filter(entry => entry.state === 'planned').length, 1)
  assert.equal(receipts.filter(entry => entry.state === 'completed').length, 0)
  assert.equal(receipts.filter(entry => entry.state === 'rolled-back').length, 1)
})

test('migration transaction removes a partial rollback copy before a source write', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'classic-gold-partial-rollback-'))
  t.after(() => removeFixture(fixture))
  const home = join(fixture, 'home')
  const repo = join(fixture, 'hermes-agent')
  const sentinel = TIER_SENTINELS.statusbar
  const target = join(repo, sentinel.file)
  const original = 'export const stockStatusbar = true\n'
  const patched = `${original}${sentinel.marker}() {}\n`
  mkdirSync(dirname(target), { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'config.yaml'), 'display: {}\n')
  writeFileSync(target, original)
  run('git', ['init'], repo)
  run('git', ['add', sentinel.file], repo)
  run('git', ['-c', 'user.name=Classic Gold Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'], repo)
  writeFileSync(`${target}.orig`, original)
  writeFileSync(target, patched)

  assert.throws(() => executeMigration(home, repo, [{
    rel: sentinel.file,
    orig: `${sentinel.file}.orig`,
  }], {
    afterBackup: plan => {
      writeFileSync(plan.rollback, 'partial')
      throw new Error('injected backup interruption')
    },
  }), /injected backup interruption/)

  assert.equal(readFileSync(target, 'utf8'), patched)
  assert.equal(readStamp(home)?.applied?.legacyMigration, undefined)
  assert.equal(existsSync(join(home, '.classic-gold-migration')), false)
  const receipts = readManifest(home).entries.filter(entry => entry.type === 'legacy-migration-file')
  assert.equal(receipts.filter(entry => entry.state === 'planned').length, 1)
  assert.equal(receipts.filter(entry => entry.state === 'rolled-back').length, 1)
})

test('migration resumes an interrupted transaction from exact receipts', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'classic-gold-transaction-resume-'))
  t.after(() => removeFixture(fixture))
  const home = join(fixture, 'home')
  const repo = join(fixture, 'hermes-agent')
  const sentinel = TIER_SENTINELS.statusbar
  const target = join(repo, sentinel.file)
  const original = 'export const stockStatusbar = true\n'
  const patched = `${original}${sentinel.marker}() {}\n`
  mkdirSync(dirname(target), { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'config.yaml'), 'display: {}\n')
  writeFileSync(target, original)
  run('git', ['init'], repo)
  run('git', ['add', sentinel.file], repo)
  run('git', ['-c', 'user.name=Classic Gold Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'], repo)
  const head = run('git', ['rev-parse', 'HEAD'], repo)
  writeFileSync(`${target}.orig`, original)
  writeFileSync(target, patched)
  const previousHash = gitBlobHash(repo, target, { asPath: sentinel.file })
  const restoredHash = gitBlobHash(repo, `${target}.orig`, { asPath: sentinel.file })
  const transactionId = '11111111-1111-4111-8111-111111111111'
  const rollback = join(home, '.classic-gold-migration', transactionId, '0000.rollback')
  const plan = {
    rel: sentinel.file,
    path: target,
    orig: `${target}.orig`,
    rollback,
    temporary: `${target}.classic-gold-migration-next-resume`,
    previousHash,
    restoredHash,
  }
  recordApplied(home, 'statusbar', { agentHead: head, via: 'patch' }, { agentHead: head })
  appendManifest(home, {
    type: 'file', tier: 'statusbar', rel: sentinel.file,
    orig: `${sentinel.file}.orig`, agentHead: head, method: 'patch', installedBlob: previousHash,
  })
  recordApplied(home, 'legacyMigration', {
    transactionId, phase: 'ready', repo, files: [plan],
  })
  appendManifest(home, { type: 'legacy-migration-file', transactionId, state: 'planned', ...plan })
  mkdirSync(dirname(rollback), { recursive: true })
  writeFileSync(rollback, patched)
  writeFileSync(target, original)

  const manifestBefore = readFileSync(join(home, 'hermes-classic-gold-pack.manifest.json'))
  const stampBefore = readFileSync(join(home, 'hermes-classic-gold-pack.json'))
  const dryRun = spawnSync(process.execPath, [
    join(ROOT, 'scripts', 'migrate-to-plugin.mjs'), '--dry-run', '--home', home, '--repo', repo,
  ], { encoding: 'utf8' })
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout)
  assert.equal(readFileSync(target, 'utf8'), original)
  assert.deepEqual(readFileSync(join(home, 'hermes-classic-gold-pack.manifest.json')), manifestBefore)
  assert.deepEqual(readFileSync(join(home, 'hermes-classic-gold-pack.json')), stampBefore)

  const nonInteractive = spawnSync(process.execPath, [
    join(ROOT, 'scripts', 'migrate-to-plugin.mjs'), '--home', home, '--repo', repo,
  ], { encoding: 'utf8' })
  assert.equal(nonInteractive.status, 1)
  assert.match(nonInteractive.stderr, /Refusing to recover an interrupted migration non-interactively without --yes/)
  assert.equal(readFileSync(target, 'utf8'), original)
  assert.deepEqual(readFileSync(join(home, 'hermes-classic-gold-pack.manifest.json')), manifestBefore)
  assert.deepEqual(readFileSync(join(home, 'hermes-classic-gold-pack.json')), stampBefore)

  const migrated = spawnSync(process.execPath, [
    join(ROOT, 'scripts', 'migrate-to-plugin.mjs'), '--yes', '--home', home, '--repo', repo,
  ], { encoding: 'utf8' })

  assert.equal(migrated.status, 0, migrated.stderr || migrated.stdout)
  assert.match(migrated.stdout, /Recovered an interrupted/)
  assert.equal(readFileSync(target, 'utf8'), original)
  assert.equal(readStamp(home).applied.legacyMigration, undefined)
  assert.equal(readStamp(home).applied.statusbar, undefined)
  const oldReceipts = readManifest(home).entries.filter(entry => entry.transactionId === transactionId)
  assert.equal(oldReceipts.filter(entry => entry.state === 'rolled-back').length, 1)
})

test('migration recovery preserves a source file that changed after interruption', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'classic-gold-transaction-conflict-'))
  t.after(() => removeFixture(fixture))
  const home = join(fixture, 'home')
  const repo = join(fixture, 'hermes-agent')
  const sentinel = TIER_SENTINELS.statusbar
  const target = join(repo, sentinel.file)
  const original = 'export const stockStatusbar = true\n'
  const patched = `${original}${sentinel.marker}() {}\n`
  const userEdit = `${patched}export const userEdit = true\n`
  mkdirSync(dirname(target), { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'config.yaml'), 'display: {}\n')
  writeFileSync(target, original)
  run('git', ['init'], repo)
  run('git', ['add', sentinel.file], repo)
  run('git', ['-c', 'user.name=Classic Gold Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'], repo)
  writeFileSync(`${target}.orig`, original)
  writeFileSync(target, patched)
  const transactionId = '22222222-2222-4222-8222-222222222222'
  const rollback = join(home, '.classic-gold-migration', transactionId, '0000.rollback')
  const plan = {
    rel: sentinel.file,
    path: target,
    orig: `${target}.orig`,
    rollback,
    temporary: `${target}.classic-gold-migration-next-conflict`,
    previousHash: gitBlobHash(repo, target, { asPath: sentinel.file }),
    restoredHash: gitBlobHash(repo, `${target}.orig`, { asPath: sentinel.file }),
  }
  recordApplied(home, 'legacyMigration', {
    transactionId, phase: 'ready', repo, files: [plan],
  })
  appendManifest(home, { type: 'legacy-migration-file', transactionId, state: 'planned', ...plan })
  mkdirSync(dirname(rollback), { recursive: true })
  writeFileSync(rollback, patched)
  writeFileSync(target, userEdit)

  const migrated = spawnSync(process.execPath, [
    join(ROOT, 'scripts', 'migrate-to-plugin.mjs'), '--yes', '--home', home, '--repo', repo,
  ], { encoding: 'utf8' })

  assert.equal(migrated.status, 1)
  assert.match(migrated.stderr, /source file changed during migration/)
  assert.equal(readFileSync(target, 'utf8'), userEdit)
  assert.ok(readStamp(home).applied.legacyMigration)
  assert.equal(existsSync(rollback), true)
})

test('migration rejects a linked source ancestor before receipts or writes', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'classic-gold-linked-source-'))
  t.after(() => removeFixture(fixture))
  const home = join(fixture, 'home')
  const repo = join(fixture, 'hermes-agent')
  const sentinel = TIER_SENTINELS.statusbar
  const target = join(repo, sentinel.file)
  const original = 'export const stockStatusbar = true\n'
  const patched = `${original}${sentinel.marker}() {}\n`
  mkdirSync(dirname(target), { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(target, original)
  run('git', ['init'], repo)
  run('git', ['add', sentinel.file], repo)
  run('git', [
    '-c', 'user.name=Classic Gold Test',
    '-c', 'user.email=test@example.invalid',
    'commit', '-m', 'fixture',
  ], repo)

  const linkedDirectory = dirname(target)
  const outside = join(fixture, 'outside-source')
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, basename(target)), patched)
  writeFileSync(join(outside, `${basename(target)}.orig`), original)
  rmSync(linkedDirectory, { recursive: true })
  try {
    symlinkSync(outside, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    t.skip(`This environment cannot create a test link: ${error.code || error.message}`)
    return
  }

  assert.throws(() => executeMigration(home, repo, [{
    rel: sentinel.file,
    orig: `${sentinel.file}.orig`,
  }]), /symbolic link or junction/)

  assert.equal(readFileSync(target, 'utf8'), patched)
  assert.equal(readStamp(home)?.applied?.legacyMigration, undefined)
  assert.equal(readManifest(home).entries.length, 0)
  assert.equal(existsSync(join(home, '.classic-gold-migration')), false)
})

test('migration rejects a linked rollback ancestor before receipts or writes', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'classic-gold-linked-rollback-'))
  t.after(() => removeFixture(fixture))
  const home = join(fixture, 'home')
  const repo = join(fixture, 'hermes-agent')
  const sentinel = TIER_SENTINELS.statusbar
  const target = join(repo, sentinel.file)
  const original = 'export const stockStatusbar = true\n'
  const patched = `${original}${sentinel.marker}() {}\n`
  mkdirSync(dirname(target), { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(target, original)
  run('git', ['init'], repo)
  run('git', ['add', sentinel.file], repo)
  run('git', [
    '-c', 'user.name=Classic Gold Test',
    '-c', 'user.email=test@example.invalid',
    'commit', '-m', 'fixture',
  ], repo)
  writeFileSync(`${target}.orig`, original)
  writeFileSync(target, patched)

  const outside = join(fixture, 'outside-rollbacks')
  const linkedDirectory = join(home, '.classic-gold-migration')
  mkdirSync(outside, { recursive: true })
  try {
    symlinkSync(outside, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    t.skip(`This environment cannot create a test link: ${error.code || error.message}`)
    return
  }

  assert.throws(() => executeMigration(home, repo, [{
    rel: sentinel.file,
    orig: `${sentinel.file}.orig`,
  }]), /symbolic link or junction/)

  assert.equal(readFileSync(target, 'utf8'), patched)
  assert.equal(readStamp(home)?.applied?.legacyMigration, undefined)
  assert.equal(readManifest(home).entries.length, 0)
  assert.equal(readFileSync(`${target}.orig`, 'utf8'), original)
  assert.deepEqual(readdirSync(outside), [])
})
