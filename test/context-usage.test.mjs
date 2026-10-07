import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('context renderer handles unknown usage, compaction, and stale session requests', () => {
  const worker = fileURLToPath(new URL('../scripts/fixtures/context-usage-worker.mjs', import.meta.url))
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', worker], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
