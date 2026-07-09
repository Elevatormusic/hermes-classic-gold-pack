#!/usr/bin/env node
// uninstall.mjs — reverse a Classic Gold install using the change manifest
// (HERMES_HOME/hermes-classic-gold-pack.manifest.json), so it restores YOUR real
// prior state (theme, mode, pets, config, source files) instead of guessing.
//
//   node scripts/uninstall.mjs [--home <path>] [--repo <path>]
//                              [--dry-run] [--no-build] [--yes]
//
// Safety: a source file is auto-restored ONLY from a same-version .orig backup.
// If it was applied by full-copy/reconcile or against a different Hermes HEAD,
// it's left alone and you're pointed to ai/repair.md (Issue #3 §4).
import { existsSync, copyFileSync, rmSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { resolveHermesHome } from '../lib/hermes-home.mjs'
import { readStamp, readManifest, clearApplied, manifestPath } from '../lib/pack-stamp.mjs'

function parseArgs(argv) {
  const a = { home: undefined, repo: undefined, dryRun: false, build: true, yes: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--home') a.home = argv[++i]
    else if (argv[i] === '--repo') a.repo = argv[++i]
    else if (argv[i] === '--dry-run' || argv[i] === '--plan') a.dryRun = true
    else if (argv[i] === '--no-build') a.build = false
    else if (argv[i] === '--yes' || argv[i] === '-y') a.yes = true
  }
  return a
}

function confirm(q) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(q, (ans) => {
      rl.close()
      resolve(/^y/i.test(ans.trim()))
    })
  })
}

/** Newest-first, one entry per key — the manifest is append-only, so a re-run
 *  can have several rows per file/config; we act on the latest. */
