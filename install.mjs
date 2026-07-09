#!/usr/bin/env node
// install.mjs — orchestrated installer for the Classic Gold pack: pets, the
// optional advanced tiers (status bar / caduceus), and the theme, in one
// consented flow with a plan + --dry-run. Without --advanced/--theme it installs
// the pets and prints the theme instructions (the classic behaviour).
import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { resolveHermesHome, findHermesHomes } from './lib/hermes-home.mjs'
import { preflight, reportPreflight } from './lib/preflight.mjs'
import { recordApplied, appendManifest, classifyState } from './lib/pack-stamp.mjs'
import { resolveAgentRepo } from './lib/agent-repo.mjs'
import { installPets } from './lib/pets.mjs'
import { activatePetInConfig } from './lib/config-edit.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = '4d7f8ade3e586d83003d61be76e909f364040fba'
const TIER_SCRIPTS = {
  statusbar: join(HERE, 'advanced', 'statusbar', 'apply-statusbar.mjs'),
  caduceus: join(HERE, 'advanced', 'extras-caduceus', 'apply-caduceus.mjs'),
}

function parseArgs(argv) {
  const args = {
    home: undefined, repo: undefined, activate: undefined,
    advanced: [], theme: undefined, yes: false, dryRun: false, help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--home') args.home = argv[++i]
    else if (a === '--repo') args.repo = argv[++i]
    else if (a === '--activate') args.activate = argv[++i]
    else if (a === '--advanced') args.advanced = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--theme') args.theme = true
    else if (a === '--no-theme') args.theme = false
    else if (a === '--yes' || a === '-y') args.yes = true
    else if (a === '--dry-run' || a === '--plan') args.dryRun = true
    else if (a === '--help' || a === '-h') args.help = true
  }
  return args
}

const HELP = `hermes-classic-gold-pack installer

Usage: node install.mjs [--home <path>] [--activate <slug>]
                        [--advanced statusbar,caduceus] [--theme|--no-theme]
                        [--repo <hermes-agent>] [--dry-run] [--yes]

  --home <path>       Override HERMES_HOME (the dir that contains config.yaml)
  --activate <slug>   Set this pet active (noir-neko | noir-neko-ascii-fine)
  --advanced <tiers>  Also apply advanced tiers (comma list: statusbar,caduceus).
                      Stages both, then rebuilds once. Needs Hermes fully quit.
  --theme / --no-theme  Run apply-theme.mjs (restarts Hermes) / skip it.
                      Default: print the theme instructions without running.
  --repo <path>       hermes-agent checkout for --advanced (default under LOCALAPPDATA)
  --dry-run, --plan   Print the plan and exit without changing anything
  --yes, -y           Accept the auto-detected HERMES_HOME (and >1-install case)
  --help, -h          Show this help

Installs the two Noir Neko pets + the gold theme. One orchestrated flow: pets →
advanced (rebuild once) → theme (restarts Hermes last). See advanced/README.md.`

function confirm(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (a) => {
      rl.close()
      resolve(!/^n/i.test(a.trim()))
    })
  })
}

