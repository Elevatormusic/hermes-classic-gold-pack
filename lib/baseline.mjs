// lib/baseline.mjs — pick the stored baseline whose source shape matches the
// installed hermes-agent checkout. Order: exact commit → electron feature-probe
// + newest semver ≤ installed → none (caller falls back to ai/repair.md).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)) // repo/lib
const BASELINES_JSON = join(HERE, '..', 'advanced', 'baselines.json')

export function loadBaselines(path = BASELINES_JSON) {
  try {
    const arr = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

// Compare plain x.y.z → -1|0|1. Missing/non-numeric parts treated as 0.
export function compareSemver(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}

function defaultReadHead(repo) {
  try {
    return execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}
function defaultReadAppVersion(repo) {
  try {
    return JSON.parse(readFileSync(join(repo, 'apps', 'desktop', 'package.json'), 'utf8')).version || null
  } catch {
    return null
  }
}
function defaultDetectElectronExt(repo) {
  if (existsSync(join(repo, 'apps', 'desktop', 'electron', 'main.ts'))) return 'ts'
  if (existsSync(join(repo, 'apps', 'desktop', 'electron', 'main.cjs'))) return 'cjs'
  return null
}

/**
 * @param {{repo:string, baselines?:Array, io?:object}} opts
 * @returns {{baseline:object|null, matchType:'commit'|'electron'|'version'|'none', head:string|null, appVersion:string|null, electronExt:'ts'|'cjs'|null}}
 */
export function selectBaseline({ repo, baselines, io = {} }) {
  const list = baselines || loadBaselines()
  const head = (io.readHead || defaultReadHead)(repo)
  const appVersion = (io.readAppVersion || defaultReadAppVersion)(repo)
  const electronExt = (io.detectElectronExt || defaultDetectElectronExt)(repo)
  const none = { baseline: null, matchType: 'none', head, appVersion, electronExt }

  if (!list.length) return none

  // 1) exact commit
  if (head) {
    const hit = list.find(b => b.commit === head)
    if (hit) return { baseline: hit, matchType: 'commit', head, appVersion, electronExt }
  }

  // 2) electron feature-probe narrows the field
  let candidates = list
  let usedElectron = false
  if (electronExt) {
    const narrowed = list.filter(b => b.electronExt === electronExt)
    if (narrowed.length === 0) return none // known era, no baseline for it
    usedElectron = narrowed.length !== list.length
    candidates = narrowed
  }

  // ...then newest appVersion ≤ installed (ties → latest in list = newest)
  const eligible = appVersion ? candidates.filter(b => compareSemver(b.appVersion, appVersion) <= 0) : candidates
  if (!eligible.length) return none
  let best = eligible[0]
  for (const b of eligible) if (compareSemver(b.appVersion, best.appVersion) >= 0) best = b
  return { baseline: best, matchType: usedElectron ? 'electron' : 'version', head, appVersion, electronExt }
}
