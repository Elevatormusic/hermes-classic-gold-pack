import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export function managedPathKey(value, { platform = process.platform } = {}) {
  const normalized = resolve(value)
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function sameManagedPath(left, right, options) {
  return typeof left === 'string' && typeof right === 'string' &&
    managedPathKey(left, options) === managedPathKey(right, options)
}

/** Return true when target is the root or a lexical child of it. */
export function isPathInside(root, target) {
  const rel = relative(resolve(root), resolve(target))
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

/**
 * Refuse a managed path when an existing child of root is a symbolic link or
 * junction. The selected root itself can be a link, but all managed children
 * must stay below its canonical location.
 */
export function assertSafeManagedPath(root, target, label = 'managed path') {
  const lexicalRoot = resolve(root)
  const lexicalTarget = resolve(target)
  if (!isPathInside(lexicalRoot, lexicalTarget)) {
    throw new Error(`${label} is outside the selected root: ${lexicalTarget}`)
  }
  if (!existsSync(lexicalRoot)) {
    throw new Error(`Selected root does not exist: ${lexicalRoot}`)
  }

  const canonicalRoot = realpathSync.native(lexicalRoot)
  const rel = relative(lexicalRoot, lexicalTarget)
  let current = lexicalRoot
  for (const part of rel.split(/[\\/]+/).filter(Boolean)) {
    current = join(current, part)
    if (!existsSync(current)) continue
    const stat = lstatSync(current)
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} uses a symbolic link or junction: ${current}`)
    }
    if (stat.isFile() && stat.nlink > 1) {
      throw new Error(`${label} uses a hard-linked file: ${current}`)
    }
    const canonicalCurrent = realpathSync.native(current)
    if (!isPathInside(canonicalRoot, canonicalCurrent)) {
      throw new Error(`${label} resolves outside the selected root: ${current}`)
    }
  }

  return managedPathKey(lexicalTarget)
}
