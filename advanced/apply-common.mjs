// Shared logic for the advanced apply scripts (status bar + caduceus extras).
// Each tier's apply-*.mjs is a thin wrapper around applyTier().
import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveHermesHome } from '../lib/hermes-home.mjs'
import { preflight, reportPreflight } from '../lib/preflight.mjs'
import { recordApplied, appendManifest } from '../lib/pack-stamp.mjs'
import { resolveAgentRepo, hermesExePath } from '../lib/agent-repo.mjs'
import { collectLogs, formatLogs } from '../scripts/diagnostics.mjs'

const BASE = '4d7f8ade3e586d83003d61be76e909f364040fba'
const COMMON_DIR = dirname(fileURLToPath(import.meta.url)) // repo/advanced

// Type-declaration files must NEVER be full-file-overwritten from the fallback:
// the shipped base version can predate a newer renderer bridge API (e.g.
// window.hermes.zoom) on a diverged Hermes, and copying it over would drop that
// API and break `tsc`. Instead we 3-way-merge a tiny additive patch per file so
// the pack's declarations are added WITHOUT clobbering the user's. (Issue #2.)
const ADDITIVE_ONLY = {
  'apps/desktop/src/global.d.ts': 'additive/global.d.ts.patch',
  'apps/desktop/src/types/hermes.ts': 'additive/types-hermes.ts.patch'
}

function packVersion() {
  try {
    return JSON.parse(readFileSync(join(COMMON_DIR, '..', 'package.json'), 'utf8')).version || '?'
  } catch {
    return '?'
  }
}

function parse(argv) {
  const a = { repo: undefined, build: true, force: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') a.repo = argv[++i]
    else if (argv[i] === '--no-build') a.build = false
    else if (argv[i] === '--force-copy') a.force = true
  }
  return a
}

function listFiles(dir, base = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) listFiles(p, base, out)
    else out.push(p.slice(base.length + 1).split('\\').join('/'))
  }
  return out
}

/**
 * Is the Hermes desktop app running? Returns true/false on Windows (where the
 * process is a reliable `Hermes.exe`), or null elsewhere (can't detect safely
 * without false positives from the gateway/agent processes — caller warns).
 */
function hermesRunning() {
  if (process.platform !== 'win32') return null
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Hermes.exe', '/NH'], { encoding: 'utf8' })
    return /Hermes\.exe/i.test(out)
  } catch {
    return null
  }
}

/**
 * Record the install authoritatively — stamp (state) + manifest (undo receipts)
 * — on EVERY apply path (patch, copy, --no-build), not just after a build, so
 * update-hermes / the watcher / uninstall aren't blind. (Issue #3 §3.) Records
 * per-file .orig backups + the head + method so uninstall can restore safely.
 */
function recordInstall(tier, head, via, rels, additiveOnly) {
  try {
    const home = resolveHermesHome({})
    if (!home) return
    recordApplied(home, tier, { via, agentHead: head }, { version: packVersion(), base: BASE, agentHead: head })
    for (const rel of rels) {
      appendManifest(home, {
        type: 'file',
        tier,
        rel,
        orig: rel + '.orig',
        agentHead: head,
        method: additiveOnly[rel] ? 'additive' : via,
      })
    }
    console.log('• Recorded pack stamp + manifest.')
  } catch {
    // best-effort — never fail the install over a record write
  }
}

/** Run `npm run pack`, self-healing once: a mid-build relaunch can re-lock
 *  release/win-unpacked, so quit Hermes and retry a single time. (Issue #3 §6.) */
function packWithRetry(desktop) {
  const run = () => spawnSync('npm', ['run', 'pack'], { cwd: desktop, stdio: 'inherit', shell: true }).status === 0
  if (run()) return true
  if (hermesRunning() === true) {
    console.warn('! Hermes is running again — quitting it and retrying the build once…')
    try {
      spawnSync('taskkill', ['/F', '/IM', 'Hermes.exe'], { stdio: 'ignore' })
    } catch {
      // best-effort
    }
  } else {
    console.warn('! pack failed — retrying once…')
  }
  return run()
}

/** After a green pack, sanity-check that it actually landed and the status bar's
 *  IPC exists (else RAM/VRAM reads blank with no error — issue #2). (Issue #3 §6.) */
