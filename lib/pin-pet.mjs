import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const PINNED_FILE = 'hermes-classic-gold-pack.pinned.json'

/**
 * Remember the user's preferred pet so a later reinstall can re-activate it
 * without re-prompting. Writes <HERMES_HOME>/hermes-classic-gold-pack.pinned.json.
 *
 * @param {string} home   HERMES_HOME
 * @param {string} slug   pet slug to pin
 * @param {object} [opts]
 * @param {string} [opts.nowIso]  injectable timestamp (tests / deterministic runs)
 * @returns {string} the pinned-file path
 */
export function pinPet(home, slug, { nowIso } = {}) {
  const path = join(home, PINNED_FILE)
  const record = { slug, pinnedAt: nowIso || new Date().toISOString() }
  writeFileSync(path, JSON.stringify(record, null, 2))
  return path
}
