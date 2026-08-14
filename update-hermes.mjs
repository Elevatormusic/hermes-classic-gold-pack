#!/usr/bin/env node
// Run a normal Hermes update after Classic Gold moves to the desktop plug-in.
// Runtime plug-ins live outside the Hermes checkout. Hermes updates do not
// replace them.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, posix, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'

import { resolveAgentRepo } from './lib/agent-repo.mjs'
import { desktopPluginPath } from './lib/desktop-plugin.mjs'
import { findHermesHomes, resolveHermesHome } from './lib/hermes-home.mjs'
import { readStamp, TIER_SENTINELS } from './lib/pack-stamp.mjs'

function parseArgs(argv) {
  const args = { branch: undefined, help: false, home: undefined, repo: undefined, unsupported: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      args.help = true
      continue
    }
    if (argument === '--branch' || argument === '--home' || argument === '--repo') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        args.unsupported.push(`${argument} requires a value`)
        continue
      }
      if (argument === '--branch') args.branch = value
      else if (argument === '--home') args.home = value
      else args.repo = value
      index += 1
      continue
    }
    args.unsupported.push(argument)
  }
  return args
}

const HELP = `Classic Gold guarded Hermes update

Usage: node update-hermes.mjs [--home <path>] [--repo <path>] [--branch <name>]

This command refuses an update while a legacy Classic Gold source patch is
recorded or present. It does not patch, rebuild, or relaunch Hermes itself.`

function legacyTiers(repo) {
  const found = []
  for (const [tier, sentinel] of Object.entries(TIER_SENTINELS)) {
    try {
      if (readFileSync(join(repo, sentinel.file), 'utf8').includes(sentinel.marker)) found.push(tier)
    } catch {
      // A missing file is not proof of a legacy source patch.
    }
  }
  return found
}

function samePath(left, right, platform) {
  if (!left || !right) return false
  const paths = platform === 'win32' ? win32 : posix
  const normalize = value => {
    const normalized = paths.normalize(paths.resolve(value)).replace(/[\\/]+$/, '')
    return platform === 'win32' ? normalized.toLowerCase() : normalized
  }
  return normalize(left) === normalize(right)
}

function repoIsAssociated({ args, env, home, platform, repo }) {
  const paths = platform === 'win32' ? win32 : posix
  if (samePath(repo, paths.join(home, 'hermes-agent'), platform)) return true
  if (args.home && args.repo) return true
  return Boolean(
    !args.home
      && !args.repo
      && env.HERMES_HOME
      && env.HERMES_AGENT_REPO
      && samePath(home, env.HERMES_HOME, platform)
      && samePath(repo, env.HERMES_AGENT_REPO, platform),
  )
}

/**
 * Run the guarded update command.
 * @param {object} [options]
 * @param {string[]} [options.argv] command arguments
 * @param {NodeJS.ProcessEnv} [options.env] environment values
 * @param {NodeJS.Platform} [options.platform] target platform
 * @param {(path: string) => boolean} [options.exists] file existence check
 * @param {typeof spawnSync} [options.spawn] command runner
 * @param {{log: Function, warn: Function, error: Function}} [options.io] output target
 * @returns {number} process exit code
 */
export function main({
  argv = process.argv.slice(2),
  env = process.env,
  platform = process.platform,
  exists = existsSync,
  spawn = spawnSync,
  io = console,
} = {}) {
  const args = parseArgs(argv)
  if (args.help) {
    io.log(HELP)
    return 0
  }
  if (args.unsupported.length > 0) {
    io.error(`✗ Unsupported option: ${args.unsupported.join(', ')}`)
    io.error('  The old --no-update and --no-relaunch flow was removed. Use --help for the current command.')
    return 1
  }
  if (args.branch && !/^[A-Za-z0-9._/-]+$/.test(args.branch)) {
    io.error('✗ --branch contains unsupported characters.')
    return 1
  }

  if (!args.home) {
    const homes = findHermesHomes({ env, platform, exists })
    if (homes.length > 1) {
      io.error('✗ More than one Hermes install was found. The update command will not guess.')
      for (const candidate of homes) io.error(`  - ${candidate}`)
      io.error('  Re-run with --home <path>. Pass --repo too when the checkout is outside HERMES_HOME.')
      return 1
    }
  }

  const home = resolveHermesHome({ explicit: args.home, env, platform, exists })
  if (!home) {
    io.error('✗ Could not find HERMES_HOME. Pass --home <path>.')
    return 1
  }

  const repo = resolveAgentRepo({ explicit: args.repo, home, env, platform, exists })
  if (!repoIsAssociated({ args, env, home, platform, repo })) {
    const paths = platform === 'win32' ? win32 : posix
    io.error(`✗ The selected repository is not associated with HERMES_HOME: ${repo}`)
    io.error(`  Expected the checkout at: ${paths.join(home, 'hermes-agent')}`)
    io.error('  For an external checkout, pass both --home <path> and --repo <path>.')
    return 1
  }

  if (!exists(join(repo, 'apps', 'desktop'))) {
    io.error(`✗ Not a hermes-agent checkout: ${repo}`)
    return 1
  }

  const legacy = legacyTiers(repo)
  const stamp = readStamp(home)
  const recordedLegacy = ['statusbar', 'caduceus'].filter(tier => stamp?.applied?.[tier])
  const blockedLegacy = [...new Set([...legacy, ...recordedLegacy])]
  if (blockedLegacy.length > 0) {
    io.error(`✗ Legacy Classic Gold source patches are still recorded or present: ${blockedLegacy.join(', ')}.`)
    io.error('  They can conflict with the current Hermes stash-and-restore update flow.')
    io.error(
      `  First run: node scripts/migrate-to-plugin.mjs --home ${JSON.stringify(home)} --repo ${JSON.stringify(repo)}`,
    )
    io.error('  Then run this update command again.')
    return 1
  }

  if (!exists(desktopPluginPath(home))) {
    io.warn('! The update-safe Classic Gold desktop plug-in was not found for this HERMES_HOME.')
    io.warn('  Hermes can update, but Classic Gold may not be active afterward.')
  } else {
    io.log(`• Classic Gold desktop plug-in: ${desktopPluginPath(home)}`)
    io.log('  It is outside the Hermes checkout. The updater will not replace it.')
  }

  const updateArgs = ['update']
  if (args.branch && args.branch !== 'main') updateArgs.push('--branch', args.branch)
  io.log(`• hermes ${updateArgs.join(' ')}`)
  const result = spawn('hermes', updateArgs, { cwd: repo, stdio: 'inherit', shell: true })
  if (result.status !== 0) {
    io.error('✗ `hermes update` failed. Classic Gold did not patch or rebuild Hermes.')
    return result.status || 1
  }

  io.log('✓ Hermes updated. Classic Gold remains installed as a desktop plug-in.')
  return 0
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) process.exit(main())