function verifyBuild(repo, buildStartMs, tier) {
  const exe = hermesExePath(repo)
  try {
    if (!existsSync(exe)) {
      console.warn(`! build output not found: ${exe} — did the pack produce win-unpacked?`)
    } else if (statSync(exe).mtimeMs + 1000 < buildStartMs) {
      console.warn('! Hermes.exe is older than this build — the pack may have silently no-opped.')
    }
  } catch {
    // best-effort
  }
  if (tier === 'statusbar') {
    try {
      const controls = join(repo, 'apps', 'desktop', 'src', 'app', 'shell', 'statusbar-controls.tsx')
      const main = join(repo, 'apps', 'desktop', 'electron', 'main.cjs')
      const usesBridge = existsSync(controls) && readFileSync(controls, 'utf8').includes('getSystemResources')
      const hasHandler = existsSync(main) && readFileSync(main, 'utf8').includes('hermes:system-resources')
      if (usesBridge && !hasHandler) {
        console.warn("! statusbar reads window.hermesDesktop.getSystemResources but electron/main.cjs has no")
        console.warn("  'hermes:system-resources' handler — RAM/VRAM will read blank. See ai/brokenupdatefix.md.")
      }
    } catch {
      // best-effort
    }
  }
}

/**
 * Apply one advanced tier to a hermes-agent checkout and (unless --no-build)
 * rebuild the desktop app.
 * @param {{scriptDir: string, patchName: string, tier: string, label: string}} opts
 * @returns {number} process exit code
 */
