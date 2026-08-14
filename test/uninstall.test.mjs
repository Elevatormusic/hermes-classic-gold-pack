import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { installDesktopPlugin } from '../lib/desktop-plugin.mjs'
import { installPetConfig } from '../lib/pet-config.mjs'
import { installPluginBackend, PLUGIN_BACKEND_FILES, pluginConfigState } from '../lib/plugin-backend.mjs'
import { gitBlobHash } from '../lib/git-blob.mjs'
import { appendManifest, readStamp, recordApplied, TIER_SENTINELS } from '../lib/pack-stamp.mjs'
import { installPets } from '../lib/pets.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_SOURCE = join(ROOT, 'desktop-plugin', 'classic-gold', 'plugin.js')
const BACKEND_SOURCE = join(ROOT, 'backend', 'classic-gold')
const PETS_SOURCE = join(ROOT, 'pets')
const UNINSTALL = join(ROOT, 'scripts', 'uninstall.mjs')

function temporaryHome() {
  return mkdtempSync(join(tmpdir(), 'classic-gold-uninstall-'))
}

function removeFixture(path) {
  const waitSignal = new Int32Array(new SharedArrayBuffer(4))
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true })
      return
    } catch (error) {
      if (!['EACCES', 'EBUSY', 'EPERM'].includes(error?.code) || attempt === 9) throw error
      Atomics.wait(waitSignal, 0, 0, 20)
    }
  }
}

function runUninstall(home, repo, { build = false, dryRun = false, env = process.env, themeCleaned = true, yes = true } = {}) {
  const args = [UNINSTALL, '--home', home]
  if (yes) args.splice(1, 0, '--yes')
  if (!build) args.push('--no-build')
  if (dryRun) args.push('--dry-run')
  if (themeCleaned) args.push('--theme-cleaned')
  if (repo) args.push('--repo', repo)
  return spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env,
  })
}

function manifestEntries(home) {
  return JSON.parse(
    readFileSync(join(home, 'hermes-classic-gold-pack.manifest.json'), 'utf8'),
  ).entries
}

function addPendingDesktopRemoval(home, receipt, { temporaryText } = {}) {
  const stamp = readStamp(home)
  const temporary = `${receipt.path}.classic-gold-uninstall-next-fixture`
  if (temporaryText !== undefined) writeFileSync(temporary, temporaryText)
  const plan = {
    configs: [],
    files: [{
      backupHash: receipt.backupHash || null,
      installedHash: receipt.installedHash || null,
      path: receipt.path,
      preExisting: Boolean(receipt.preExisting),
      temporary,
    }],
    legacyFiles: [],
    sourceTransactions: {
      desktopPlugin: stamp.applied.desktopPlugin.transactionId,
      petConfig: null,
      pets: null,
      pluginBackend: null,
    },
    state: 'planned',
    transactionId: 'pending-uninstall-fixture',
    type: 'uninstall',
  }
  appendManifest(home, plan)
  return { plan, temporary }
}

function runGit(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout.trim()
}

function legacyFixture(t) {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  const repo = join(home, 'hermes-agent')
  const sentinel = TIER_SENTINELS.statusbar
  const target = join(repo, sentinel.file)
  const original = 'export const stockStatusbar = true\n'
  const patched = `${original}${sentinel.marker}() {}\n`
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, original)
  runGit(repo, ['init'])
  runGit(repo, ['add', sentinel.file])
  runGit(repo, ['-c', 'user.name=Classic Gold Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'])
  const head = runGit(repo, ['rev-parse', 'HEAD'])
  writeFileSync(`${target}.orig`, original)
  writeFileSync(target, patched)
  recordApplied(home, 'statusbar', { agentHead: head, via: 'patch' }, { agentHead: head })
  appendManifest(home, {
    type: 'file', tier: 'statusbar', rel: sentinel.file,
    orig: `${sentinel.file}.orig`, agentHead: head, method: 'patch',
    installedBlob: gitBlobHash(repo, target, { asPath: sentinel.file }),
  })
  return { head, home, original, patched, repo, target }
}

test('uninstall leaves a modified desktop plug-in and keeps its stamp', t => {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  const installed = installDesktopPlugin({ home, source: PLUGIN_SOURCE })
  writeFileSync(installed.path, 'user replacement\n')

  const result = runUninstall(home)

  assert.equal(result.status, 1)
  assert.equal(readFileSync(installed.path, 'utf8'), 'user replacement\n')
  assert.ok(readStamp(home).applied.desktopPlugin)
  assert.match(result.stdout + result.stderr, /installed target hash does not match/)
})

