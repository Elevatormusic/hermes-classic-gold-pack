import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SourceTextModule, SyntheticModule } from 'node:vm'

// Execute the full renderer module with host dependencies supplied by the test.
const source = readFileSync(process.argv[2] || new URL('../../desktop-plugin/classic-gold/plugin.js', import.meta.url), 'utf8')
const plugin = new SourceTextModule(source)
const modules = {
  '@hermes/plugin-sdk': {
    atom: value => ({ get: () => value, set: () => {} }),
    Button: null, ConfirmDialog: null, DEFAULT_REASONING_EFFORT: '', DropdownMenu: null,
    DropdownMenuContent: null, DropdownMenuItem: null, DropdownMenuSeparator: null,
    DropdownMenuTrigger: null, host: {}, Input: null, PALETTE_AREA: '', Popover: null,
    PopoverContent: null, PopoverTrigger: null, REASONING_EFFORT_VALUES: [],
    reasoningEffortLabel: () => '', ROUTES_AREA: '', SegmentedControl: null,
    STATUSBAR_AREAS: {}, Switch: null, THEMES_AREA: '', useQuery: () => {}, useValue: () => {}
  },
  react: { useEffect: () => {}, useMemo: () => {}, useRef: () => {}, useState: () => {} },
  'react/jsx-runtime': { jsx: () => {}, jsxs: () => {} }
}
await plugin.link(specifier => {
  const values = modules[specifier]
  assert.ok(values, `Unexpected module ${specifier}`)
  return new SyntheticModule(Object.keys(values), function () {
    for (const [name, value] of Object.entries(values)) this.setExport(name, value)
  })
})
await plugin.evaluate()
const { contextReadout, createContextPoller } = plugin.namespace
const measured = {
  status: 'anchored', source: 'active_usage_anchor', session_id: 'a',
  context_used: 120_500, context_max: 262_144
}
assert.equal(contextReadout(measured, 'a').label, '~121K/262K')
assert.equal(contextReadout(measured, 'b').label, 'unknown')
assert.equal(contextReadout({ context_used: 513_000, context_max: 262_144, total: 1_900_000 }, 'a').percent, null)
assert.equal(contextReadout({ ...measured, status: 'unknown' }, 'a').label, '--/262K')
assert.equal(contextReadout({ ...measured, context_used: 513_000 }, 'a').percent, 196)
assert.equal(contextReadout({ ...measured, context_used: NaN }, 'a').percent, null)
assert.equal(contextReadout({ ...measured, context_used: 0 }, 'a').percent, null)
assert.equal(contextReadout({ ...measured, context_used: '120500' }, 'a').percent, null)
assert.equal(contextReadout({ ...measured, status: 'last_request', source: 'last_provider_request' }, 'a').label, 'last 121K/262K')

const pending = []
const seen = []
const poller = createContextPoller({
  sessionId: 'a',
  request: url => new Promise(resolve => pending.push({ url, resolve })),
  publish: sample => seen.push(sample)
})
const older = poller.refresh()
const newer = poller.refresh()
pending[1].resolve({ ...measured, context_used: 60_000 })
await newer
pending[0].resolve(measured)
await older
assert.equal(seen.length, 1)
assert.equal(seen[0].context_used, 60_000)
assert.equal(pending[0].url, '/context?session_id=a')
const leaving = poller.refresh()
poller.dispose()
pending[2].resolve(measured)
await leaving
assert.equal(seen.length, 1)

const wrongSession = createContextPoller({ sessionId: 'b', request: async () => measured, publish: sample => seen.push(sample) })
await wrongSession.refresh()
assert.equal(seen.at(-1).status, 'unknown')
assert.equal(seen.at(-1).session_id, 'b')
const failed = createContextPoller({ sessionId: 'b', request: async () => { throw new Error('offline') }, publish: sample => seen.push(sample) })
await failed.refresh()
assert.equal(seen.at(-1).status, 'unknown')
