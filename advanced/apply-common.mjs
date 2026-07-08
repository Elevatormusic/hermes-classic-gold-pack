// Shared logic for the advanced apply scripts (status bar + caduceus extras).
// Each tier's apply-*.mjs is a thin wrapper around applyTier().
import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveHermesHome } from '../lib/hermes-home.mjs'

const BASE = '830165473e0920c2baf8c2a6863976edb0c52943'
const COMMON_DIR = dirname(fileURLToPath(import.meta.url)) // repo/advanced

function packVersion() {
  try {
    return JSON.parse(readFileSync(join(COMMON_DIR, '..', 'package.json'), 'utf8')).version || '?'
  } catch {
    return '?'
  }
}

function parse(argv) {
  const a = { repo: undefined, build: true }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') a.repo = argv[++i]
    else if (argv[i] === '--no-build') a.build = false
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

/** Record which pack pieces are applied, where diagnostics.mjs looks for it. */
function writePackStamp(tier, agentHead) {
  try {
    const home = resolveHermesHome({})
    if (!home) return
    const stampPath = join(home, 'hermes-classic-gold-pack.json')
    let stamp = { pack: 'hermes-classic-gold-pack', version: packVersion(), agentHead: agentHead || null, applied: {} }
    if (existsSync(stampPath)) {
      try {
        stamp = { ...stamp, ...JSON.parse(readFileSync(stampPath, 'utf8')) }
      } catch {
        // corrupt stamp — overwrite fresh
      }
    }
    stamp.version = packVersion()
    if (agentHead) stamp.agentHead = agentHead
    stamp.applied = { ...(stamp.applied || {}), [tier]: new Date().toISOString() }
    writeFileSync(stampPath, JSON.stringify(stamp, null, 2))
    console.log(`• Wrote pack stamp: ${stampPath}`)
  } catch {
    // best-effort — never fail the install over a stamp
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
  const repo = args.repo || join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes-agent')
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

  // Preflight: a running Hermes locks release/win-unpacked and breaks the build.
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

  // 2) patch, else copy
  const patch = join(scriptDir, patchName)
  const r = spawnSync('git', ['-C', repo, 'apply', '--3way', '--whitespace=nowarn', patch], { stdio: 'inherit' })
  if (r.status !== 0) {
    console.warn('! git apply failed; copying full files instead.')
    for (const rel of rels) {
      const target = join(repo, rel)
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(join(fallbackRoot, rel), target)
    }
  }
  console.log(`✓ ${label} files staged.`)

  // 3) build
  if (args.build) {
    console.log('• Building (npm run pack). Hermes must be FULLY quit…')
    const b = spawnSync('npm', ['run', 'pack'], { cwd: join(repo, 'apps', 'desktop'), stdio: 'inherit', shell: true })
    if (b.status !== 0) {
      console.error('✗ pack failed (is Hermes quit? are apps/desktop deps installed?).')
      return 1
    }
    writePackStamp(tier, head)
    console.log('✓ Packed. Relaunch Hermes.')
  } else {
    console.log('• Skipped build (--no-build). Run: cd apps/desktop && npm run pack (Hermes quit).')
  }
  return 0
}