export function applyTier({ scriptDir, patchName, tier, label }) {
  const args = parse(process.argv.slice(2))
  const repo = resolveAgentRepo({ explicit: args.repo })
  if (!existsSync(join(repo, 'apps', 'desktop'))) {
    console.error(`✗ Not a hermes-agent checkout: ${repo}\n  Pass --repo <path>.`)
    return 1
  }

  let head = null
  try {
    head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    if (head !== BASE) {
      console.warn(`! HEAD ${head.slice(0, 7)} != base ${BASE.slice(0, 7)} — patch may not apply; will fall back to file copy.`)
    }
  } catch {
    console.warn('! Could not read git HEAD; proceeding.')
  }

  // Preflight up front: `git` is needed for the patch step; a build also needs
  // apps/desktop deps + free disk. Surface all blockers before we touch files.
  if (!reportPreflight(preflight({ repo, needsBuild: args.build, checkGit: true }))) return 1

  // A running Hermes locks release/win-unpacked and breaks the build.
  if (args.build) {
    const running = hermesRunning()
    if (running === true) {
      console.error('✗ Hermes is still running — fully quit it (close the window AND check the system tray), then re-run.')
      console.error('  `npm run pack` cannot rewrite the app while it is open. (Or pass --no-build to stage files only.)')
      return 1
    }
    if (running === null) {
      console.warn('! Could not auto-detect Hermes — make sure it is FULLY quit before the build.')
    }
  }

  const fallbackRoot = join(scriptDir, 'files')
  const rels = listFiles(fallbackRoot)

  // 1) backup
  for (const rel of rels) {
    const target = join(repo, rel)
    if (existsSync(target) && !existsSync(target + '.orig')) copyFileSync(target, target + '.orig')
  }

  // 2) reset the target paths to a clean base first. A prior install leaves
  //    these files modified/staged; `git apply --3way` then reports "does not
  //    match index" and forces the risky full-file fallback even when a clean
  //    3-way would have worked. Resetting lets more installs take the surgical
  //    path. (Issue #2, gotcha 2.) Originals are already backed up as .orig
  //    above. Best-effort — ignore paths git doesn't track.
  // `checkout HEAD --` (not bare `checkout --`) resets BOTH index and worktree to
  // HEAD; a prior install's STAGED files are the dirty-index case gotcha 2 is
  // about, and bare checkout (restore-from-index) wouldn't clear them.
  const tracked = rels.filter(rel => existsSync(join(repo, rel)))
  if (tracked.length) spawnSync('git', ['-C', repo, 'checkout', 'HEAD', '--', ...tracked], { stdio: 'ignore' })

  // 3) patch, else copy (per file, with .d.ts safety)
  const patch = join(scriptDir, patchName)
  const r = spawnSync('git', ['-C', repo, 'apply', '--3way', '--whitespace=nowarn', patch], { stdio: 'inherit' })
  if (r.status !== 0) {
    const diverged = Boolean(head && head !== BASE)
    console.warn(`! git apply failed; falling back per file${diverged ? ' (diverged checkout)' : ''}.`)
    const unresolved = []
    for (const rel of rels) {
      const additive = ADDITIVE_ONLY[rel]
      if (additive) {
        // Declaration file — 3-way-merge ONLY our additions; never overwrite
        // (a full copy could drop a newer bridge API and break tsc — issue #2).
        const ap = spawnSync(
          'git',
          ['-C', repo, 'apply', '--3way', '--whitespace=nowarn', join(scriptDir, additive)],
          { stdio: 'inherit' }
        )
        if (ap.status !== 0) {
          // Fail fast: a rejected --3way can leave <<<<<<< markers that would
          // break tsc minutes into the build. Restore the clean file (from HEAD,
          // since --3way dirtied the index) and flag it so we stop BEFORE
          // building. (Issue #3.)
          spawnSync('git', ['-C', repo, 'checkout', 'HEAD', '--', rel], { stdio: 'ignore' })
          unresolved.push(rel)
        }
        continue
      }
      // Non-declaration file. On a DIVERGED checkout the pack's base copy would
      // overwrite the user's version's real code (and any repair.md
      // reconciliation) — silent data loss. Refuse unless --force-copy. On the
      // base version a copy is safe (the pack file IS that version). (Issue #3.)
      if (diverged && !args.force) {
        unresolved.push(rel)
        continue
      }
      const target = join(repo, rel)
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(join(fallbackRoot, rel), target)
    }
    if (unresolved.length) {
      // Leave a CLEAN tree for repair.md — undo any partial `--3way` application
      // (merged files / conflict markers) so the user reconciles from pristine.
      // From HEAD, since --3way dirtied the index.
      if (tracked.length) spawnSync('git', ['-C', repo, 'checkout', 'HEAD', '--', ...tracked], { stdio: 'ignore' })
      console.error(
        `\n✗ ${unresolved.length} file(s) can't be applied cleanly on your Hermes version ` +
          `(HEAD ${String(head).slice(0, 7)} != base ${BASE.slice(0, 7)}):`
      )
      for (const u of unresolved) console.error(`    ${u}`)
      console.error(
        "  Blind-copying the pack's base files would overwrite your version's code.\n" +
          '  -> Reconcile with ai/repair.md (recommended), or re-run with --force-copy to\n' +
          '     overwrite anyway. No build was run. See ai/brokenupdatefix.md.'
      )
      return 1
    }
  }
  console.log(`✓ ${label} files staged.`)

  // Record BEFORE building — staging happened regardless of --no-build, so the
  // stamp/manifest must reflect it on every path (patch or copy).
  recordInstall(tier, head, r.status === 0 ? 'patch' : 'copy', rels, ADDITIVE_ONLY)

  // 3) build
  if (args.build) {
    console.log('• Building (npm run pack). Hermes must be FULLY quit…')
    const desktop = join(repo, 'apps', 'desktop')
    const buildStart = Date.now()
    if (!packWithRetry(desktop)) {
      console.error('✗ pack failed (is Hermes quit? are apps/desktop deps installed?).')
      const logs = collectLogs(resolveHermesHome({}))
      if (logs.length) {
        console.error('\n── recent Hermes logs (may help) ──')
        console.error(formatLogs(logs))
      }
      console.error('\nSee ai/brokenupdatefix.md.')
      return 1
    }
    verifyBuild(repo, buildStart, tier)
    console.log('✓ Packed. Relaunch Hermes.')
    console.log('')
    console.log('▶ IMPORTANT — keep this through Hermes updates:')
    console.log('  A Hermes update rebuilds the app from source and WIPES this tier.')
    console.log('  • Update with:  node update-hermes.mjs   (NOT the in-app Update button)')
    console.log('    — it updates Hermes AND re-applies this pack in one step.')
    if (process.platform === 'win32') {
      console.log('  • Optional auto-reminder if you forget and use the in-app button:')
      console.log('      powershell -ExecutionPolicy Bypass -File advanced/watcher/register-watcher.ps1')
    }
    console.log('  • If an update ever leaves it broken:  see ai/brokenupdatefix.md')
  } else {
    console.log('• Skipped build (--no-build). Run: cd apps/desktop && npm run pack (Hermes quit).')
  }
  return 0
}
