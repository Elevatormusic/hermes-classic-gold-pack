// Install the Classic Gold telemetry backend without changing Hermes source.
// Each file and the targeted config edit have a reversible manifest receipt.
import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { copyFileAtomically, fileSha256, missingDirectories, sha256, uniqueSiblingPath, writeTextAtomically } from './file-integrity.mjs'
import { appendManifest, readManifest, readStamp, recordApplied, withHomeTransactionLock } from './pack-stamp.mjs'
import { assertSafeManagedPath } from './path-safety.mjs'

export const PLUGIN_BACKEND_ID = 'classic-gold'
export const PLUGIN_BACKEND_FILES = [
  join('dashboard', 'manifest.json'),
  join('dashboard', 'plugin_api.py'),
  join('dashboard', 'dist', 'index.js'),
]

// These are Pack 1.2 payload hashes from before transaction receipts existed.
const LEGACY_BACKEND_HASHES = new Map([
  [join('dashboard', 'manifest.json'), '5a64a549db954071b1a9f3403a03c08a65ceda21c74958b42980b85b7b33efa4'],
  [join('dashboard', 'plugin_api.py'), '6f6028a80031572305b1d278cf50a9a15050e85cecc1b87e6bc68c26e36d4959'],
  [join('dashboard', 'dist', 'index.js'), '92e4acf907be6d5a71810021b37677310aa5b9d9da13f8ca98d9776c4ddcd053'],
])

const SAFE_PLAIN_VALUE = /^[A-Za-z0-9_.\/-]+$/

function unsupportedConfig(detail) {
  throw new Error(`Cannot safely edit Hermes plug-in config: ${detail}.`)
}

function isContent(line) {
  const trimmed = line.trim()
  return trimmed !== '' && !trimmed.startsWith('#')
}

function lineIndent(line) {
  const leading = line.match(/^[ \t]*/)?.[0] || ''
  if (leading.includes('\t')) unsupportedConfig('tab indentation is not supported')
  return leading.length
}

function splitValueComment(raw) {
  let quote = ''
  let escaped = false
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]
    if (quote === '"') {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = ''
      continue
    }
    if (quote === "'") {
      if (character === quote && raw[index + 1] === quote) index += 1
      else if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '#' && (index === 0 || /\s/.test(raw[index - 1]))) {
      return { comment: raw.slice(index).trimEnd(), value: raw.slice(0, index).trim() }
    }
  }
  if (quote) unsupportedConfig('an unterminated quoted value is not supported')
  return { comment: '', value: raw.trim() }
}

