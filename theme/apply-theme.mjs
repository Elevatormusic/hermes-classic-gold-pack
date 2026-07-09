#!/usr/bin/env node
// apply-theme.mjs — install the Classic Gold theme automatically.
//
//   node theme/apply-theme.mjs [--port 9222] [--exe <Hermes.exe>] [--no-relaunch] [--manual]
//
// The theme lives only in the app's localStorage (there is no theme file/CLI),
// so this applies it the way a human would — by running the pack's OWN snippet
// (theme/install-theme.js) in the renderer. To do that unattended it:
//   1. fully quits Hermes (a running instance would drop the debug flag via the
//      single-instance lock),
//   2. relaunches Hermes as the sole instance with a *localhost* DevTools debug
//      port,
//   3. evaluates the exact snippet over the DevTools protocol,
//   4. waits for the write to flush, closes that instance, and relaunches Hermes
//      normally (no debug port left open).
//
// It only ever runs the pack's own snippet — inspect theme/install-theme.js.
// If anything fails (non-Windows, exe not found, port won't bind), it prints the
// snippet and the one manual paste step instead, so you're never stuck.
import { readFileSync, existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveHermesHome } from '../lib/hermes-home.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SNIPPET = readFileSync(join(HERE, 'install-theme.js'), 'utf8')

function parseArgs(argv) {
  const a = { port: 9222, exe: undefined, relaunch: true, manual: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') a.port = Number(argv[++i])
    else if (argv[i] === '--exe') a.exe = argv[++i]
    else if (argv[i] === '--no-relaunch') a.relaunch = false
    else if (argv[i] === '--manual') a.manual = true
  }
  return a
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function manualFallback(reason) {
  console.log(`\n⚠ Automatic theme install unavailable (${reason}).`)
  console.log('Do this one manual step instead — it takes ~10 seconds:')
  console.log('  1. In Hermes, press Ctrl/Cmd+Shift+I → click the Console tab.')
  console.log('  2. Paste the snippet below → press Enter. (It self-reverts if you pick another theme.)\n')
  console.log('────────── theme/install-theme.js ──────────')
  console.log(SNIPPET.trim())
  console.log('─────────────────────────────────────────────')
  return 0 // graceful degradation, not an error
}

function hermesExe(args) {
  if (args.exe) return existsSync(args.exe) ? args.exe : null
  const home = resolveHermesHome({})
  if (!home) return null
  const exe = join(home, 'hermes-agent', 'apps', 'desktop', 'release', 'win-unpacked', 'Hermes.exe')
  return existsSync(exe) ? exe : null
}

function hermesProcessCount() {
  try {
    const out = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Hermes.exe', '/NH'], { encoding: 'utf8' }).stdout || ''
    return (out.match(/Hermes\.exe/gi) || []).length
  } catch {
    return 0
  }
}

function killHermes() {
  try {
    spawnSync('taskkill', ['/IM', 'Hermes.exe', '/F'], { stdio: 'ignore' })
  } catch {
    // none running — fine
  }
}

async function waitForNoHermes(timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (hermesProcessCount() === 0) return true
    await sleep(500)
  }
  return false
}

function launch(exe, extraArgs = []) {
  const child = spawn(exe, extraArgs, { detached: true, stdio: 'ignore' })
  child.unref()
}

async function waitForPort(port, timeoutMs = 25000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (res.ok) return true
    } catch {
      // not up yet
    }
    await sleep(500)
  }
  return false
}

async function pickPageTarget(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  const targets = await res.json()
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  // Prefer the app window (file:// origin) over any devtools/about pages.
  return pages.find((t) => /^file:/.test(t.url || '')) || pages[0] || null
}

function evaluateSnippet(wsUrl, expression, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const to = setTimeout(() => {
      try { ws.close() } catch {}
      reject(new Error('CDP timeout'))
    }, timeoutMs)
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, userGesture: true, awaitPromise: false, returnByValue: true } }))
    })
    ws.addEventListener('message', (ev) => {
      let msg
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') } catch { return }
      if (msg.id !== 1) return
      clearTimeout(to)
      if (msg.error || msg.result?.exceptionDetails) {
        try { ws.close() } catch {}
        reject(new Error(msg.error?.message || 'evaluate raised an exception'))
        return
      }
      // Give the snippet's location.reload() a moment to flush localStorage → leveldb.
      setTimeout(() => { try { ws.close() } catch {}; resolve(true) }, 1500)
    })
    ws.addEventListener('error', () => {
      clearTimeout(to)
      reject(new Error('WebSocket error'))
    })
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.manual) return manualFallback('--manual requested')
  if (process.platform !== 'win32') return manualFallback('auto install is Windows-only for now')

  const exe = hermesExe(args)
  if (!exe) return manualFallback('could not find Hermes.exe — pass --exe <path>')

  console.log('• Applying the Classic Gold theme automatically…')
  console.log('  (quitting Hermes, relaunching it once with a localhost debug port, then restoring it)')

  try {
    // 1. Fully quit Hermes so our debug-flagged launch is the sole instance.
    killHermes()
    if (!(await waitForNoHermes())) throw new Error('Hermes would not fully quit')

    // 2. Launch as sole instance with a localhost DevTools port.
    launch(exe, [`--remote-debugging-port=${args.port}`])
    if (!(await waitForPort(args.port))) throw new Error(`debug port ${args.port} never bound`)

    // 3. Find the app window and run the pack's own snippet in it. A freshly
    //    rebuilt app can reload/replace the page mid-evaluate on its first
    //    launch (first-run bootstrap), so retry once after a short settle
    //    before giving up to the manual fallback.
    let applied = false
    for (let attempt = 1; attempt <= 2 && !applied; attempt++) {
      const target = await pickPageTarget(args.port)
      if (!target) throw new Error('no app window target found on the debug port')
      try {
        await evaluateSnippet(target.webSocketDebuggerUrl, SNIPPET)
        applied = true
      } catch (e) {
        if (attempt === 2) throw e
        console.warn(`! evaluate failed (${e.message}); app is likely still initializing — retrying once…`)
        await sleep(2000)
      }
    }
    console.log('✓ Theme snippet applied and written to localStorage.')

    // 4. Close the debug instance (never leave the port open) and restore Hermes.
    killHermes()
    await waitForNoHermes(10000)
    if (args.relaunch) {
      launch(exe)
      console.log('✓ Relaunched Hermes normally (debug port closed). The gold theme is active.')
    } else {
      console.log('✓ Debug instance closed. Relaunch Hermes to see the gold theme.')
    }
    return 0
  } catch (err) {
    // Clean up any debug instance we may have left, then fall back to manual.
    killHermes()
    return manualFallback(err.message)
  }
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('✗ Unexpected error:', err.message)
  process.exit(1)
})
