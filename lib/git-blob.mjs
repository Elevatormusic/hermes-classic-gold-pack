import { execFileSync } from 'node:child_process'

function gitArgs(repo, args) {
  const safeRepo = repo.replaceAll('\\', '/')
  return ['-c', `safe.directory=${safeRepo}`, '-C', repo, ...args]
}

/**
 * Hash a file as a Git blob for its intended repository path.
 * Git applies the same path filters that it uses when it adds that file.
 *
 * @param {string} repo Git worktree root.
 * @param {string} file File path to hash. It can be inside or outside the worktree.
 * @param {object} [options]
 * @param {string} [options.asPath] Repository path used for Git filters.
 * @param {typeof execFileSync} [options.exec] Injectable read command for tests.
 * @returns {string|null} Blob object ID, or null when Git cannot hash the file.
 */
export function gitBlobHash(repo, file, { asPath = file, exec = execFileSync } = {}) {
  try {
    const filterPath = String(asPath).replaceAll('\\', '/')
    return exec('git', gitArgs(repo, ['hash-object', `--path=${filterPath}`, '--', file]), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null
  } catch {
    return null
  }
}

/**
 * Read the blob object ID for one path at the current HEAD.
 *
 * @param {string} repo Git worktree root.
 * @param {string} rel Repository-relative path.
 * @param {object} [options]
 * @param {typeof execFileSync} [options.exec] Injectable read command for tests.
 * @returns {string|null} Blob object ID, or null when HEAD does not contain the path.
 */
export function headBlobHash(repo, rel, { exec = execFileSync } = {}) {
  try {
    return exec('git', gitArgs(repo, ['rev-parse', `HEAD:${rel}`]), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null
  } catch {
    return null
  }
}

/** Read the stage-0 blob object ID for one repository path. */
export function indexBlobHash(repo, rel, { exec = execFileSync } = {}) {
  try {
    const output = exec('git', gitArgs(repo, ['ls-files', '--stage', '--', rel]), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const rows = output.split(/\r?\n/).filter(Boolean)
    if (rows.length !== 1) return null
    return rows[0].match(/^\d{6}\s+([0-9a-f]{40,64})\s+0\t/)?.[1] || null
  } catch {
    return null
  }
}