function latestByKey(entries, type, keyFn) {
  const seen = new Set()
  const out = []
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.type !== type) continue
    const k = keyFn(e)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const home = resolveHermesHome({ explicit: args.home })
  if (!home) {
    console.error('✗ Could not find HERMES_HOME. Pass --home <path>.')
    return 1
  }
  const stamp = readStamp(home)
  const manifest = readManifest(home)
  if (!stamp && (!manifest.entries || manifest.entries.length === 0)) {
    console.log('• Nothing recorded for this pack at ' + home + '.')
    console.log('  If you installed an older build, uninstall by hand — see ai/uninstall.md.')
    return 0
  }

  const repo = args.repo || join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes-agent')
  const head = currentHead(repo)

  const files = latestByKey(manifest.entries, 'file', (e) => e.rel)
  const pets = latestByKey(manifest.entries, 'pet', (e) => e.slug)
  const configs = latestByKey(manifest.entries, 'config', (e) => e.path)
  const theme = latestByKey(manifest.entries, 'theme', () => 'theme')[0]

  // Classify each source file: restorable vs must-do-by-hand (Issue #3 §4 guard).
  const restorable = []
  const manual = []
  for (const f of files) {
    const orig = join(repo, f.orig)
    const sameHead = !f.agentHead || !head || f.agentHead === head
    const safeMethod = f.method !== 'copy' && f.method !== 'reconciled'
    if (existsSync(orig) && sameHead && safeMethod) restorable.push(f)
    else manual.push(f)
  }
  const petsToDelete = pets.filter((p) => !p.preExisting)
  const petsToKeep = pets.filter((p) => p.preExisting)

  // --- plan ---
  console.log('▶ Uninstall plan  (HERMES_HOME: ' + home + ')')
  console.log(`  • source files: restore ${restorable.length} from .orig` + (manual.length ? `, ${manual.length} need manual/repair.md` : ''))
  if (restorable.length && args.build) console.log('    then rebuild (npm run pack)')
  console.log(`  • pets: delete ${petsToDelete.length}` + (petsToKeep.length ? `, keep ${petsToKeep.length} pre-existing` : ''))
  console.log(`  • config.yaml: ${configs.length ? 'restore from .bak' : '(unchanged)'}`)
  console.log(`  • theme: print a revert snippet` + (theme ? ` (→ ${theme.priorTheme || 'nous'} / ${theme.priorMode || 'light'})` : ' (none recorded)'))
  for (const m of manual) console.log(`    ! ${m.rel} — applied via ${m.method}${m.agentHead && head && m.agentHead !== head ? ` @${m.agentHead.slice(0, 7)} (you're on ${head.slice(0, 7)})` : ''}`)

  if (args.dryRun) {
    console.log('\n(--dry-run: nothing changed.)')
    return 0
  }
  if (!args.yes) {
    if (!process.stdin.isTTY) {
      console.error('\n✗ Refusing to uninstall non-interactively without --yes.')
      return 1
    }
    if (!(await confirm('\nProceed with uninstall? [y/N] '))) {
      console.log('Aborted.')
      return 0
    }
  }

  // --- execute ---
  // 1) source files
  let restoredAny = false
  for (const f of restorable) {
    try {
      copyFileSync(join(repo, f.orig), join(repo, f.rel))
      restoredAny = true
    } catch (e) {
      console.warn(`! could not restore ${f.rel}: ${e.message}`)
    }
  }
  if (restoredAny) console.log(`✓ Restored ${restorable.length} source file(s) from .orig.`)
  if (manual.length) {
    console.warn(`! ${manual.length} file(s) were NOT auto-restored (full-copy/reconciled or different version).`)
    console.warn('  Restore them by hand or with ai/repair.md, then rebuild.')
  }

  // 2) rebuild if we touched source
  if (restoredAny && args.build) {
    const desktop = join(repo, 'apps', 'desktop')
    console.log('• Rebuilding (npm run pack) — Hermes must be fully quit…')
    const b = spawnSync('npm', ['run', 'pack'], { cwd: desktop, stdio: 'inherit', shell: true })
    if (b.status !== 0) console.warn('! rebuild failed — quit Hermes and run `npm run pack` in ' + desktop)
  }

  // 3) pets
  for (const p of petsToDelete) {
    try {
      if (existsSync(p.dir)) rmSync(p.dir, { recursive: true, force: true })
    } catch (e) {
      console.warn(`! could not delete pet ${p.slug}: ${e.message}`)
    }
  }
  if (petsToDelete.length) console.log(`✓ Deleted ${petsToDelete.length} pack pet(s)` + (petsToKeep.length ? `; kept ${petsToKeep.length} you already had.` : '.'))

  // 4) config.yaml — restore the pristine backup
  for (const c of configs) {
    if (existsSync(c.backup)) {
      try {
        copyFileSync(c.backup, c.path)
        console.log(`✓ Restored ${c.path} from ${c.backup}.`)
      } catch (e) {
        console.warn(`! could not restore config: ${e.message}`)
      }
    }
  }

  // 5) theme — localStorage only, so hand back the exact revert snippet with the
  //    user's REAL prior values (falls back to Hermes' default 'nous' / light).
  const priorTheme = theme?.priorTheme || 'nous'
  const priorMode = theme?.priorMode || 'light'
  console.log('\n── Revert the theme (paste in Hermes → Ctrl/Cmd+Shift+I → Console) ──')
  console.log(
    `localStorage.setItem('hermes-desktop-theme-v2', ${JSON.stringify(priorTheme)});` +
      ` localStorage.setItem('hermes-desktop-mode-v1', ${JSON.stringify(priorMode)}); location.reload();`
  )
  console.log('────────────────────────────────────────────────────────────────────')

  // 6) forget what we uninstalled (leave the manifest as history; clear stamp).
  for (const key of ['statusbar', 'caduceus', 'pets', 'theme']) clearApplied(home, key)
  console.log('\n✓ Uninstall complete. (Stamp cleared; manifest kept at ' + manifestPath(home) + ' as history.)')
  return 0
}

main().then((code) => process.exit(code))
