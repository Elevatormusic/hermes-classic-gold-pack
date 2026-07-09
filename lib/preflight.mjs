// Shared preflight checks so blockers surface all at once, up front, instead of
// mid-`npm run pack`. Pure-ish (spawns `git`/reads fs) and injectable for tests.
import { existsSync, statfsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

/**
 * @param {object} opts
 * @param {string}  [opts.repo]        hermes-agent checkout (for build checks)
 * @param {boolean} [opts.needsBuild]  will run `npm run pack` → needs deps + disk
 * @param {number}  [opts.needsNode]   minimum Node major (0 = skip)
 * @param {boolean} [opts.checkGit]    require `git` on PATH
 * @returns {{ ok: boolean, problems: string[], warnings: string[] }}
 */
export function preflight({ repo, needsBuild = false, needsNode = 0, checkGit = false } = {}) {
  const problems = []
  const warnings = []

  if (needsNode) {
    const major = Number(process.versions.node.split('.')[0])
    if (Number.isFinite(major) && major < needsNode) {
      problems.push(`Node ${needsNode}+ required (have ${process.versions.node}).`)
    }
  }

  if (checkGit) {
    const g = spawnSync('git', ['--version'], { stdio: 'ignore' })
    if (g.status !== 0) problems.push('`git` not found on PATH — install Git.')
  }

  if (needsBuild && repo) {
    if (!existsSync(join(repo, 'apps', 'desktop', 'node_modules'))) {
      problems.push(`apps/desktop/node_modules is missing in ${repo} — run \`npm install\` there first.`)
    }
    // Free-disk is best-effort (statfsSync is Node 18.15+); the packaged app is large.
    try {
      const s = statfsSync(join(repo, 'apps', 'desktop'))
      const freeGB = (Number(s.bavail) * Number(s.bsize)) / 1e9
      if (Number.isFinite(freeGB) && freeGB < 2) {
        warnings.push(`Low free disk (~${freeGB.toFixed(1)} GB) on the build drive — the pack is large.`)
      }
    } catch {
      // statfs unavailable — skip silently
    }
  }

  return { ok: problems.length === 0, problems, warnings }
}

/** Print warnings; on failure print problems and return false. */
export function reportPreflight(result, label = 'Preflight') {
  for (const w of result.warnings) console.warn(`! ${w}`)
  if (!result.ok) {
    console.error(`✗ ${label} failed:`)
    for (const p of result.problems) console.error(`    - ${p}`)
  }
  return result.ok
}