test('uninstall leaves a modified backend file and keeps config enabled', t => {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  const installed = installPluginBackend({ home, sourceRoot: BACKEND_SOURCE })
  const changed = installed.files[0]
  mkdirSync(dirname(changed), { recursive: true })
  writeFileSync(changed, 'user replacement\n')

  const result = runUninstall(home)

  assert.equal(result.status, 1)
  assert.equal(readFileSync(changed, 'utf8'), 'user replacement\n')
  assert.deepEqual(pluginConfigState(readFileSync(join(home, 'config.yaml'), 'utf8')), {
    disabled: false,
    enabled: true,
  })
  assert.ok(readStamp(home).applied.pluginBackend)
})

test('uninstall removes unchanged managed files and clears their stamps', t => {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  const desktop = installDesktopPlugin({ home, source: PLUGIN_SOURCE })
  const backend = installPluginBackend({ home, sourceRoot: BACKEND_SOURCE })

  const result = runUninstall(home)

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(readFileSync(join(home, 'config.yaml'), 'utf8'), 'plugins:\n  enabled: []\n  disabled: []\n')
  assert.equal(readStamp(home).applied.desktopPlugin, undefined)
  assert.equal(readStamp(home).applied.pluginBackend, undefined)
  assert.equal(existsSync(desktop.path), false)
  assert.ok(backend.files.every(path => !existsSync(path)))
  assert.match(result.stdout, /Confirmed that the renderer theme cleanup is complete/)
})

test('uninstall restores only managed pet files and keeps unrelated files', t => {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  const petRoot = join(home, 'pets', 'noir-neko')
  mkdirSync(petRoot, { recursive: true })
  writeFileSync(join(petRoot, 'pet.json'), 'user pet')
  writeFileSync(join(petRoot, 'notes.txt'), 'keep me')
  installPets(PETS_SOURCE, join(home, 'pets'), { home, version: '1.2.0' })

  const result = runUninstall(home)

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(readFileSync(join(petRoot, 'pet.json'), 'utf8'), 'user pet')
  assert.equal(readFileSync(join(petRoot, 'notes.txt'), 'utf8'), 'keep me')
  assert.equal(existsSync(join(petRoot, 'spritesheet.webp')), false)
  assert.equal(readStamp(home).applied.pets, undefined)
})

test('uninstall protects a modified pet file and keeps its stamp', t => {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  installPets(PETS_SOURCE, join(home, 'pets'), { home, version: '1.2.0' })
  const changed = join(home, 'pets', 'noir-neko', 'pet.json')
  writeFileSync(changed, 'user edit')

  const result = runUninstall(home)

  assert.equal(result.status, 1)
  assert.equal(readFileSync(changed, 'utf8'), 'user edit')
  assert.ok(readStamp(home).applied.pets)
})

test('uninstall restores a legacy file only with exact Git blob proof', t => {
  const fixture = legacyFixture(t)

  const result = runUninstall(fixture.home, fixture.repo)

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(readFileSync(fixture.target, 'utf8'), fixture.original)
  assert.equal(readStamp(fixture.home).applied.statusbar, undefined)
})

test('uninstall retries the desktop build after a legacy restore build fails', t => {
  const fixture = legacyFixture(t)
  const desktop = join(fixture.repo, 'apps', 'desktop')
  mkdirSync(desktop, { recursive: true })
  writeFileSync(
    join(desktop, 'package.json'),
    JSON.stringify({ private: true, scripts: { pack: 'node -e "process.exit(1)"' } }),
  )

  const failed = runUninstall(fixture.home, fixture.repo, { build: true })
  assert.equal(failed.status, 1)
  assert.equal(readFileSync(fixture.target, 'utf8'), fixture.original)
  assert.ok(readStamp(fixture.home).applied.statusbar)

  writeFileSync(
    join(desktop, 'package.json'),
    JSON.stringify({ private: true, scripts: { pack: 'node -e "process.exit(0)"' } }),
  )
  const retried = runUninstall(fixture.home, fixture.repo, { build: true })

  assert.equal(retried.status, 0, retried.stderr || retried.stdout)
  assert.equal(readStamp(fixture.home).applied.statusbar, undefined)
  assert.match(retried.stdout, /Rebuilding/)
})

