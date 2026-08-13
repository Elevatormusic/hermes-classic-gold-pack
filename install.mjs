#!/usr/bin/env node
// Install the update-safe Classic Gold plug-in and the optional Noir Neko pets.
// Legacy source patches and the old localStorage theme helper are retired.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { resolveHermesHome, findHermesHomes } from './lib/hermes-home.mjs'
import { preflight, reportPreflight } from './lib/preflight.mjs'
import { formatReceipt, readStamp, recordApplied, withHomeTransactionLock } from './lib/pack-stamp.mjs'
import { installPets } from './lib/pets.mjs'
import { installDesktopPlugin } from './lib/desktop-plugin.mjs'
import { installPetConfig, recoverPendingPetConfig } from './lib/pet-config.mjs'
import { installPluginBackend } from './lib/plugin-backend.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACK_VERSION = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8')).version
function parseArgs(argv) {
  const args = {
    home: undefined, repo: undefined, activate: undefined,
    advanced: [], desktopPlugin: true, pluginBackend: undefined, pets: true,
    yes: false, dryRun: false, help: false, unsupported: [],
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (['--home', '--repo', '--activate', '--advanced'].includes(a)) {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) {
        args.unsupported.push(`${a} requires a value`)
        continue
      }
      if (a === '--home') args.home = value
      else if (a === '--repo') args.repo = value
      else if (a === '--activate') args.activate = value
      else args.advanced = String(value).split(',').map((item) => item.trim()).filter(Boolean)
      i += 1
    } else if (a === '--desktop-plugin') args.desktopPlugin = true
    else if (a === '--no-desktop-plugin') args.desktopPlugin = false
    else if (a === '--plugin-backend') args.pluginBackend = true
    else if (a === '--no-plugin-backend') args.pluginBackend = false
    else if (a === '--pets') args.pets = true
    else if (a === '--no-pets') args.pets = false
    else if (a === '--yes' || a === '-y') args.yes = true
    else if (a === '--dry-run' || a === '--plan') args.dryRun = true
    else if (a === '--help' || a === '-h') args.help = true
    else args.unsupported.push(a)
  }
  if (args.pluginBackend === undefined) args.pluginBackend = args.desktopPlugin
  return args
}

const HELP = `hermes-classic-gold-pack installer

Usage: node install.mjs [--home <path>] [--activate <slug>]
                        [--desktop-plugin|--no-desktop-plugin]
                        [--plugin-backend|--no-plugin-backend]
                        [--pets|--no-pets]
                        [--dry-run] [--yes]

  --home <path>       Override HERMES_HOME (the dir that contains config.yaml)
  --activate <slug>   Set this pet active (noir-neko | noir-neko-ascii-fine)
  --desktop-plugin    Install the update-safe theme, background, and status items.
                      This is the default and does not change Hermes source.
  --no-desktop-plugin  Skip the update-safe desktop plug-in.
  --plugin-backend     Install the telemetry API. This follows the desktop
                      plug-in choice unless you set it explicitly.
  --no-plugin-backend  Skip the telemetry API and its config entry.
  --pets               Install both Noir Neko pets. This is the default.
  --no-pets            Do not install pets. This is useful on a remote backend.
  --dry-run, --plan   Print the plan and exit without changing anything
  --yes, -y           Skip the prompt for one auto-detected HERMES_HOME.
                      It never selects between multiple profiles.
  --help, -h          Show this help

Installs the Classic Gold desktop plug-in and the two Noir Neko pets. The
desktop plug-in is the recommended path. It survives normal Hermes updates.`

function confirm(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (a) => {
      rl.close()
      resolve(!/^n/i.test(a.trim()))
    })
  })
}

/** Install + optionally activate the pets, recording stamp + manifest. */
function petsStep(home, args) {
  const bundled = join(HERE, 'pets')
  const petsDir = join(home, 'pets')
  const installed = installPets(bundled, petsDir, { home, version: PACK_VERSION })
  const { slugs } = installed
  const petsStamp = readStamp(home)?.applied?.pets
  if (!petsStamp?.transactionId || !Array.isArray(petsStamp.files)) {
    throw new Error('Pet file ownership stamp is incomplete.')
  }
  console.log(`• Installed pets: ${slugs.join(', ')}  →  ${petsDir}`)

  let previousSlug = null
  let activated = null
  let activationOk = true
  if (args.activate) {
    if (!slugs.includes(args.activate)) {
      console.error(`✗ --activate "${args.activate}" is not one of: ${slugs.join(', ')}`)
      return { ok: false }
    }
    const cfgPath = join(home, 'config.yaml')
    try {
      const original = readFileSync(cfgPath, 'utf8')
      previousSlug = (original.match(/slug:\s*(\S+)/) || [])[1] || null
      installPetConfig({
        configPath: cfgPath,
        home,
        slug: args.activate,
        version: PACK_VERSION,
      })
      recordApplied(home, 'pets', {
        ...petsStamp,
        activated: args.activate,
        previousSlug,
      }, { version: PACK_VERSION })
      activated = args.activate
      console.log(`• Activated pet "${args.activate}" in config.yaml (targeted receipt recorded)`)
    } catch (err) {
      try {
        recoverPendingPetConfig({ configPath: cfgPath, home, version: PACK_VERSION })
      } catch {
        // Keep the planned receipt for a later safe uninstall.
      }
      console.error(`✗ Could not activate pet automatically (${err.message}).`)
      console.error('  Set it in-app: Settings → Pet, or edit config.yaml display.pet.slug.')
      activationOk = false
    }
  } else {
    console.log('• (Pets installed but not activated — pass --activate <slug> or pick one in-app.)')
  }
  return { ok: activationOk, slugs, activated }
}

