// Legacy source-patch application is retired. Keep this entry point so an old
// command fails with migration guidance before it can change a Hermes checkout.

/** Refuse a retired legacy source-patch request. */
export function applyTier({ label = 'Classic Gold source patch' } = {}) {
  console.error(`✗ ${label} is a retired source-patch path.`)
  console.error('  It cannot coexist safely with the Hermes updater.')
  console.error('  Use scripts/migrate-to-plugin.mjs to remove an old patch, run `hermes update`, then run `node install.mjs`.')
  return 1
}