test('uninstall preserves a later edit in a legacy source file', t => {
  const fixture = legacyFixture(t)
  writeFileSync(fixture.target, `${fixture.patched}export const userEdit = true\n`)

  const result = runUninstall(fixture.home, fixture.repo)

  assert.equal(result.status, 1)
  assert.match(readFileSync(fixture.target, 'utf8'), /userEdit/)
  assert.ok(readStamp(fixture.home).applied.statusbar)
})

test('uninstall rejects an incomplete home option before auto-detection', t => {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n')

  const result = spawnSync(process.execPath, [UNINSTALL, '--home'], {
    encoding: 'utf8',
    env: { ...process.env, HERMES_HOME: home },
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /--home requires a value/)
  assert.equal(readStamp(home), null)
})

test('uninstall refuses receipts copied from another Hermes profile', t => {
  const oldHome = temporaryHome()
  const newHome = temporaryHome()
  t.after(() => removeFixture(oldHome))
  t.after(() => removeFixture(newHome))
  writeFileSync(join(oldHome, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  writeFileSync(join(newHome, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  const installed = installDesktopPlugin({ home: oldHome, source: PLUGIN_SOURCE })
  writeFileSync(
    join(newHome, 'hermes-classic-gold-pack.json'),
    readFileSync(join(oldHome, 'hermes-classic-gold-pack.json')),
  )
  writeFileSync(
    join(newHome, 'hermes-classic-gold-pack.manifest.json'),
    readFileSync(join(oldHome, 'hermes-classic-gold-pack.manifest.json')),
  )

  const result = runUninstall(newHome)

  assert.equal(result.status, 1)
  assert.match(result.stderr, /do not belong to the selected HERMES_HOME/)
  assert.equal(existsSync(installed.path), true)
})

test('uninstall preflights every backend file before changing one', t => {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  const installed = installPluginBackend({ home, sourceRoot: BACKEND_SOURCE })
  const first = installed.files[0]
  writeFileSync(installed.files.at(-1), 'user edit')

  const result = runUninstall(home)

  assert.equal(result.status, 1)
  assert.equal(existsSync(first), true)
  assert.equal(readFileSync(installed.files.at(-1), 'utf8'), 'user edit')
  assert.ok(readStamp(home).applied.pluginBackend)
})

test('uninstall resumes after one new backend file was already removed', t => {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  const installed = installPluginBackend({ home, sourceRoot: BACKEND_SOURCE })
  unlinkSync(installed.files[0])

  const result = runUninstall(home)

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.ok(installed.files.every(path => !existsSync(path)))
  assert.equal(readStamp(home).applied.pluginBackend, undefined)
  const removal = JSON.parse(readFileSync(join(home, 'hermes-classic-gold-pack.manifest.json'), 'utf8'))
    .entries.filter(entry => entry.type === 'uninstall')
  assert.deepEqual(removal.map(entry => entry.state), ['planned', 'installed'])
})

test('uninstall uses the active stamped backend inventory after the bundle changes', t => {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  const oldBundleFiles = PLUGIN_BACKEND_FILES.slice(0, -1)
  const installed = installPluginBackend({
    home,
    sourceRoot: BACKEND_SOURCE,
    files: oldBundleFiles,
  })

  const result = runUninstall(home)

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.ok(installed.files.every(path => !existsSync(path)))
  assert.equal(readStamp(home).applied.pluginBackend, undefined)
})

test('uninstall rejects an outside path in the active backend inventory', t => {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  const installed = installPluginBackend({ home, sourceRoot: BACKEND_SOURCE })
  const stampPath = join(home, 'hermes-classic-gold-pack.json')
  const stamp = JSON.parse(readFileSync(stampPath, 'utf8'))
  stamp.applied.pluginBackend.files[0] = join(dirname(home), 'outside-backend-file.py')
  writeFileSync(stampPath, JSON.stringify(stamp, null, 2))

  const result = runUninstall(home)

  assert.equal(result.status, 1)
  assert.match(result.stderr, /active stamp has invalid managed paths/)
  assert.ok(installed.files.every(path => existsSync(path)))
  assert.ok(readStamp(home).applied.pluginBackend)
})

test('uninstall rejects an extra installed backend receipt in the active transaction', t => {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  const installed = installPluginBackend({ home, sourceRoot: BACKEND_SOURCE })
  const manifestPath = join(home, 'hermes-classic-gold-pack.manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const receipt = manifest.entries.find(entry => (
    entry.type === 'plugin-backend-file' && entry.state === 'installed'
  ))
  manifest.entries.push({ ...receipt })
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  const result = runUninstall(home)

  assert.equal(result.status, 1)
  assert.match(result.stderr, /active stamp and file receipt set do not match/)
  assert.ok(installed.files.every(path => existsSync(path)))
  assert.ok(readStamp(home).applied.pluginBackend)
})

test('uninstall can finish after a pre-existing desktop file was already restored', t => {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  const target = join(home, 'desktop-plugins', 'classic-gold', 'plugin.js')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, 'user original\n')
  const installed = installDesktopPlugin({ home, source: PLUGIN_SOURCE })
  writeFileSync(target, readFileSync(installed.backup))

  const result = runUninstall(home)

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(readFileSync(target, 'utf8'), 'user original\n')
  assert.equal(existsSync(installed.backup), false)
  assert.equal(readStamp(home).applied.desktopPlugin, undefined)
})

test('uninstall refuses a desktop stamp that does not match its receipt', t => {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  const installed = installDesktopPlugin({ home, source: PLUGIN_SOURCE })
  const stampFile = join(home, 'hermes-classic-gold-pack.json')
  const stamp = JSON.parse(readFileSync(stampFile, 'utf8'))
  stamp.applied.desktopPlugin.installedHash = '0'.repeat(64)
  writeFileSync(stampFile, JSON.stringify(stamp, null, 2))

  const result = runUninstall(home)

  assert.equal(result.status, 1)
  assert.match(result.stderr, /active stamp does not match its completed receipt/)
  assert.equal(existsSync(installed.path), true)
})

test('uninstall keeps desktop ownership until renderer theme cleanup is confirmed', t => {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  const installed = installDesktopPlugin({ home, source: PLUGIN_SOURCE })

  const first = runUninstall(home, null, { themeCleaned: false })

  assert.equal(first.status, 1)
  assert.equal(existsSync(installed.path), false)
  assert.ok(readStamp(home).applied.desktopPlugin)
  assert.match(first.stderr, /renderer theme cleanup is pending/)

  const second = runUninstall(home)
  assert.equal(second.status, 0, second.stderr || second.stdout)
  assert.equal(readStamp(home).applied.desktopPlugin, undefined)
})

test('uninstall resumes one exact planned restore and removes its temporary file', t => {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  const target = join(home, 'desktop-plugins', 'classic-gold', 'plugin.js')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, 'prior desktop plug-in\n')
  const installed = installDesktopPlugin({ home, source: PLUGIN_SOURCE })
  const receipt = [...manifestEntries(home)].reverse().find(entry => {
    return entry.type === 'desktop-plugin' && entry.state === 'committed'
  })
  const { plan, temporary } = addPendingDesktopRemoval(home, receipt, {
    temporaryText: readFileSync(installed.backup, 'utf8'),
  })

  const result = runUninstall(home)

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(readFileSync(target, 'utf8'), 'prior desktop plug-in\n')
  assert.equal(existsSync(temporary), false)
  const removals = manifestEntries(home).filter(entry => entry.type === 'uninstall')
  assert.deepEqual(removals.map(entry => entry.transactionId), [plan.transactionId, plan.transactionId])
  assert.deepEqual(removals.map(entry => entry.state), ['planned', 'installed'])
})

test('uninstall refuses a changed temporary file from a pending restore', t => {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  const target = join(home, 'desktop-plugins', 'classic-gold', 'plugin.js')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, 'prior desktop plug-in\n')
  const installed = installDesktopPlugin({ home, source: PLUGIN_SOURCE })
  const receipt = [...manifestEntries(home)].reverse().find(entry => {
    return entry.type === 'desktop-plugin' && entry.state === 'committed'
  })
  const installedBytes = readFileSync(installed.path)
  const { temporary } = addPendingDesktopRemoval(home, receipt, {
    temporaryText: 'later temporary edit\n',
  })
  const manifestBefore = readFileSync(join(home, 'hermes-classic-gold-pack.manifest.json'))

  const result = runUninstall(home)

  assert.equal(result.status, 1)
  assert.match(result.stderr, /temporary file changed after it was created/)
  assert.deepEqual(readFileSync(installed.path), installedBytes)
  assert.equal(readFileSync(temporary, 'utf8'), 'later temporary edit\n')
  assert.deepEqual(
    readFileSync(join(home, 'hermes-classic-gold-pack.manifest.json')),
    manifestBefore,
  )
  assert.ok(readStamp(home).applied.desktopPlugin)
})

test('uninstall dry-run reports a pending restore without recovery writes', t => {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  const target = join(home, 'desktop-plugins', 'classic-gold', 'plugin.js')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, 'prior desktop plug-in\n')
  const installed = installDesktopPlugin({ home, source: PLUGIN_SOURCE })
  const receipt = [...manifestEntries(home)].reverse().find(entry => {
    return entry.type === 'desktop-plugin' && entry.state === 'committed'
  })
  const { temporary } = addPendingDesktopRemoval(home, receipt, {
    temporaryText: readFileSync(installed.backup, 'utf8'),
  })
  const manifestBefore = readFileSync(join(home, 'hermes-classic-gold-pack.manifest.json'))
  const stampBefore = readFileSync(join(home, 'hermes-classic-gold-pack.json'))
  const installedBefore = readFileSync(installed.path)

  const result = runUninstall(home, null, { dryRun: true })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /recovery: resume transaction pending-uninstall-fixture/)
  assert.equal(existsSync(temporary), true)
  assert.deepEqual(readFileSync(installed.path), installedBefore)
  assert.deepEqual(readFileSync(join(home, 'hermes-classic-gold-pack.manifest.json')), manifestBefore)
  assert.deepEqual(readFileSync(join(home, 'hermes-classic-gold-pack.json')), stampBefore)

  const nonInteractive = runUninstall(home, null, { yes: false })
  assert.equal(nonInteractive.status, 1)
  assert.match(nonInteractive.stderr, /Refusing to uninstall non-interactively without --yes/)
  assert.equal(existsSync(temporary), true)
  assert.deepEqual(readFileSync(installed.path), installedBefore)
  assert.deepEqual(readFileSync(join(home, 'hermes-classic-gold-pack.manifest.json')), manifestBefore)
  assert.deepEqual(readFileSync(join(home, 'hermes-classic-gold-pack.json')), stampBefore)
})

