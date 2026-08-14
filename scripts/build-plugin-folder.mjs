import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { buildDesktopPluginSource, WORDMARK_TOKEN } from '../lib/desktop-plugin.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Build the folder-copy release without changing an existing output folder. */
export function buildPluginFolderBundle ({ destination } = {}) {
  const packageData = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const target = resolve(destination || join(ROOT, 'dist', `Hermes-Classic-Gold-v${packageData.version}`))
  if (existsSync(target)) throw new Error(`Output already exists: ${target}`)

  const rendererTarget = join(target, 'desktop-plugins', 'classic-gold', 'plugin.js')
  const backendTarget = join(target, 'plugins', 'classic-gold', 'dashboard')
  const renderer = buildDesktopPluginSource(join(ROOT, 'desktop-plugin', 'classic-gold', 'plugin.js'))
  if (renderer.includes(WORDMARK_TOKEN)) {
    throw new Error('The built desktop plug-in still contains the wordmark placeholder.')
  }

  mkdirSync(dirname(rendererTarget), { recursive: true })
  writeFileSync(rendererTarget, renderer)
  cpSync(join(ROOT, 'backend', 'classic-gold', 'dashboard'), backendTarget, { recursive: true })
  copyFileSync(join(ROOT, 'docs', 'EASY-INSTALL.md'), join(target, 'START-HERE.md'))
  copyFileSync(join(ROOT, 'docs', 'AI-AGENT-PROMPTS.md'), join(target, 'AI-AGENT-PROMPTS.md'))

  return { target, version: packageData.version }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outputIndex = process.argv.indexOf('--output')
  const destination = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined
  if (outputIndex >= 0 && !destination) throw new Error('--output requires a directory path.')
  const result = buildPluginFolderBundle({ destination })
  console.log(`Built Classic Gold ${result.version} folder at ${result.target}`)
}