function currentHead(repo) {
  try {
    return execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

/** Install + optionally activate the pets, recording stamp + manifest. */
function petsStep(home, args) {
  const bundled = join(HERE, 'pets')
  const petsDir = join(home, 'pets')
  const bundledSlugs = existsSync(bundled)
    ? readdirSync(bundled, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : []
  const preExisting = new Set(bundledSlugs.filter((s) => existsSync(join(petsDir, s))))
  const slugs = installPets(bundled, petsDir)
  console.log(`• Installed pets: ${slugs.join(', ')}  →  ${petsDir}`)
  for (const slug of slugs) {
    appendManifest(home, { type: 'pet', slug, dir: join(petsDir, slug), preExisting: preExisting.has(slug) })
  }

  let previousSlug = null
  if (args.activate) {
    if (!slugs.includes(args.activate)) {
      console.error(`✗ --activate "${args.activate}" is not one of: ${slugs.join(', ')}`)
      return { ok: false }
    }
    const cfgPath = join(home, 'config.yaml')
    try {
      const original = readFileSync(cfgPath, 'utf8')
      previousSlug = (original.match(/slug:\s*(\S+)/) || [])[1] || null
      // Never overwrite an existing .bak — the FIRST one is the pristine config.
      if (!existsSync(cfgPath + '.bak')) copyFileSync(cfgPath, cfgPath + '.bak')
      const updated = activatePetInConfig(original, args.activate)
      writeFileSync(cfgPath, updated)
      const check = readFileSync(cfgPath, 'utf8')
      if (!(new RegExp(`slug: ${args.activate}\\b`).test(check) && /enabled: true/.test(check))) {
        throw new Error('post-write validation failed')
      }
      appendManifest(home, { type: 'config', path: cfgPath, backup: cfgPath + '.bak', priorSlug: previousSlug })
      console.log(`• Activated pet "${args.activate}" in config.yaml (backup: config.yaml.bak)`)
    } catch (err) {
      if (existsSync(cfgPath + '.bak')) copyFileSync(cfgPath + '.bak', cfgPath)
      console.error(`✗ Could not activate pet automatically (${err.message}).`)
      console.error('  Set it in-app: Settings → Pet, or edit config.yaml display.pet.slug.')
    }
  } else {
    console.log('• (Pets installed but not activated — pass --activate <slug> or pick one in-app.)')
  }
  recordApplied(home, 'pets', { slugs, activated: args.activate || null, previousSlug })
  return { ok: true, slugs, activated: args.activate || null }
}

function printThemeInstructions() {
  const snippetPath = join(HERE, 'theme', 'install-theme.js')
  console.log('\n──────── Gold theme ────────')
  console.log('Automatic (recommended):  node theme/apply-theme.mjs')
  console.log('  Applies the theme for you — it restarts Hermes once, so run it last.')
  console.log('  Falls back to a manual paste if it can’t run automatically.')
  console.log('Manual:  open Hermes → Ctrl/Cmd+Shift+I → Console → paste')
  console.log('  the contents of theme/install-theme.js → Enter.')
  console.log('  Snippet path: ' + snippetPath)
  console.log('────────────────────────────')
  if (process.env.HCGP_PRINT_SNIPPET === '1') console.log('\n' + readFileSync(snippetPath, 'utf8'))
}

async function main(argv) {
  const args = parseArgs(argv)
  if (args.help) {
    console.log(HELP)
    return 0
  }
  if (!reportPreflight(preflight({ needsNode: 18 }))) return 1

  const home = resolveHermesHome({ explicit: args.home })
  if (!home) {
    console.error('✗ Could not find HERMES_HOME (no config.yaml in any known location).')
    console.error('  Pass --home <path-to-your-hermes-dir> (the folder that contains config.yaml).')
    return 1
  }
  const repo = resolveAgentRepo({ explicit: args.repo, home })
  for (const t of args.advanced) {
    if (!TIER_SCRIPTS[t]) {
      console.error(`✗ --advanced: unknown tier "${t}" (use: statusbar, caduceus).`)
      return 1
    }
  }

  // ---- plan ----
  const steps = [`Pets: install both${args.activate ? `, activate "${args.activate}"` : ''}   [safe while Hermes runs]`]
  if (args.advanced.length) steps.push(`Advanced: ${args.advanced.join(', ')} → stage + rebuild (npm run pack)   [Hermes must be quit]`)
  if (args.theme === true) steps.push('Theme: node theme/apply-theme.mjs   [restarts Hermes once]')
  console.log(`• HERMES_HOME: ${home}`)
  if (args.advanced.length) {
    console.log(`• hermes-agent: ${repo}`)
    if (existsSync(join(repo, 'apps', 'desktop'))) {
      const st = classifyState({ repo, home, base: BASE, agentHead: currentHead(repo) })
      console.log(`• current: ${Object.entries(st.tiers).map(([k, v]) => `${k}=${v}`).join(', ')}${st.onBase ? '' : '  (diverged from base)'}`)
    }
  }
  console.log(`▶ Plan (${steps.length} step${steps.length > 1 ? 's' : ''}):`)
  steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`))
  if (args.dryRun) {
    console.log('\n(--dry-run: nothing changed.)')
    return 0
  }

  // ---- confirm the auto-resolved home before the first write ----
  if (!args.home) {
    const all = findHermesHomes()
    if (all.length > 1) {
      console.warn('! More than one Hermes install has a config.yaml:')
      all.forEach((h, i) => console.warn(`    ${i === 0 ? '→' : ' '} ${h}`))
      if (!args.yes) {
        console.error('  Refusing to guess which one. Re-run with --home <path>, or --yes to accept → .')
        return 1
      }
      console.warn(`  --yes: proceeding with ${home}`)
    } else if (process.stdin.isTTY && !args.yes) {
      if (!(await confirm(`Install to this Hermes? ${home}  [Y/n] `))) {
        console.log('Aborted. Pass --home <path> to target a different install.')
        return 1
      }
    }
  }

  // ---- execute: pets → advanced (rebuild once) → theme ----
  const pets = petsStep(home, args)
  if (!pets.ok) return 1

  if (args.advanced.length) {
    for (const t of args.advanced) {
      console.log(`\n• Applying advanced tier: ${t}`)
      const r = spawnSync('node', [TIER_SCRIPTS[t], '--repo', repo, '--no-build'], { stdio: 'inherit' })
      if (r.status !== 0) {
        console.error(`✗ Advanced tier "${t}" failed to stage. See ai/brokenupdatefix.md.`)
        return 1
      }
    }
    console.log('\n• Rebuilding once (npm run pack) — Hermes must be FULLY quit…')
    const b = spawnSync('npm', ['run', 'pack'], { cwd: join(repo, 'apps', 'desktop'), stdio: 'inherit', shell: true })
    if (b.status !== 0) {
      console.error('✗ Rebuild failed (is Hermes quit? are apps/desktop deps installed?).')
      return 1
    }
  }

  if (args.theme === true) {
    console.log('\n• Applying theme (restarts Hermes)…')
    spawnSync('node', [join(HERE, 'theme', 'apply-theme.mjs')], { stdio: 'inherit' })
  } else if (args.theme === undefined) {
    printThemeInstructions()
  }

  // ---- honest summary ----
  const parts = [pets.activated ? `pets installed, "${pets.activated}" activated` : 'pets installed (none activated)']
  if (args.advanced.length) parts.push(`advanced applied: ${args.advanced.join(', ')} (rebuilt)`)
  if (args.theme === true) parts.push('theme applied')
  console.log(`\n✓ ${parts.join('; ')}.`)
  if (args.theme === undefined) console.log('  Theme is NOT applied yet →  node theme/apply-theme.mjs   (restarts Hermes once)')
  if (!args.advanced.length) console.log('  Status bar / caduceus extras: node install.mjs --advanced statusbar,caduceus   (or see advanced/README.md)')
  return 0
}

main(process.argv.slice(2)).then((code) => process.exit(code))