async function main(argv) {
  const args = parseArgs(argv)
  if (args.help) {
    console.log(HELP)
    return 0
  }
  if (args.unsupported.length > 0) {
    console.error(`✗ Unsupported or incomplete option: ${args.unsupported.join(', ')}`)
    console.error('  Run `node install.mjs --help` for supported options.')
    return 1
  }
  if (!reportPreflight(preflight({ needsNode: 18 }))) return 1

  if (!args.home) {
    const homes = findHermesHomes()
    if (homes.length > 1) {
      console.error('✗ More than one Hermes profile has a config.yaml. The installer will not guess:')
      for (const candidate of homes) console.error(`  - ${candidate}`)
      console.error('  Re-run with --home <path>. --yes cannot select a profile.')
      return 1
    }
  }

  const home = resolveHermesHome({ explicit: args.home })
  if (!home) {
    console.error('✗ Could not find HERMES_HOME (no config.yaml in any known location).')
    console.error('  Pass --home <path-to-your-hermes-dir> (the folder that contains config.yaml).')
    return 1
  }
  if (args.repo) {
    console.error('✗ --repo is not used by the supported installer.')
    console.error('  Pass it to update-hermes.mjs, migrate-to-plugin.mjs, or uninstall.mjs when needed.')
    return 1
  }
  if (args.activate && !args.pets) {
    console.error('✗ --activate requires pet installation. Remove --no-pets or --activate.')
    return 1
  }
  if (args.activate && !['noir-neko', 'noir-neko-ascii-fine'].includes(args.activate)) {
    console.error('✗ --activate must be noir-neko or noir-neko-ascii-fine.')
    return 1
  }
  if (args.advanced.length > 0) {
    console.error('✗ The legacy source-patch installer is retired because it conflicts with Hermes updates.')
    console.error('  For an old patched checkout, use scripts/migrate-to-plugin.mjs, then update Hermes and run this installer.')
    return 1
  }
  if (!args.desktopPlugin && !args.pluginBackend && !args.pets) {
    console.error('No install component is enabled. Select at least one plug-in or pet component.')
    return 1
  }

  return withHomeTransactionLock(home, async () => {

  const activeStamp = readStamp(home)
  const activeLegacyTiers = ['statusbar', 'caduceus'].filter((tier) => activeStamp?.applied?.[tier])
  if (args.desktopPlugin && activeLegacyTiers.length > 0) {
    console.error(`Legacy source tiers are still active: ${activeLegacyTiers.join(', ')}.`)
    console.error('The run-time desktop plug-in cannot coexist with those source changes.')
    console.error(
      `Run node scripts/migrate-to-plugin.mjs --home ${JSON.stringify(home)} ` +
      `--repo ${JSON.stringify(join(home, 'hermes-agent'))} first.`,
    )
    return 1
  }

  // ---- plan ----
  const steps = []
  if (args.desktopPlugin) steps.push('Desktop plug-in: theme + background + status items   [no source patch or rebuild]')
  if (args.pluginBackend) steps.push('Telemetry backend: RAM + VRAM + session metadata   [full restart required]')
  if (args.pets) steps.push(`Pets: install both${args.activate ? `, activate "${args.activate}"` : ''}   [safe while Hermes runs]`)
  console.log(`• HERMES_HOME: ${home}`)
  console.log(`▶ Plan (${steps.length} step${steps.length > 1 ? 's' : ''}):`)
  steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`))
  if (args.dryRun) {
    console.log('\n(--dry-run: nothing changed.)')
    return 0
  }

  // ---- confirm the auto-resolved home before the first write ----
  if (!args.home) {
    if (process.stdin.isTTY && !args.yes) {
      if (!(await confirm(`Install to this Hermes? ${home}  [Y/n] `))) {
        console.log('Aborted. Pass --home <path> to target a different install.')
        return 1
      }
    }
  }

  if (args.pets) {
    recoverPendingPetConfig({
      configPath: join(home, 'config.yaml'),
      home,
      version: PACK_VERSION,
    })
  }

  // ---- execute: plug-in → pets → legacy advanced tiers → theme ----
  if (args.desktopPlugin) {
    const installed = installDesktopPlugin({
      home,
      source: join(HERE, 'desktop-plugin', 'classic-gold', 'plugin.js'),
      version: PACK_VERSION
    })
    console.log(`• Installed update-safe desktop plug-in: ${installed.path}`)
  }
  if (args.pluginBackend) {
    const backend = installPluginBackend({
      home,
      sourceRoot: join(HERE, 'backend', 'classic-gold'),
      version: PACK_VERSION
    })
    console.log(`• Installed telemetry backend: ${backend.path}`)
    console.log('  Fully restart Hermes Desktop once to load RAM, VRAM, and cost telemetry.')
    console.log('  Hermes loads it automatically. If needed, use Command Palette → Reload desktop plugins.')
  }

  const pets = args.pets ? petsStep(home, args) : { activated: null, ok: true }
  if (!pets.ok) return 1

  // ---- honest summary ----
  const parts = []
  if (args.desktopPlugin) parts.push('update-safe desktop plug-in installed')
  if (args.pluginBackend) parts.push('telemetry backend installed')
  if (args.pets) parts.push(pets.activated ? `pets installed, "${pets.activated}" activated` : 'pets installed (none activated)')
  console.log(`\n✓ ${parts.join('; ')}.`)
  if (args.desktopPlugin) console.log('  Select "Classic Hermes" in Settings → Appearance if it is not active.')

  const receipt = formatReceipt(home)
  if (receipt) console.log('\n' + receipt)
  return 0
  })
}

main(process.argv.slice(2)).then((code) => process.exit(code))
