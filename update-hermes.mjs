#!/usr/bin/env node
// Seamless update: update Hermes-Agent AND re-apply the Classic Gold pack in one
// shot, so the app never comes back stock. Hermes rebuilds itself from a git
// checkout via `git reset --hard`, which discards every source customization, so
// the pack has to be re-applied after each update. Run THIS instead of the
// in-app Update button.
//
//   node update-hermes.mjs [--repo <path>] [--branch <name>]
//                          [--no-update] [--no-relaunch]
//
//   --repo        hermes-agent checkout (default: %LOCALAPPDATA%/hermes/hermes-agent)
//   --branch      branch to update to (default: current checkout branch, else main)
//   --no-update   skip `hermes update` — just re-apply + rebuild (use if you
//                 already updated via the in-app button and came back stock)
//   --no-relaunch don't relaunch Hermes when done
//
// If anything fails, see ai/brokenupdatefix.md.
import { execFileSync, spawnSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveHermesHome } from './lib/hermes-home.mjs'
import { resolveAgentRepo } from './lib/agent-repo.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const isWin = process.platform === 'win32'

function parseArgs(argv) {
  const a = { repo: undefined, branch: undefined, update: true, relaunch: true }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') a.repo = argv[++i]
    else if (argv[i] === '--branch') a.branch = argv[++i]
    else if (argv[i] === '--no-update') a.update = false
    else if (argv[i] === '--no-relaunch') a.relaunch = false
  }
  return a
}

function hermesRunning() {
  if (!isWin) return null
  try {
    return /Hermes\.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq Hermes.exe', '/NH'], { encoding: 'utf8' }))
  } catch {
    return null
  }
}

function quitHermes() {
  if (!isWin) return
  spawnSync('taskkill', ['/F', '/IM', 'Hermes.exe'], { stdio: 'ignore' })
}

/** Which tiers did a previous install apply? Read the pack stamp; default to
 *  statusbar only (caduceus is opt-in) so we never add a tier the user didn't want. */
function appliedTiers() {
  const tiers = ['statusbar']
  try {
    const home = resolveHermesHome({})
    const stampPath = home && join(home, 'hermes-classic-gold-pack.json')
    if (stampPath && existsSync(stampPath)) {
      const stamp = JSON.parse(readFileSync(stampPath, 'utf8'))
      if (stamp?.applied?.caduceus) tiers.push('caduceus')
    }
  } catch {
    // no stamp — statusbar only is the safe default
  }
  return tiers
}

const TIER_SCRIPT = {
  statusbar: join(HERE, 'advanced', 'statusbar', 'apply-statusbar.mjs'),
  caduceus: join(HERE, 'advanced', 'extras-caduceus', 'apply-caduceus.mjs')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const repo = resolveAgentRepo({ explicit: args.repo })
  const desktop = join(repo, 'apps', 'desktop')
  if (!existsSync(desktop)) {
    console.error(`✗ Not a hermes-agent checkout: ${repo}\n  Pass --repo <path>.`)
    return 1
  }

  // Building needs Hermes fully quit (it locks the packaged app).
  if (hermesRunning() === true) {
    console.log('• Quitting Hermes so the rebuild can proceed…')
    quitHermes()
  } else if (!isWin) {
    console.warn('! Make sure Hermes is FULLY quit before continuing (cannot auto-check on this OS).')
  }

  // 1) update Hermes itself (git reset --hard to the new version + backend).
  if (args.update) {
    let branch = args.branch
    if (!branch) {
      try {
        branch = execFileSync('git', ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim()
      } catch {
        branch = 'main'
      }
    }
    const updateArgs = branch && branch !== 'main' ? ['update', '--branch', branch] : ['update']
    console.log(`• hermes ${updateArgs.join(' ')} …`)
    const u = spawnSync('hermes', updateArgs, { cwd: repo, stdio: 'inherit', shell: true })
    if (u.status !== 0) {
      console.error(
        '✗ `hermes update` failed (is the `hermes` CLI on PATH?).\n' +
          '  Update via the in-app button instead, then re-run with --no-update.'
      )
      return 1
    }
  } else {
    console.log('• Skipping Hermes update (--no-update) — re-applying the pack to the current checkout.')
  }

  // 2) re-apply each previously-installed tier (stage only; single build after).
  const tiers = appliedTiers()
  console.log(`• Re-applying tiers: ${tiers.join(', ')}`)
  for (const tier of tiers) {
    const r = spawnSync('node', [TIER_SCRIPT[tier], '--repo', repo, '--no-build'], { stdio: 'inherit' })
    if (r.status !== 0) {
      console.error(`✗ Re-applying ${tier} failed. See ai/brokenupdatefix.md.`)
      return 1
    }
  }

  // 3) one rebuild (Hermes is quit).
  console.log('• Rebuilding (npm run pack)…')
  const b = spawnSync('npm', ['run', 'pack'], { cwd: desktop, stdio: 'inherit', shell: true })
  if (b.status !== 0) {
    console.error('✗ Rebuild failed. See ai/brokenupdatefix.md.')
    return 1
  }

  // 4) relaunch.
  if (args.relaunch && isWin) {
    const exe = join(desktop, 'release', 'win-unpacked', 'Hermes.exe')
    if (existsSync(exe)) {
      console.log('• Relaunching Hermes…')
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref()
    }
  }
  console.log('✓ Updated Hermes and re-applied Classic Gold. Enjoy.')
  return 0
}

process.exit(main())
