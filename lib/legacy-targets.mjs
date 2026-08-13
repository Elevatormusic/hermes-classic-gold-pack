import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

function walkFiles(root, prefix = '') {
  if (!existsSync(root)) return []
  const files = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...walkFiles(join(root, entry.name), rel))
    else if (entry.isFile()) files.push(rel)
  }
  return files
}

/** Return every repository path shipped by a legacy source-patch baseline. */
export function knownLegacyPaths(packRoot) {
  const paths = new Set()
  const roots = [
    join(packRoot, 'advanced', 'statusbar', 'baselines'),
    join(packRoot, 'advanced', 'extras-caduceus', 'baselines'),
  ]
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const baseline of readdirSync(root, { withFileTypes: true })) {
      if (!baseline.isDirectory()) continue
      for (const rel of walkFiles(join(root, baseline.name, 'files'))) paths.add(rel)
    }
  }
  return [...paths]
}
