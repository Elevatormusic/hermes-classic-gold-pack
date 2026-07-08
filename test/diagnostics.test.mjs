import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatDiagnostics, buildIssueUrl, collectLogs } from '../scripts/diagnostics.mjs'

const INFO = {
  platform: 'win32',
  arch: 'x64',
  node: 'v24.0.0',
  hermesHome: 'C:/x/hermes',
  agentHead: '8301654',
  onBase: true,
  packStamp: null,
}

test('formatDiagnostics includes key fields and on-base verdict', () => {
  const s = formatDiagnostics(INFO)
  assert.match(s, /win32/)
  assert.match(s, /v24\.0\.0/)
  assert.match(s, /on base 8301654: yes/i)
})

test('buildIssueUrl encodes title+body and targets the repo with the label', () => {
  const url = buildIssueUrl(INFO, { title: 'status bar failed', error: 'git apply rejected' })
  assert.ok(url.startsWith('https://github.com/Elevatormusic/hermes-classic-gold-pack/issues/new?'))
  assert.match(url, /title=status%20bar%20failed/)
  assert.match(url, /labels=install-failure/)
  assert.match(url, /git%20apply%20rejected/)
})

test('collectLogs tails known log files, priority-ordered, skips empty', () => {
  const home = mkdtempSync(join(tmpdir(), 'hcgp-logs-'))
  mkdirSync(join(home, 'logs'), { recursive: true })
  const many = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
  writeFileSync(join(home, 'logs', 'errors.log'), many)
  writeFileSync(join(home, 'logs', 'desktop.log'), 'desk-a\ndesk-b')
  writeFileSync(join(home, 'logs', 'gui.log'), '   ') // whitespace-only → skipped

  const logs = collectLogs(home, { maxLines: 10 })
  assert.deepEqual(logs.map((l) => l.name), ['errors.log', 'desktop.log'])
  assert.equal(logs[0].tail.split('\n').length, 10) // tail limited
  assert.match(logs[0].tail, /line 99/)
  assert.equal(logs[1].tail, 'desk-a\ndesk-b')
})

test('collectLogs returns [] when there is no logs dir', () => {
  const home = mkdtempSync(join(tmpdir(), 'hcgp-nolog-'))
  assert.deepEqual(collectLogs(home), [])
})