test('uninstall applies the pet and backend config plans in one exact chain', t => {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  const original = 'display:\n  pet:\n    slug: prior-pet\nplugins:\n  enabled: []\n  disabled: []\n'
  const configPath = join(home, 'config.yaml')
  writeFileSync(configPath, original)
  installPets(PETS_SOURCE, join(home, 'pets'), { home, version: '1.2.0' })
  installPetConfig({ home, configPath, slug: 'noir-neko', version: '1.2.0' })
  installPluginBackend({ home, sourceRoot: BACKEND_SOURCE })

  const result = runUninstall(home)

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(readFileSync(configPath, 'utf8'), original)
  const planned = manifestEntries(home).find(entry => {
    return entry.type === 'uninstall' && entry.state === 'planned'
  })
  assert.deepEqual(planned.configs.map(entry => entry.type), [
    'pet-config',
    'plugin-backend-config',
  ])
  assert.equal(planned.configs[0].restoredHash, planned.configs[1].currentHash)
})

test('uninstall uses the checkout under explicit home when the environment points elsewhere', t => {
  const fixture = legacyFixture(t)
  const unrelated = temporaryHome()
  t.after(() => removeFixture(unrelated))
  mkdirSync(join(unrelated, 'apps', 'desktop'), { recursive: true })

  const result = runUninstall(fixture.home, null, {
    env: { ...process.env, HERMES_AGENT_REPO: unrelated },
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(readFileSync(fixture.target, 'utf8'), fixture.original)
})

test('theme cleanup requires another selected theme when no exact prior receipt exists', t => {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  installDesktopPlugin({ home, source: PLUGIN_SOURCE })

  const result = runUninstall(home, null, { themeCleaned: false })

  assert.equal(result.status, 1)
  assert.match(result.stdout, /Select another theme in Settings > Appearance/)
  assert.doesNotMatch(result.stdout, /localStorage\.setItem\(a,"nous"\)/)
  assert.doesNotMatch(result.stdout, /localStorage\.setItem\(m,"light"\)/)
})

test('theme cleanup restores only an exact recorded legacy choice', t => {
  const home = temporaryHome()
  t.after(() => removeFixture(home))
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: []\n  disabled: []\n')
  const theme = {
    mode: 'dark',
    priorMode: 'dim',
    priorTheme: 'user-solarized',
    value: 'hermes-classic-gold',
  }
  appendManifest(home, { type: 'theme', ...theme })
  recordApplied(home, 'theme', theme)

  const result = runUninstall(home, null, { themeCleaned: false })

  assert.equal(result.status, 1)
  assert.doesNotMatch(result.stdout, /Select another theme in Settings > Appearance/)
  assert.match(result.stdout, /localStorage\.setItem\(a,"user-solarized"\)/)
  assert.match(result.stdout, /localStorage\.setItem\(m,"dim"\)/)
})
