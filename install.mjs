#!/usr/bin/env node
// install.mjs — core installer: pets + theme snippet.
// The gold theme installs via a DevTools console paste (there is no file-import
// API for arbitrary themes); this prints the exact instructions + path.
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { resolveHermesHome, findHermesHomes } from './lib/hermes-home.mjs'
import { preflight, reportPreflight } from './lib/preflight.mjs'
import { installPets } from './lib/pets.mjs'
import { activatePetInConfig } from './lib/config-edit.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const args = { home: undefined, activate: undefined, yes: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--home') args.home = argv[++i]
    else if (a === '--activate') args.activate = argv[++i]
    else if (a === '--yes' || a === '-y') args.yes = true
    else if (a === '--help' || a === '-h') args.help = true
  }
  return args
}

const HELP = `hermes-classic-gold-pack installer

Usage: node install.mjs [--home <path>] [--activate <slug>] [--yes]

  --home <path>       Override HERMES_HOME (the dir that contains config.yaml)
  --activate <slug>   Set this pet active in config.yaml
                      (noir-neko | noir-neko-ascii-fine)
  --yes, -y           Accept the auto-detected HERMES_HOME without prompting
                      (and proceed even if more than one install is found)
  --help, -h          Show this help

Installs the two Noir Neko pets and prints the DevTools snippet that installs
the Classic Hermes gold theme. The status bar & caduceus extras live in
advanced/ (see advanced/README.md).`

function confirm(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (a) => {
      rl.close()
      resolve(!/^n/i.test(a.trim()))
    })
  })
}

async function main(argv) {
  const args = parseArgs(argv)
  if (args.help) {
    console.log(HELP)
    return 0
  }

  // Preflight (light — the core install only copies files + edits config.yaml).
  if (!reportPreflight(preflight({ needsNode: 18 }))) return 1

  const home = resolveHermesHome({ explicit: args.home })
  if (!home) {
    console.error('✗ Could not find HERMES_HOME (no config.yaml in any known location).')
    console.error('  Pass --home <path-to-your-hermes-dir> (the folder that contains config.yaml).')
    return 1
  }
  console.log(`• HERMES_HOME: ${home}`)

  // Confirm the auto-resolved home before the FIRST write — a wrong guess would
  // edit the wrong install's config.yaml. `--home` is explicit (skip), `--yes`
  // accepts. If more than one install exists it's a genuine guess: refuse unless
  // told which. Otherwise, in an interactive shell, ask once.
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

  // 1) Pets
  const bundled = join(HERE, 'pets')
  const petsDir = join(home, 'pets')
  const slugs = installPets(bundled, petsDir)
  console.log(`• Installed pets: ${slugs.join(', ')}  →  ${petsDir}`)

  // 2) Optional activation
  if (args.activate) {
    if (!slugs.includes(args.activate)) {
      console.error(`✗ --activate "${args.activate}" is not one of: ${slugs.join(', ')}`)
      return 1
    }
    const cfgPath = join(home, 'config.yaml')
    try {
      const original = readFileSync(cfgPath, 'utf8')
      copyFileSync(cfgPath, cfgPath + '.bak')
      const updated = activatePetInConfig(original, args.activate)
      writeFileSync(cfgPath, updated)
      const check = readFileSync(cfgPath, 'utf8')
      const ok = new RegExp(`slug: ${args.activate}\\b`).test(check) && /enabled: true/.test(check)
      if (!ok) throw new Error('post-write validation failed')
      console.log(`• Activated pet "${args.activate}" in config.yaml (backup: config.yaml.bak)`)
    } catch (err) {
      if (existsSync(cfgPath + '.bak')) copyFileSync(cfgPath + '.bak', cfgPath)
      console.error(`✗ Could not activate pet automatically (${err.message}).`)
      console.error('  Set it in-app: Settings → Pet, or edit config.yaml display.pet.slug.')
    }
  } else {
    console.log('• (Pets installed but not activated — pass --activate <slug> or pick one in-app.)')
  }

  // 3) Theme
  const snippetPath = join(HERE, 'theme', 'install-theme.js')
  console.log('\n──────── Gold theme ────────')
  console.log('Automatic (recommended):  node theme/apply-theme.mjs')
  console.log('  Applies the theme for you — it restarts Hermes once, so run it last.')
  console.log('  Falls back to a manual paste if it can’t run automatically.')
  console.log('Manual:  open Hermes → Ctrl/Cmd+Shift+I → Console → paste')
  console.log('  the contents of theme/install-theme.js → Enter.')
  console.log('  Snippet path: ' + snippetPath)
  console.log('────────────────────────────')
  if (process.env.HCGP_PRINT_SNIPPET === '1') {
    console.log('\n' + readFileSync(snippetPath, 'utf8'))
  }

  // Report only what actually happened — pets are installed here; the theme is
  // NOT applied by this script (it only printed the instructions above).
  const petLine = args.activate ? `pets installed, "${args.activate}" activated` : 'pets installed (none activated)'
  console.log(`\n✓ ${petLine}.`)
  console.log('  Theme is NOT applied yet →  node theme/apply-theme.mjs   (restarts Hermes once)')
  console.log('  Status bar / caduceus extras: see advanced/README.md')
  return 0
}

main(process.argv.slice(2)).then((code) => process.exit(code))
