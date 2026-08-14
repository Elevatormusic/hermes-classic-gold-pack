import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildDesktopPluginSource, WORDMARK_TOKEN } from '../lib/desktop-plugin.mjs'
import { buildPluginFolderBundle } from '../scripts/build-plugin-folder.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('folder-copy bundle contains the built renderer, backend, and guides', t => {
  const temporary = mkdtempSync(join(tmpdir(), 'classic-gold-folder-'))
  const destination = join(temporary, 'bundle')
  t.after(() => rmSync(temporary, { recursive: true, force: true }))

  const result = buildPluginFolderBundle({ destination })
  const renderer = readFileSync(join(destination, 'desktop-plugins', 'classic-gold', 'plugin.js'), 'utf8')
  const expectedRenderer = buildDesktopPluginSource(join(ROOT, 'desktop-plugin', 'classic-gold', 'plugin.js'))

  assert.equal(result.target, destination)
  assert.equal(renderer, expectedRenderer)
  assert.equal(renderer.includes(WORDMARK_TOKEN), false)
  for (const relativePath of ['manifest.json', 'plugin_api.py', join('dist', 'index.js')]) {
    assert.deepEqual(
      readFileSync(join(destination, 'plugins', 'classic-gold', 'dashboard', relativePath)),
      readFileSync(join(ROOT, 'backend', 'classic-gold', 'dashboard', relativePath))
    )
  }
  assert.match(readFileSync(join(destination, 'START-HERE.md'), 'utf8'), /Easy folder install/)
  assert.match(readFileSync(join(destination, 'AI-AGENT-PROMPTS.md'), 'utf8'), /Copy a prompt/)
})

test('folder-copy builder does not replace an existing output', t => {
  const temporary = mkdtempSync(join(tmpdir(), 'classic-gold-folder-'))
  const destination = join(temporary, 'bundle')
  t.after(() => rmSync(temporary, { recursive: true, force: true }))

  buildPluginFolderBundle({ destination })
  assert.throws(() => buildPluginFolderBundle({ destination }), /Output already exists/)
})
