#!/usr/bin/env node
// install.mjs — core installer: pets + theme snippet.
// The gold theme installs via a DevTools console paste (there is no file-import
// API for arbitrary themes); this prints the exact instructions + path.
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveHermesHome } from './lib/hermes-home.mjs'
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
  --yes, -y           Non-interactive
  --help, -h          Show this help

Installs the two Noir Neko pets and prints the DevTools snippet that installs
the Classic Hermes gold theme. The status bar & caduceus extras live in
advanced/ (see advanced/README.md).`

function main(argv) {
  const args = parseArgs(argv)
  if (args.help) {
    console.log(HELP)
    return 0
  }

  const home = resolveHermesHome({ explicit: args.home })
  if (!home) {
    console.error('✗ Could not find HERMES_HOME (no config.yaml in any known location).')
    console.error('  Pass --home <path-to-your-hermes-dir> (the folder that contains config.yaml).')
    return 1
  }
  console.log(`• HERMES_HOME: ${home}`)

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

  // 3) Theme (DevTools paste)
  const snippetPath = join(HERE, 'theme', 'install-theme.js')
  console.log('\n──────── Gold theme (one manual step) ────────')
  console.log('Open Hermes Desktop → press Ctrl/Cmd+Shift+I → Console tab → paste the')
  console.log('contents of theme/install-theme.js → Enter. (It self-reverts per the header.)')
  console.log('Snippet path: ' + snippetPath)
  console.log('──────────────────────────────────────────────')
  if (process.env.HCGP_PRINT_SNIPPET === '1') {
    console.log('\n' + readFileSync(snippetPath, 'utf8'))
  }

  console.log('\n✓ Core install complete. Restart Hermes to see pets + theme.')
  console.log('  Status bar / caduceus extras: see advanced/README.md')
  return 0
}

process.exit(main(process.argv.slice(2)))
