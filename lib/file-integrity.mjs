import { createHash, randomUUID } from 'node:crypto'
import { constants, copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { sameManagedPath } from './path-safety.mjs'

/** Return the SHA-256 digest for a string or byte buffer. */
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** Return the SHA-256 digest for a file, or null when it is absent. */
export function fileSha256(path) {
  try {
    return sha256(readFileSync(path))
  } catch {
    return null
  }
}

/** Allocate a sibling path that cannot reuse an unrelated existing backup. */
export function uniqueSiblingPath(target, label, exists = existsSync) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `${target}.${label}-${randomUUID()}`
    if (!exists(candidate)) return candidate
  }
  throw new Error(`Could not allocate a unique ${label} path for ${target}`)
}

/** List missing directories from the nearest existing parent to the leaf. */
export function missingDirectories(directory, stopAt, exists = existsSync) {
  const missing = []
  let current = directory
  while (current && !sameManagedPath(current, stopAt) && !exists(current)) {
    missing.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  // Keep the shared component root. The Pack can remove only its child tree.
  return missing.reverse().filter(path => !sameManagedPath(dirname(path), stopAt))
}

/** Replace one text file with a verified sibling write. */
export function writeTextAtomically(target, text, temporary = uniqueSiblingPath(target, 'classic-gold-next')) {
  const expectedHash = sha256(Buffer.from(text, 'utf8'))
  writeFileSync(temporary, text, { encoding: 'utf8', flag: 'wx' })
  try {
    if (fileSha256(temporary) !== expectedHash) {
      throw new Error(`Temporary file verification failed: ${temporary}`)
    }
    for (let attempt = 0; ; attempt += 1) {
      try {
        renameSync(temporary, target)
        break
      } catch (error) {
        const transient = process.platform === 'win32' && ['EACCES', 'EBUSY', 'EPERM'].includes(error?.code)
        if (!transient || attempt === 9) throw error
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
      }
    }
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
  if (fileSha256(target) !== expectedHash) {
    throw new Error(`Atomic file verification failed: ${target}`)
  }
  return expectedHash
}

/** Copy one file through a verified sibling and replace the target by rename. */
export function copyFileAtomically(source, target, temporary = uniqueSiblingPath(target, 'classic-gold-next')) {
  const expectedHash = fileSha256(source)
  if (!expectedHash) throw new Error(`Atomic copy source is missing: ${source}`)
  copyFileSync(source, temporary, constants.COPYFILE_EXCL)
  try {
    if (fileSha256(temporary) !== expectedHash) {
      throw new Error(`Temporary file verification failed: ${temporary}`)
    }
    for (let attempt = 0; ; attempt += 1) {
      try {
        renameSync(temporary, target)
        break
      } catch (error) {
        const transient = process.platform === 'win32' && ['EACCES', 'EBUSY', 'EPERM'].includes(error?.code)
        if (!transient || attempt === 9) throw error
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
      }
    }
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
  if (fileSha256(target) !== expectedHash) {
    throw new Error(`Atomic copy verification failed: ${target}`)
  }
  return expectedHash
}

/** Replace a target with an already verified temporary file. */
export function commitVerifiedTemporary(target, temporary, expectedHash) {
  if (!expectedHash || fileSha256(temporary) !== expectedHash) {
    throw new Error(`Temporary file verification failed: ${temporary}`)
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(temporary, target)
      break
    } catch (error) {
      const transient = process.platform === 'win32' && ['EACCES', 'EBUSY', 'EPERM'].includes(error?.code)
      if (!transient || attempt === 9) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
    }
  }
  if (fileSha256(target) !== expectedHash) {
    throw new Error(`Atomic file verification failed: ${target}`)
  }
}
