import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatDiagnostics, buildIssueUrl } from '../scripts/diagnostics.mjs'

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
