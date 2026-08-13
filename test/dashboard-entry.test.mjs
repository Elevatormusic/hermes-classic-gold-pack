import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY_PATH = join(ROOT, 'backend', 'classic-gold', 'dashboard', 'dist', 'index.js')

test('hidden dashboard entry registers a no-op component with the Hermes host', () => {
  const registrations = []
  const context = {
    window: {
      __HERMES_PLUGINS__: {
        register(name, component) {
          registrations.push({ component, name })
        },
      },
    },
  }

  vm.runInNewContext(readFileSync(ENTRY_PATH, 'utf8'), context, {
    filename: ENTRY_PATH,
  })

  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].name, 'classic-gold')
  assert.equal(typeof registrations[0].component, 'function')
  assert.equal(registrations[0].component(), null)
})

test('dashboard entry fails clearly when the Hermes host contract is missing', () => {
  assert.throws(
    () => vm.runInNewContext(readFileSync(ENTRY_PATH, 'utf8'), { window: {} }),
    /Hermes dashboard plug-in registry is not available/,
  )
})