function mappingEntry(line) {
  const indent = lineIndent(line)
  const content = line.slice(indent)
  const match = content.match(/^(?:([A-Za-z_][A-Za-z0-9_.-]*)|(["'])([^"']+)\2)\s*:(.*)$/)
  if (!match) return null
  const parsed = splitValueComment(match[4])
  return {
    ...parsed,
    indent,
    key: match[1] || match[3],
    quotedKey: Boolean(match[2]),
  }
}

function parseScalar(raw) {
  const value = raw.trim()
  if (SAFE_PLAIN_VALUE.test(value)) return value
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value)
      if (typeof parsed === 'string') return parsed
    } catch {}
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  unsupportedConfig('a complex list value is not supported')
}

function inlineValues(value) {
  const trimmed = value.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null
  const body = trimmed.slice(1, -1).trim()
  if (!body) return []

  const items = []
  let quote = ''
  let escaped = false
  let start = 0
  for (let index = 0; index <= body.length; index += 1) {
    const character = body[index]
    if (index === body.length || (character === ',' && !quote)) {
      const item = body.slice(start, index).trim()
      if (!item) unsupportedConfig('an empty inline list item is not supported')
      items.push(parseScalar(item))
      start = index + 1
      continue
    }
    if (quote === '"') {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = ''
    } else if (quote === "'") {
      if (character === quote && body[index + 1] === quote) index += 1
      else if (character === quote) quote = ''
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '[' || character === ']' || character === '{' || character === '}') {
      unsupportedConfig('a nested inline value is not supported')
    }
  }
  if (quote) unsupportedConfig('an unterminated inline list value is not supported')
  return items
}

function formatScalar(value) {
  return SAFE_PLAIN_VALUE.test(value) ? value : JSON.stringify(value)
}

function targetEntry(line, indent, key) {
  if (lineIndent(line) !== indent) return null
  const entry = mappingEntry(line)
  return entry?.key === key ? entry : null
}

function validateRootMapping(lines) {
  let foundRootEntry = false
  for (const line of lines) {
    if (!isContent(line)) continue
    const indent = lineIndent(line)
    if (indent > 0) {
      if (!foundRootEntry) unsupportedConfig('the root indentation is ambiguous')
      continue
    }
    const entry = mappingEntry(line)
    if (!entry) unsupportedConfig('the root must use a block mapping')
    foundRootEntry = true
  }
}

function blockList(lines, child, childIndent) {
  const values = []
  const itemIndexes = []
  let itemIndent = null
  for (let index = child.start + 1; index < child.end; index += 1) {
    const line = lines[index]
    if (!isContent(line)) continue
    const indent = lineIndent(line)
    if (indent <= childIndent) unsupportedConfig(`the ${child.key} indentation is ambiguous`)
    if (itemIndent === null) itemIndent = indent
    if (indent !== itemIndent) unsupportedConfig(`the ${child.key} list indentation is ambiguous`)
    const match = line.slice(indent).match(/^-\s+(.+)$/)
    if (!match) unsupportedConfig(`the ${child.key} value must be a list`)
    const parsed = splitValueComment(match[1])
    if (!parsed.value) unsupportedConfig(`the ${child.key} list has an empty item`)
    values.push(parseScalar(parsed.value))
    itemIndexes.push(index)
  }
  return { itemIndent, itemIndexes, values }
}

function analyzePluginConfig(lines) {
  for (const line of lines) lineIndent(line)
  validateRootMapping(lines)

  const pluginEntries = []
  for (let index = 0; index < lines.length; index += 1) {
    if (!isContent(lines[index])) continue
    const entry = targetEntry(lines[index], 0, 'plugins')
    if (entry) pluginEntries.push({ ...entry, start: index })
  }
  if (pluginEntries.length > 1) unsupportedConfig('the root has duplicate plugins keys')
  if (pluginEntries.length === 0) return { parent: null }

  const parentEntry = pluginEntries[0]
  if (parentEntry.quotedKey) unsupportedConfig('a quoted plugins key is not supported')
  if (parentEntry.value !== '') unsupportedConfig('plugins must use a block mapping')

  let end = lines.length
  for (let index = parentEntry.start + 1; index < lines.length; index += 1) {
    if (isContent(lines[index]) && lineIndent(lines[index]) === 0) {
      end = index
      break
    }
  }
  const contentIndexes = []
  for (let index = parentEntry.start + 1; index < end; index += 1) {
    if (isContent(lines[index])) contentIndexes.push(index)
  }
  const childIndent = contentIndexes.length > 0
    ? Math.min(...contentIndexes.map(index => lineIndent(lines[index])))
    : 2
  if (childIndent <= 0) unsupportedConfig('the plugins indentation is ambiguous')

  const directEntries = []
  for (const index of contentIndexes) {
    if (lineIndent(lines[index]) !== childIndent) continue
    const entry = mappingEntry(lines[index])
    if (!entry) unsupportedConfig('plugins must contain a block mapping')
    directEntries.push({ ...entry, start: index })
  }
  if (contentIndexes.length > 0 && directEntries[0]?.start !== contentIndexes[0]) {
    unsupportedConfig('the plugins indentation is ambiguous')
  }
  for (let index = 0; index < directEntries.length; index += 1) {
    const entry = directEntries[index]
    const next = directEntries[index + 1]
    const hasNestedContent = contentIndexes.some(candidate => {
      return candidate > entry.start && candidate < (next?.start || end)
    })
    if (hasNestedContent && entry.value !== '') {
      unsupportedConfig(`the ${entry.key} value has ambiguous nested content`)
    }
  }
  for (const key of ['enabled', 'disabled']) {
    const matches = directEntries.filter(entry => entry.key === key)
    if (matches.length > 1) unsupportedConfig(`plugins has duplicate ${key} keys`)
    if (matches[0]?.quotedKey) unsupportedConfig(`a quoted ${key} key is not supported`)
  }

  const children = new Map()
  for (const key of ['enabled', 'disabled']) {
    const entryIndex = directEntries.findIndex(entry => entry.key === key)
    if (entryIndex < 0) continue
    const entry = directEntries[entryIndex]
    const next = directEntries.find(candidate => candidate.start > entry.start)
    const child = { ...entry, end: next?.start || end, key }
    const inline = inlineValues(entry.value)
    if (inline) child.list = { itemIndent: null, itemIndexes: [], values: inline }
    else if (entry.value === '') child.list = blockList(lines, child, childIndent)
    else unsupportedConfig(`${key} must use a list`)
    children.set(key, child)
  }

  return {
    parent: {
      childIndent,
      children,
      end,
      start: parentEntry.start,
    },
  }
}

function hasMembership(analysis, key, id) {
  return Boolean(analysis.parent?.children.get(key)?.list.values.includes(id))
}

function setMembership(lines, key, id, shouldContain) {
  const analysis = analyzePluginConfig(lines)
  const parent = analysis.parent
  if (!parent) {
    if (!shouldContain) return
    if (lines.length === 1 && lines[0] === '') lines.pop()
    if (lines.length > 0 && lines.at(-1) !== '') lines.push('')
    lines.push('plugins:', `  ${key}:`, `    - ${id}`)
    return
  }

  const child = parent.children.get(key)
  if (!child) {
    if (!shouldContain) return
    const childSpace = ' '.repeat(parent.childIndent)
    const itemSpace = ' '.repeat(parent.childIndent * 2)
    lines.splice(parent.end, 0, `${childSpace}${key}:`, `${itemSpace}- ${id}`)
    return
  }

  const inline = inlineValues(child.value)
  if (inline) {
    const next = inline.filter(value => value !== id)
    if (shouldContain) next.push(id)
    if (next.length === inline.length && next.every((value, index) => value === inline[index])) return
    const space = ' '.repeat(parent.childIndent)
    const comment = child.comment ? ` ${child.comment}` : ''
    lines[child.start] = `${space}${key}: [${next.map(formatScalar).join(', ')}]${comment}`
    return
  }

  const itemIndexes = child.list.itemIndexes.filter((_, index) => child.list.values[index] === id)
  if (shouldContain && itemIndexes.length === 0) {
    const itemIndent = child.list.itemIndent || parent.childIndent * 2
    lines.splice(child.end, 0, `${' '.repeat(itemIndent)}- ${id}`)
  } else if (!shouldContain && itemIndexes.length > 0) {
    for (const index of itemIndexes.reverse()) lines.splice(index, 1)
    const refreshed = analyzePluginConfig(lines).parent?.children.get(key)
    if (refreshed && refreshed.list.values.length === 0) {
      const space = ' '.repeat(parent.childIndent)
      const comment = child.comment ? ` ${child.comment}` : ''
      lines[refreshed.start] = `${space}${key}: []${comment}`
    }
  }
}

/** Read whether a plug-in is in the enabled and disabled lists. */
export function pluginConfigState(text, id = PLUGIN_BACKEND_ID) {
  const lines = text.split(/\r?\n/)
  const analysis = analyzePluginConfig(lines)
  return {
    disabled: hasMembership(analysis, 'disabled', id),
    enabled: hasMembership(analysis, 'enabled', id),
  }
}

/** Set exact enabled and disabled list membership while preserving other text. */
export function setPluginConfigState(text, state, id = PLUGIN_BACKEND_ID) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const hadFinalEol = /\r?\n$/.test(text)
  const lines = text.split(/\r?\n/)
  if (hadFinalEol) lines.pop()
  analyzePluginConfig(lines)
  setMembership(lines, 'enabled', id, Boolean(state.enabled))
  setMembership(lines, 'disabled', id, Boolean(state.disabled))
  return `${lines.join(eol)}${hadFinalEol ? eol : ''}`
}

export function pluginBackendRoot(home) {
  return join(home, 'plugins', PLUGIN_BACKEND_ID)
}

function removeEmptyDirectories(directories) {
  for (const directory of [...directories].reverse()) {
    try {
      rmdirSync(directory)
    } catch {
      // Keep a directory when it is not empty or another process owns it.
    }
  }
}

function pathKey(path) {
  const value = resolve(path)
  return process.platform === 'win32' ? value.toLowerCase() : value
}

function inside(root, path) {
  const rel = relative(resolve(root), resolve(path))
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
}

function assertBackendReceiptPaths(home, receipt) {
  assertSafeManagedPath(home, receipt.path, 'telemetry backend target')
  if (receipt.backup) {
    assertSafeManagedPath(home, receipt.backup, 'telemetry backend backup')
    assertBackendOwnedSibling(receipt.path, receipt.backup, 'pre-classic-gold', 'backup')
  }
  if (receipt.rollbackBackup) {
    assertSafeManagedPath(home, receipt.rollbackBackup, 'telemetry backend rollback backup')
    assertBackendOwnedSibling(receipt.path, receipt.rollbackBackup, 'classic-gold-rollback', 'rollback backup')
  }
  if (receipt.temporary) {
    assertSafeManagedPath(home, receipt.temporary, 'telemetry backend temporary path')
    assertBackendOwnedSibling(receipt.path, receipt.temporary, 'classic-gold-next', 'temporary path')
  }
  for (const directory of receipt.createdDirectories || []) {
    assertSafeManagedPath(home, directory, 'telemetry backend created directory')
    if (pathKey(directory) === pathKey(join(home, 'plugins')) ||
        !inside(directory, receipt.path)) {
      throw new Error(`Telemetry backend receipt has an invalid created directory: ${receipt.path}`)
    }
  }
}

function assertBackendOwnedSibling(target, candidate, label, description) {
  const expectedPrefix = `${basename(target)}.${label}-`
  const candidateName = basename(candidate)
  const hasPrefix = process.platform === 'win32'
    ? candidateName.toLowerCase().startsWith(expectedPrefix.toLowerCase())
    : candidateName.startsWith(expectedPrefix)
  if (pathKey(dirname(candidate)) !== pathKey(dirname(target)) || !hasPrefix) {
    throw new Error(`Telemetry backend ${description} is not an owned target sibling: ${target}`)
  }
}

function validateActiveBackendReceipt(receipt, targetRoot, home) {
  if (receipt) assertBackendReceiptPaths(home, receipt)
  if (!receipt || !inside(targetRoot, receipt.path)) {
    throw new Error('Telemetry backend ownership stamp has a file outside its plug-in directory.')
  }
  if (!existsSync(receipt.path) || !receipt.installedHash ||
      fileSha256(receipt.path) !== receipt.installedHash) {
    throw new Error(`The installed telemetry backend file changed after this pack wrote it: ${receipt.path}`)
  }
  if (receipt.preExisting) {
    const validBackup = receipt.backup &&
      pathKey(dirname(receipt.backup)) === pathKey(dirname(receipt.path)) &&
      basename(receipt.backup).startsWith(`${basename(receipt.path)}.pre-classic-gold`) &&
      receipt.backupHash && fileSha256(receipt.backup) === receipt.backupHash
    if (!validBackup) throw new Error(`The telemetry backend backup changed or is missing: ${receipt.path}`)
  }
  for (const directory of receipt.createdDirectories || []) {
    if (pathKey(directory) === pathKey(join(home, 'plugins')) ||
        !inside(home, directory) ||
        !inside(directory, receipt.path)) {
      throw new Error(`Telemetry backend receipt has an invalid created directory: ${receipt.path}`)
    }
  }
}

function applyBackendRetirement(plan, home) {
  const receipt = plan.receipt
  assertBackendReceiptPaths(home, receipt)
  copyFileSync(receipt.path, receipt.rollbackBackup)
  if (fileSha256(receipt.rollbackBackup) !== receipt.previousHash) {
    throw new Error(`Telemetry backend rollback backup verification failed: ${receipt.path}`)
  }
  if (receipt.preExisting) {
    if (fileSha256(receipt.backup) !== receipt.restoredHash) {
      throw new Error(`Telemetry backend backup changed before restore: ${receipt.path}`)
    }
    if (!receipt.temporary) {
      throw new Error(`Telemetry backend retirement receipt has no recorded temporary path: ${receipt.path}`)
    }
    copyFileAtomically(receipt.backup, receipt.path, receipt.temporary)
    unlinkSync(receipt.backup)
  } else {
    unlinkSync(receipt.path)
  }
  if (fileSha256(receipt.path) !== receipt.restoredHash) {
    throw new Error(`Telemetry backend retirement verification failed: ${receipt.path}`)
  }
}

function rollBackBackendRetirement(plan, home) {
  const receipt = plan.receipt
  assertBackendReceiptPaths(home, receipt)
  const currentHash = fileSha256(receipt.path)
  if (currentHash !== receipt.previousHash && currentHash !== receipt.restoredHash) {
    throw new Error(`Telemetry backend file changed before retirement rollback: ${receipt.path}`)
  }
  if (receipt.temporary && existsSync(receipt.temporary)) {
    const temporaryHash = fileSha256(receipt.temporary)
    if (temporaryHash !== receipt.previousHash && temporaryHash !== receipt.restoredHash) {
      throw new Error(`Telemetry backend retirement temporary file changed: ${receipt.path}`)
    }
    unlinkSync(receipt.temporary)
  }
  if (receipt.preExisting && !existsSync(receipt.backup)) {
    if (fileSha256(receipt.path) !== receipt.restoredHash) {
      throw new Error(`Telemetry backend restore changed during rollback: ${receipt.path}`)
    }
    copyFileSync(receipt.path, receipt.backup)
    if (fileSha256(receipt.backup) !== receipt.restoredHash) {
      throw new Error(`Telemetry backend backup verification failed during rollback: ${receipt.path}`)
    }
  }
  if (existsSync(receipt.rollbackBackup)) {
    if (fileSha256(receipt.rollbackBackup) !== receipt.previousHash) {
      throw new Error(`Telemetry backend rollback backup changed: ${receipt.path}`)
    }
    if (fileSha256(receipt.path) !== receipt.previousHash) {
      if (!receipt.temporary) {
        throw new Error(`Telemetry backend retirement receipt has no recorded temporary path: ${receipt.path}`)
      }
      copyFileAtomically(receipt.rollbackBackup, receipt.path, receipt.temporary)
    }
    if (fileSha256(receipt.path) !== receipt.previousHash) {
      throw new Error(`Telemetry backend rollback verification failed: ${receipt.path}`)
    }
    unlinkSync(receipt.rollbackBackup)
  } else if (fileSha256(receipt.path) !== receipt.previousHash) {
    throw new Error(`Telemetry backend file changed before retirement rollback: ${receipt.path}`)
  }
}

function newestBackendTransaction(entries) {
  const types = new Set([
    'plugin-backend-file',
    'plugin-backend-file-retirement',
    'plugin-backend-config',
    'plugin-backend-transaction',
  ])
  return [...entries].reverse().find(entry => {
    return types.has(entry.type) && typeof entry.transactionId === 'string'
  })?.transactionId || null
}

function latestBackendReceipts(entries, transactionId, type, keyOf) {
  const receipts = new Map()
  for (const entry of entries) {
    if (entry.transactionId !== transactionId || entry.type !== type) continue
    const key = keyOf(entry)
    if (typeof key !== 'string') continue
    const normalized = pathKey(key)
    const previous = receipts.get(normalized)
    receipts.set(normalized, {
      ...previous,
      ...entry,
      temporary: entry.temporary || previous?.temporary || null,
    })
  }
  return [...receipts.values()]
}

function assertCleanupArtifactPath(home, target, artifact, label) {
  assertSafeManagedPath(home, artifact, `telemetry backend ${label} cleanup artifact`)
  if (pathKey(dirname(artifact)) !== pathKey(dirname(target)) ||
      !basename(artifact).startsWith(`${basename(target)}.${label}-`)) {
    throw new Error(`Telemetry backend cleanup artifact is not an owned target sibling: ${target}`)
  }
}

function planBackendCleanupArtifact(home, receipt, field, label, expectedHashes) {
  const artifact = receipt[field]
  if (!artifact) return null
  assertCleanupArtifactPath(home, receipt.path, artifact, label)
  if (!existsSync(artifact)) return null
  const validHashes = expectedHashes.filter(hash => typeof hash === 'string' && hash !== '')
  const artifactHash = fileSha256(artifact)
  if (validHashes.length === 0 || !validHashes.includes(artifactHash)) {
    throw new Error(`Telemetry backend ${label} cleanup artifact changed: ${receipt.path}`)
  }
  return artifact
}

function cleanupCommittedBackendArtifacts(home, entries, transactionId, targetRoot, configPath) {
  if (!transactionId) return
  const files = latestBackendReceipts(
    entries,
    transactionId,
    'plugin-backend-file',
    entry => entry.path,
  )
  const configs = latestBackendReceipts(
    entries,
    transactionId,
    'plugin-backend-config',
    entry => entry.path,
  )
  const retirements = latestBackendReceipts(
    entries,
    transactionId,
    'plugin-backend-file-retirement',
    entry => entry.path,
  )
  const artifacts = []

  for (const receipt of files) {
    assertBackendReceiptPaths(home, receipt)
    if (receipt.state !== 'installed' || !inside(targetRoot, receipt.path) || !receipt.installedHash) {
      throw new Error('Telemetry backend active file cleanup receipt is incomplete.')
    }
    const rollback = planBackendCleanupArtifact(
      home,
      receipt,
      'rollbackBackup',
      'classic-gold-rollback',
      [receipt.previousHash],
    )
    const temporary = planBackendCleanupArtifact(
      home,
      receipt,
      'temporary',
      'classic-gold-next',
      [receipt.installedHash],
    )
    if (rollback) artifacts.push(rollback)
    if (temporary) artifacts.push(temporary)
  }

  for (const receipt of configs) {
    if (receipt.state !== 'installed' || typeof receipt.path !== 'string' ||
        pathKey(receipt.path) !== pathKey(configPath) ||
        !receipt.previousHash || !receipt.installedHash) {
      throw new Error('Telemetry backend active config cleanup receipt is incomplete.')
    }
    const rollback = planBackendCleanupArtifact(
      home,
      receipt,
      'rollbackBackup',
      'classic-gold-rollback',
      [receipt.previousHash],
    )
    const temporary = planBackendCleanupArtifact(
      home,
      receipt,
      'temporary',
      'classic-gold-next',
      [receipt.installedHash],
    )
    if (rollback) artifacts.push(rollback)
    if (temporary) artifacts.push(temporary)
  }

  for (const receipt of retirements) {
    assertBackendReceiptPaths(home, receipt)
    if (receipt.state !== 'installed' || !inside(targetRoot, receipt.path) ||
        !receipt.previousHash || typeof receipt.sourceTransactionId !== 'string') {
      throw new Error('Telemetry backend active retirement cleanup receipt is incomplete.')
    }
    const rollback = planBackendCleanupArtifact(
      home,
      receipt,
      'rollbackBackup',
      'classic-gold-rollback',
      [receipt.previousHash],
    )
    const temporary = planBackendCleanupArtifact(
      home,
      receipt,
      'temporary',
      'classic-gold-next',
      [receipt.previousHash, receipt.restoredHash],
    )
    if (rollback) artifacts.push(rollback)
    if (temporary) artifacts.push(temporary)
  }

  for (const artifact of new Set(artifacts.map(pathKey))) {
    const exactPath = artifacts.find(candidate => pathKey(candidate) === artifact)
    unlinkSync(exactPath)
  }

  for (const receipt of retirements) {
    for (const directory of [...(receipt.createdDirectories || [])].reverse()) {
      assertSafeManagedPath(home, directory, 'telemetry backend retired directory')
      try {
        rmdirSync(directory)
      } catch (error) {
        if (!existsSync(directory)) continue
        let entriesInDirectory
        try {
          entriesInDirectory = readdirSync(directory)
        } catch {
          throw new Error(`Telemetry backend retired directory cleanup could not be verified: ${directory}`)
        }
        if (entriesInDirectory.length === 0) {
          throw new Error(`Telemetry backend retired directory cleanup failed: ${directory}`, { cause: error })
        }
      }
    }
  }
}

function recoverBackendFile(receipt, home) {
  assertBackendReceiptPaths(home, receipt)
  if (!Object.hasOwn(receipt, 'previousHash') || !receipt.installedHash) {
    throw new Error(`Interrupted telemetry backend receipt is incomplete: ${receipt.path}`)
  }
  if (receipt.temporary && existsSync(receipt.temporary)) {
    if (fileSha256(receipt.temporary) !== receipt.installedHash) {
      throw new Error(`Interrupted telemetry backend temporary file changed: ${receipt.path}`)
    }
    unlinkSync(receipt.temporary)
  }
  const currentHash = fileSha256(receipt.path)
  if (currentHash !== receipt.previousHash) {
    if (currentHash !== receipt.installedHash) {
      throw new Error(`Interrupted telemetry backend target has later changes: ${receipt.path}`)
    }
    if (receipt.rollbackBackup && existsSync(receipt.rollbackBackup)) {
      if (fileSha256(receipt.rollbackBackup) !== receipt.previousHash) {
        throw new Error(`Interrupted telemetry backend rollback backup changed: ${receipt.path}`)
      }
      if (!receipt.temporary) {
        throw new Error(`Interrupted telemetry backend receipt has no recorded temporary path: ${receipt.path}`)
      }
      copyFileAtomically(receipt.rollbackBackup, receipt.path, receipt.temporary)
    } else if (receipt.backupCreated && receipt.backup && existsSync(receipt.backup)) {
      if (fileSha256(receipt.backup) !== receipt.previousHash) {
        throw new Error(`Interrupted telemetry backend original backup changed: ${receipt.path}`)
      }
      if (!receipt.temporary) {
        throw new Error(`Interrupted telemetry backend receipt has no recorded temporary path: ${receipt.path}`)
      }
      copyFileAtomically(receipt.backup, receipt.path, receipt.temporary)
    } else if (receipt.previousHash === null) {
      unlinkSync(receipt.path)
    } else {
      throw new Error(`Interrupted telemetry backend file has no exact rollback backup: ${receipt.path}`)
    }
  }
  if (fileSha256(receipt.path) !== receipt.previousHash) {
    throw new Error(`Interrupted telemetry backend rollback verification failed: ${receipt.path}`)
  }
  if (receipt.rollbackBackup && existsSync(receipt.rollbackBackup)) {
    if (fileSha256(receipt.rollbackBackup) !== receipt.previousHash) {
      throw new Error(`Interrupted telemetry backend rollback backup changed: ${receipt.path}`)
    }
    unlinkSync(receipt.rollbackBackup)
  }
  if (receipt.backupCreated && receipt.backup && existsSync(receipt.backup)) {
    if (fileSha256(receipt.backup) !== receipt.previousHash) {
      throw new Error(`Interrupted telemetry backend original backup changed: ${receipt.path}`)
    }
    unlinkSync(receipt.backup)
  }
  for (const directory of receipt.createdDirectories || []) {
    assertSafeManagedPath(home, directory, 'telemetry backend created directory')
  }
  removeEmptyDirectories(receipt.createdDirectories || [])
}

function recoverBackendConfig(receipt, home, configPath) {
  if (typeof receipt.path !== 'string' || pathKey(receipt.path) !== pathKey(configPath) ||
      !receipt.previousHash || !receipt.installedHash) {
    throw new Error('Interrupted telemetry backend config receipt is incomplete.')
  }
  assertSafeManagedPath(home, receipt.path, 'telemetry backend config')
  if (receipt.rollbackBackup) {
    assertSafeManagedPath(home, receipt.rollbackBackup, 'telemetry backend config rollback backup')
  }
  if (receipt.temporary) {
    assertSafeManagedPath(home, receipt.temporary, 'telemetry backend config temporary file')
    if (pathKey(dirname(receipt.temporary)) !== pathKey(dirname(receipt.path))) {
      throw new Error('Interrupted telemetry backend config temporary path is not a target sibling.')
    }
  }
  if (receipt.temporary && existsSync(receipt.temporary)) {
    if (fileSha256(receipt.temporary) !== receipt.installedHash) {
      throw new Error('Interrupted telemetry backend config temporary file changed.')
    }
    unlinkSync(receipt.temporary)
  }
  const currentHash = fileSha256(receipt.path)
  if (currentHash !== receipt.previousHash) {
    if (currentHash !== receipt.installedHash || !receipt.rollbackBackup ||
        !existsSync(receipt.rollbackBackup) ||
        fileSha256(receipt.rollbackBackup) !== receipt.previousHash) {
      throw new Error('Interrupted telemetry backend config has later changes or no exact rollback backup.')
    }
    if (!receipt.temporary) {
      throw new Error('Interrupted telemetry backend config receipt has no recorded temporary path.')
    }
    copyFileAtomically(receipt.rollbackBackup, receipt.path, receipt.temporary)
  }
  if (fileSha256(receipt.path) !== receipt.previousHash) {
    throw new Error('Interrupted telemetry backend config rollback verification failed.')
  }
  if (receipt.rollbackBackup && existsSync(receipt.rollbackBackup)) {
    if (fileSha256(receipt.rollbackBackup) !== receipt.previousHash) {
      throw new Error('Interrupted telemetry backend config rollback backup changed.')
    }
    unlinkSync(receipt.rollbackBackup)
  }
}

function recoverInterruptedBackendTransaction(home, entries, activeTransaction, configPath, nowIso) {
  const transactionId = newestBackendTransaction(entries)
  if (!transactionId || transactionId === activeTransaction) return false
  const marker = [...entries].reverse().find(entry => {
    return entry.type === 'plugin-backend-transaction' && entry.transactionId === transactionId
  })
  if (marker?.state === 'committed' || marker?.state === 'rolled-back') return false

  const configs = latestBackendReceipts(
    entries,
    transactionId,
    'plugin-backend-config',
    entry => entry.path,
  )
  const files = latestBackendReceipts(
    entries,
    transactionId,
    'plugin-backend-file',
    entry => entry.path,
  )
  const retirements = latestBackendReceipts(
    entries,
    transactionId,
    'plugin-backend-file-retirement',
    entry => entry.path,
  )
  if (configs.length === 0 && files.length === 0 && retirements.length === 0) {
    appendManifest(home, {
      type: 'plugin-backend-transaction',
      state: 'rolled-back',
      transactionId,
    }, nowIso)
    return true
  }

  for (const receipt of configs) {
    if (receipt.state === 'rolled-back') continue
    recoverBackendConfig(receipt, home, configPath)
    appendManifest(home, { ...receipt, state: 'rolled-back' }, nowIso)
  }
  for (const receipt of files) {
    if (receipt.state === 'rolled-back') continue
    recoverBackendFile(receipt, home)
    appendManifest(home, { ...receipt, state: 'rolled-back' }, nowIso)
  }
  for (const receipt of retirements) {
    if (receipt.state === 'rolled-back') continue
    assertBackendReceiptPaths(home, receipt)
    mkdirSync(dirname(receipt.path), { recursive: true })
    rollBackBackendRetirement({ receipt }, home)
    appendManifest(home, { ...receipt, state: 'rolled-back' }, nowIso)
  }
  appendManifest(home, {
    type: 'plugin-backend-transaction',
    state: 'rolled-back',
    transactionId,
  }, nowIso)
  return true
}

/** Reverse the newest uncommitted telemetry backend transaction, if present. */
export function recoverInterruptedPluginBackend({ home, nowIso } = {}) {
  return withHomeTransactionLock(home, () => {
    const entries = readManifest(home).entries || []
    const activeTransaction = readStamp(home)?.applied?.pluginBackend?.transactionId || null
    return recoverInterruptedBackendTransaction(
      home,
      entries,
      activeTransaction,
      join(home, 'config.yaml'),
      nowIso,
    )
  })
}

export function legacyBackendReceiptSet({
  componentStamp,
  configPath,
  entries,
  legacyHashes = LEGACY_BACKEND_HASHES,
  original,
  targetRoot,
}) {
  if (componentStamp?.via !== 'dashboard-api' || componentStamp?.id !== PLUGIN_BACKEND_ID ||
      componentStamp?.transactionId !== undefined || componentStamp?.installedHash !== undefined ||
      typeof componentStamp?.configPath !== 'string' ||
      pathKey(componentStamp.configPath) !== pathKey(configPath) || pluginConfigState(original).disabled ||
      !pluginConfigState(original).enabled) return null
  const expectedPaths = PLUGIN_BACKEND_FILES.map(relativePath => join(targetRoot, relativePath))
  const expectedPathKeys = new Set(expectedPaths.map(pathKey))
  if (!Array.isArray(componentStamp.files) || componentStamp.files.length !== expectedPaths.length ||
      componentStamp.files.some(path => !expectedPaths.some(expected => pathKey(expected) === pathKey(path)))) return null
  const legacyFiles = (entries || []).filter(entry => entry.type === 'plugin-backend-file')
  const legacyConfig = (entries || []).filter(entry => entry.type === 'plugin-backend-config')
  const legacyFileKeys = new Set(legacyFiles.map(entry => pathKey(entry.path)))
  if (legacyFiles.length !== expectedPaths.length || legacyFileKeys.size !== expectedPathKeys.size ||
      [...expectedPathKeys].some(key => !legacyFileKeys.has(key)) || legacyConfig.length !== 1 ||
      legacyFiles.some(entry => entry.id !== PLUGIN_BACKEND_ID ||
        !expectedPaths.some(expected => pathKey(expected) === pathKey(entry.path)) ||
        entry.state !== undefined || entry.transactionId !== undefined || entry.installedHash !== undefined ||
        entry.preExisting !== false || entry.backup !== null) ||
      legacyConfig.some(entry => entry.id !== PLUGIN_BACKEND_ID || pathKey(entry.path) !== pathKey(configPath) ||
        entry.state !== undefined || entry.transactionId !== undefined || entry.installedHash !== undefined ||
        entry.prior?.disabled !== false || entry.prior?.enabled !== false)) return null
  const receipts = new Map()
  for (const [index, relativePath] of PLUGIN_BACKEND_FILES.entries()) {
    const path = expectedPaths[index]
    const expectedHash = legacyHashes.get(relativePath)
    if (!expectedHash || fileSha256(path) !== expectedHash) return null
    receipts.set(pathKey(path), {
      backup: null, backupCreated: false, backupHash: null, createdDirectories: [],
      id: PLUGIN_BACKEND_ID, installedHash: expectedHash, path, preExisting: false,
      previousHash: null, rollbackBackup: null, source: relativePath, temporary: null,
    })
  }
  return {
    files: receipts,
    config: {
      id: PLUGIN_BACKEND_ID, installedState: { disabled: false, enabled: true },
      path: configPath, prior: { disabled: false, enabled: false }, rollbackBackup: null,
    },
  }
}

/** Install the backend files and enable them in the existing Hermes config. */
export function installPluginBackend({
  home,
  sourceRoot,
  nowIso,
  version,
  files: bundleFiles = PLUGIN_BACKEND_FILES,
}) {
  const targetRoot = pluginBackendRoot(home)
  let priorEntries = readManifest(home).entries || []
  const componentStamp = readStamp(home)?.applied?.pluginBackend
  if (componentStamp && (typeof componentStamp.path !== 'string' ||
      pathKey(componentStamp.path) !== pathKey(targetRoot))) {
    throw new Error('Telemetry backend ownership stamp points to a different path.')
  }
  const activeStamp = componentStamp && pathKey(componentStamp.path) === pathKey(targetRoot)
  const activeTransactionId = activeStamp ? componentStamp.transactionId : null
  const configPath = join(home, 'config.yaml')
  assertSafeManagedPath(home, configPath, 'telemetry backend config')
  if (recoverInterruptedBackendTransaction(
    home,
    priorEntries,
    activeTransactionId,
    configPath,
    nowIso,
  )) {
    priorEntries = readManifest(home).entries || []
  }
  let activeFileReceipts = new Map()
  let activeFileReceiptCount = 0
  if (activeTransactionId) {
    for (const entry of [...priorEntries].reverse()) {
      if (entry.type !== 'plugin-backend-file' ||
          entry.state !== 'installed' ||
          entry.transactionId !== activeTransactionId) continue
      activeFileReceiptCount += 1
      if (typeof entry.path !== 'string') {
        throw new Error('Telemetry backend ownership stamp has no complete manifest receipts.')
      }
      const key = pathKey(entry.path)
      if (!activeFileReceipts.has(key)) activeFileReceipts.set(key, entry)
    }
  }
  const original = readFileSync(configPath, 'utf8')
  let lastConfigReceipt = activeTransactionId
    ? [...priorEntries].reverse().find(entry => {
      return entry.type === 'plugin-backend-config' &&
        pathKey(entry.path) === pathKey(configPath) &&
        entry.state === 'installed' &&
        entry.transactionId === activeTransactionId
    })
    : null
  const legacyReceipts = activeStamp && !activeTransactionId
    ? legacyBackendReceiptSet({ componentStamp, configPath, entries: priorEntries, original, targetRoot })
    : null
  if (legacyReceipts) {
    activeFileReceipts = legacyReceipts.files
    lastConfigReceipt = legacyReceipts.config
  }
  const stampedFiles = componentStamp?.files
  const stampedPathsValid = Array.isArray(stampedFiles) &&
    stampedFiles.every(path => typeof path === 'string')
  const stampedFileKeys = stampedPathsValid ? stampedFiles.map(pathKey) : []
  if (activeStamp && (
    (!activeTransactionId && !legacyReceipts) ||
    !lastConfigReceipt ||
    !stampedPathsValid ||
    stampedFileKeys.length !== new Set(stampedFileKeys).size ||
    (!legacyReceipts && activeFileReceiptCount !== activeFileReceipts.size) ||
    stampedFiles.length !== activeFileReceipts.size ||
    stampedFiles.some(target => !activeFileReceipts.has(pathKey(target)))
  )) {
    throw new Error('Telemetry backend ownership stamp has no complete manifest receipts.')
  }
  for (const receipt of activeFileReceipts.values()) {
    validateActiveBackendReceipt(receipt, targetRoot, home)
  }

  const seenBundleTargets = new Set()
  const bundleEntries = bundleFiles.map(relativePath => {
    if (typeof relativePath !== 'string') {
      throw new Error('Telemetry backend bundle path must be a string.')
    }
    const source = resolve(sourceRoot, relativePath)
    const target = resolve(targetRoot, relativePath)
    if (!inside(sourceRoot, source) || !inside(targetRoot, target)) {
      throw new Error(`Telemetry backend bundle path is outside its root: ${relativePath}`)
    }
    const key = pathKey(target)
    if (seenBundleTargets.has(key)) {
      throw new Error(`Telemetry backend bundle has a duplicate path: ${relativePath}`)
    }
    seenBundleTargets.add(key)
    return { relativePath, source, target }
  })
  const managedBefore = Boolean(activeStamp)
  const currentConfigState = pluginConfigState(original)
  if (managedBefore && (
    currentConfigState.disabled !== lastConfigReceipt.installedState?.disabled ||
    currentConfigState.enabled !== lastConfigReceipt.installedState?.enabled
  )) {
    throw new Error('Telemetry backend membership changed after this pack wrote it. Preserve it and merge manually.')
  }
  const preservedPrior = managedBefore && lastConfigReceipt?.prior
    ? lastConfigReceipt.prior
    : currentConfigState
  const updated = setPluginConfigState(original, { disabled: false, enabled: true })
  cleanupCommittedBackendArtifacts(
    home,
    priorEntries,
    activeTransactionId,
    targetRoot,
    configPath,
  )
  const configRollback = updated !== original
    ? uniqueSiblingPath(configPath, 'classic-gold-rollback')
    : null
  const transactionId = randomUUID()
  const configPlan = {
    type: 'plugin-backend-config',
    id: PLUGIN_BACKEND_ID,
    path: configPath,
    installedHash: sha256(updated),
    installedState: { disabled: false, enabled: true },
    previousHash: sha256(original),
    prior: preservedPrior,
    rollbackBackup: configRollback,
    state: 'planned',
    temporary: updated !== original
      ? uniqueSiblingPath(configPath, 'classic-gold-next')
      : null,
    transactionId,
  }

  const plans = bundleEntries.map(({ relativePath, source, target }) => {
    assertSafeManagedPath(home, target, 'telemetry backend target')
    const priorReceipt = managedBefore ? activeFileReceipts.get(pathKey(target)) : null
    const currentExists = existsSync(target)
    const previousHash = currentExists ? fileSha256(target) : null
    const preExisting = priorReceipt ? Boolean(priorReceipt.preExisting) : currentExists
    const backup = priorReceipt
      ? priorReceipt?.backup || null
      : preExisting
        ? uniqueSiblingPath(target, 'pre-classic-gold')
        : null
    return {
      source,
      currentExists,
      receipt: {
        type: 'plugin-backend-file',
        id: PLUGIN_BACKEND_ID,
        path: target,
        backup,
        backupCreated: Boolean(!priorReceipt && preExisting && backup),
        backupHash: priorReceipt?.backupHash || null,
        createdDirectories: missingDirectories(dirname(target), home),
        installedHash: fileSha256(source),
        preExisting,
        previousHash,
        rollbackBackup: currentExists ? uniqueSiblingPath(target, 'classic-gold-rollback') : null,
        source: relative(sourceRoot, source),
        state: 'planned',
        temporary: uniqueSiblingPath(target, 'classic-gold-next'),
        transactionId,
      },
    }
  })

  const retirements = []
  for (const priorReceipt of activeFileReceipts.values()) {
    if (seenBundleTargets.has(pathKey(priorReceipt.path))) continue
    retirements.push({
      receipt: {
        type: 'plugin-backend-file-retirement',
        id: PLUGIN_BACKEND_ID,
        path: priorReceipt.path,
        backup: priorReceipt.backup || null,
        backupHash: priorReceipt.backupHash || null,
        createdDirectories: (priorReceipt.createdDirectories || []).filter(directory => {
          return pathKey(directory) === pathKey(targetRoot) || inside(targetRoot, directory)
        }),
        preExisting: Boolean(priorReceipt.preExisting),
        previousHash: priorReceipt.installedHash,
        restoredHash: priorReceipt.preExisting ? priorReceipt.backupHash : null,
        rollbackBackup: uniqueSiblingPath(priorReceipt.path, 'classic-gold-rollback'),
        temporary: uniqueSiblingPath(priorReceipt.path, 'classic-gold-next'),
        sourceTransactionId: activeTransactionId,
        state: 'planned',
        transactionId,
      },
    })
  }

  appendManifest(home, {
    type: 'plugin-backend-transaction',
    state: 'planned',
    transactionId,
  }, nowIso)
  for (const plan of plans) {
    assertBackendReceiptPaths(home, plan.receipt)
    appendManifest(home, plan.receipt, nowIso)
  }
  for (const plan of retirements) {
    assertBackendReceiptPaths(home, plan.receipt)
    appendManifest(home, plan.receipt, nowIso)
  }
  assertSafeManagedPath(home, configPlan.path, 'telemetry backend config')
  if (configPlan.rollbackBackup) {
    assertSafeManagedPath(home, configPlan.rollbackBackup, 'telemetry backend config rollback backup')
  }
  if (configPlan.temporary) {
    assertSafeManagedPath(home, configPlan.temporary, 'telemetry backend config temporary file')
  }
  appendManifest(home, configPlan, nowIso)

  try {
    for (const plan of retirements) {
      applyBackendRetirement(plan, home)
      for (const directory of plan.receipt.createdDirectories) {
        assertSafeManagedPath(home, directory, 'telemetry backend created directory')
      }
      removeEmptyDirectories(plan.receipt.createdDirectories)
    }

    for (const plan of plans) {
      const receipt = plan.receipt
      assertBackendReceiptPaths(home, receipt)
      mkdirSync(dirname(receipt.path), { recursive: true })
      if (receipt.rollbackBackup) {
        copyFileSync(receipt.path, receipt.rollbackBackup)
        if (fileSha256(receipt.rollbackBackup) !== receipt.previousHash) {
          throw new Error(`telemetry backend rollback backup verification failed: ${receipt.path}`)
        }
      }
      if (receipt.backupCreated && receipt.backup) {
        copyFileSync(receipt.path, receipt.backup)
        if (fileSha256(receipt.backup) !== receipt.previousHash) {
          throw new Error(`telemetry backend backup verification failed: ${receipt.path}`)
        }
      }
      copyFileAtomically(plan.source, receipt.path, receipt.temporary)
      if (fileSha256(receipt.path) !== receipt.installedHash) {
        throw new Error(`telemetry backend hash verification failed: ${receipt.path}`)
      }
    }

    if (configRollback) {
      assertSafeManagedPath(home, configPath, 'telemetry backend config')
      assertSafeManagedPath(home, configRollback, 'telemetry backend config rollback backup')
      copyFileSync(configPath, configRollback)
      if (fileSha256(configRollback) !== configPlan.previousHash) {
        throw new Error('telemetry backend config rollback backup hash verification failed')
      }
      if (fileSha256(configPath) !== configPlan.previousHash) {
        throw new Error('telemetry backend config changed before the planned write')
      }
      assertSafeManagedPath(home, configPlan.temporary, 'telemetry backend config temporary file')
      writeTextAtomically(configPath, updated, configPlan.temporary)
      if (fileSha256(configPath) !== configPlan.installedHash) {
        throw new Error('telemetry backend config hash verification failed')
      }
    }

    for (const plan of plans) {
      const receipt = plan.receipt
      appendManifest(home, {
        ...receipt,
        backupHash: receipt.backup ? fileSha256(receipt.backup) : null,
        state: 'installed',
        temporary: null,
      }, nowIso)
    }
    for (const plan of retirements) {
      appendManifest(home, { ...plan.receipt, state: 'installed' }, nowIso)
    }
    appendManifest(home, { ...configPlan, state: 'installed' }, nowIso)

    const files = plans.map(plan => plan.receipt.path)
    recordApplied(home, 'pluginBackend', {
      via: 'dashboard-api',
      id: PLUGIN_BACKEND_ID,
      path: targetRoot,
      files,
      configPath,
      restartRequired: true,
      transactionId,
    }, { nowIso, version })
    try {
      appendManifest(home, {
        type: 'plugin-backend-transaction',
        state: 'committed',
        transactionId,
      }, nowIso)
    } catch {
      // The active stamp also proves that this transaction committed.
    }

    for (const plan of plans) {
      try {
        assertBackendReceiptPaths(home, plan.receipt)
        if (plan.receipt.rollbackBackup && existsSync(plan.receipt.rollbackBackup)) {
          if (fileSha256(plan.receipt.rollbackBackup) !== plan.receipt.previousHash) {
            throw new Error(`telemetry backend rollback backup changed after commit: ${plan.receipt.path}`)
          }
          unlinkSync(plan.receipt.rollbackBackup)
        }
      } catch {
        // The installed receipt records this path for later cleanup.
      }
    }
    for (const plan of retirements) {
      try {
        assertBackendReceiptPaths(home, plan.receipt)
        if (existsSync(plan.receipt.rollbackBackup)) {
          if (fileSha256(plan.receipt.rollbackBackup) !== plan.receipt.previousHash) {
            throw new Error(`telemetry backend retirement rollback changed after commit: ${plan.receipt.path}`)
          }
          unlinkSync(plan.receipt.rollbackBackup)
        }
        removeEmptyDirectories(plan.receipt.createdDirectories)
      } catch {
        // The completed retirement receipt keeps the cleanup path.
      }
    }
    try {
      assertSafeManagedPath(home, configPath, 'telemetry backend config')
      if (configRollback) {
        assertSafeManagedPath(home, configRollback, 'telemetry backend config rollback backup')
      }
      if (configRollback && existsSync(configRollback)) {
        if (fileSha256(configRollback) !== configPlan.previousHash) {
          throw new Error('telemetry backend config rollback backup changed after commit')
        }
        unlinkSync(configRollback)
      }
    } catch {
      // The installed config receipt records this path for later cleanup.
    }

    return { configChanged: updated !== original, configPath, files, path: targetRoot }
  } catch (error) {
    let configRolledBack = false
    let rollbackComplete = true
    try {
      assertSafeManagedPath(home, configPath, 'telemetry backend config')
      if (configRollback) {
        assertSafeManagedPath(home, configRollback, 'telemetry backend config rollback backup')
      }
      if (configRollback && existsSync(configRollback)) {
        if (fileSha256(configRollback) !== configPlan.previousHash) {
          throw new Error('telemetry backend config rollback backup hash verification failed')
        }
        const currentHash = fileSha256(configPath)
        if (currentHash !== configPlan.previousHash) {
          if (currentHash !== configPlan.installedHash) {
            throw new Error('telemetry backend config changed before rollback')
          }
          if (!configPlan.temporary) {
            throw new Error('telemetry backend config receipt has no recorded temporary path')
          }
          copyFileAtomically(configRollback, configPath, configPlan.temporary)
        }
        if (fileSha256(configPath) !== configPlan.previousHash) {
          throw new Error('telemetry backend config rollback hash verification failed')
        }
        unlinkSync(configRollback)
        configRolledBack = true
      } else if (fileSha256(configPath) === configPlan.previousHash) {
        configRolledBack = true
      }
    } catch {
      rollbackComplete = false
      // Keep the planned config receipt when exact rollback cannot complete.
    }
    for (const plan of [...plans].reverse()) {
      try {
        const receipt = plan.receipt
        assertBackendReceiptPaths(home, receipt)
        if (existsSync(receipt.temporary)) {
          if (!receipt.installedHash || fileSha256(receipt.temporary) !== receipt.installedHash) {
            throw new Error(`telemetry backend temporary changed: ${receipt.path}`)
          }
          unlinkSync(receipt.temporary)
        }
        if (receipt.rollbackBackup && existsSync(receipt.rollbackBackup)) {
          if (fileSha256(receipt.rollbackBackup) !== receipt.previousHash) {
            throw new Error(`telemetry backend rollback backup hash verification failed: ${receipt.path}`)
          }
          const currentHash = fileSha256(receipt.path)
          if (currentHash !== receipt.previousHash) {
            if (currentHash !== receipt.installedHash) {
              throw new Error(`telemetry backend file changed before rollback: ${receipt.path}`)
            }
            if (!receipt.temporary) {
              throw new Error(`telemetry backend receipt has no recorded temporary path: ${receipt.path}`)
            }
            copyFileAtomically(receipt.rollbackBackup, receipt.path, receipt.temporary)
          }
          if (fileSha256(receipt.path) !== receipt.previousHash) {
            throw new Error(`telemetry backend rollback hash verification failed: ${receipt.path}`)
          }
          unlinkSync(receipt.rollbackBackup)
        } else if (plan.currentExists) {
          if (fileSha256(receipt.path) !== receipt.previousHash) {
            throw new Error(`telemetry backend file changed during rollback: ${receipt.path}`)
          }
        } else if (!plan.currentExists && receipt.installedHash && fileSha256(receipt.path) === receipt.installedHash) {
          unlinkSync(receipt.path)
        } else if (fileSha256(receipt.path) !== null) {
          throw new Error(`new telemetry backend file changed during rollback: ${receipt.path}`)
        }
        if (receipt.backupCreated && receipt.backup && existsSync(receipt.backup)) {
          if (fileSha256(receipt.backup) !== receipt.previousHash) {
            throw new Error(`telemetry backend backup changed during rollback: ${receipt.path}`)
          }
          unlinkSync(receipt.backup)
        }
        removeEmptyDirectories(receipt.createdDirectories)
        appendManifest(home, { ...receipt, state: 'rolled-back' }, nowIso)
      } catch {
        rollbackComplete = false
        // Keep the planned file receipt when exact rollback cannot complete.
      }
    }
    for (const plan of [...retirements].reverse()) {
      try {
        assertBackendReceiptPaths(home, plan.receipt)
        mkdirSync(dirname(plan.receipt.path), { recursive: true })
        rollBackBackendRetirement(plan, home)
        appendManifest(home, { ...plan.receipt, state: 'rolled-back' }, nowIso)
      } catch {
        rollbackComplete = false
        // Keep the planned retirement receipt when exact rollback cannot complete.
      }
    }
    if (configRolledBack) {
      try {
        appendManifest(home, { ...configPlan, state: 'rolled-back' }, nowIso)
      } catch {
        // The planned config receipt still describes the restored state.
      }
    } else {
      rollbackComplete = false
    }
    if (rollbackComplete) {
      try {
        appendManifest(home, {
          type: 'plugin-backend-transaction',
          state: 'rolled-back',
          transactionId,
        }, nowIso)
      } catch {
        // Individual rolled-back receipts still describe the recovered state.
      }
    }
    throw error
  }
}
