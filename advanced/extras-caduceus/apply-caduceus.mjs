#!/usr/bin/env node
// apply-caduceus.mjs — apply the optional caduceus extras (caduceus loader,
// backdrop, hero wordmark) to a hermes-agent checkout, then rebuild.
//
//   node apply-caduceus.mjs [--repo <path-to-hermes-agent>] [--no-build]
//
// Independent of the status bar patch — apply either or both. Tries `git apply`
// (3-way) against the shipped patch; on reject, copies the full post-edit files.
// Backs up each target to <file>.orig first. Hermes must be FULLY quit to build.
import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync, copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = '830165473e0920c2baf8c2a6863976edb0c52943'
const PATCH_NAME = 'hermes-caduceus.patch'

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

function main(argv) {
  const args = parse(argv)
  const repo = args.repo || join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes-agent')
  if (!existsSync(join(repo, 'apps', 'desktop'))) {
    console.error(`✗ Not a hermes-agent checkout: ${repo}\n  Pass --repo <path>.`)
    return 1
  }
  try {
    const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    if (head !== BASE) {
      console.warn(`! HEAD ${head.slice(0, 7)} != base ${BASE.slice(0, 7)} — patch may not apply; will fall back to file copy.`)
    }
  } catch {
    console.warn('! Could not read git HEAD; proceeding.')
  }

  const fallbackRoot = join(HERE, 'files')
  const rels = listFiles(fallbackRoot)

  for (const rel of rels) {
    const target = join(repo, rel)
    if (existsSync(target) && !existsSync(target + '.orig')) copyFileSync(target, target + '.orig')
  }

  const patch = join(HERE, PATCH_NAME)
  const r = spawnSync('git', ['-C', repo, 'apply', '--3way', '--whitespace=nowarn', patch], { stdio: 'inherit' })
  if (r.status !== 0) {
    console.warn('! git apply failed; copying full files instead.')
    for (const rel of rels) {
      const target = join(repo, rel)
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(join(fallbackRoot, rel), target)
    }
  }
  console.log('✓ Caduceus extras files staged.')

  if (args.build) {
    console.log('• Building (npm run pack). Hermes must be FULLY quit…')
    const b = spawnSync('npm', ['run', 'pack'], { cwd: join(repo, 'apps', 'desktop'), stdio: 'inherit', shell: true })
    if (b.status !== 0) {
      console.error('✗ pack failed (is Hermes quit? are apps/desktop deps installed?).')
      return 1
    }
    console.log('✓ Packed. Relaunch Hermes.')
  } else {
    console.log('• Skipped build (--no-build). Run: cd apps/desktop && npm run pack (Hermes quit).')
  }
  return 0
}

process.exit(main(process.argv.slice(2)))
