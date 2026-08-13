import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

import { gitBlobHash, headBlobHash, indexBlobHash } from '../lib/git-blob.mjs'

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8' }).trim()
}

test('gitBlobHash matches the committed HEAD blob and fails closed for a missing file', t => {
  const repo = mkdtempSync(join(tmpdir(), 'classic-gold-git-blob-'))
  t.after(() => rmSync(repo, { recursive: true, force: true }))

  writeFileSync(join(repo, 'target.txt'), 'stock\n')
  run('git', ['init'], repo)
  run('git', ['add', 'target.txt'], repo)
  run('git', ['-c', 'user.name=Classic Gold Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'], repo)

  assert.equal(gitBlobHash(repo, 'target.txt', { asPath: 'target.txt' }), headBlobHash(repo, 'target.txt'))
  assert.equal(gitBlobHash(repo, 'missing.txt', { asPath: 'missing.txt' }), null)
})

test('indexBlobHash reads one stage-zero row and rejects unresolved rows', () => {
  const blob = 'a'.repeat(40)
  assert.equal(indexBlobHash('repo', 'file.js', {
    exec: () => `100644 ${blob} 0\tfile.js\n`,
  }), blob)
  assert.equal(indexBlobHash('repo', 'file.js', {
    exec: () => `100644 ${blob} 1\tfile.js\n100644 ${blob} 2\tfile.js\n`,
  }), null)
})
