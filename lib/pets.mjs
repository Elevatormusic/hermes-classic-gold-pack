import { cpSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Copy one pet folder (pet.json + spritesheet.*) into HERMES_HOME/pets/<slug>/.
 * @returns {string} the destination directory
 */
export function installPet(srcDir, petsDir, slug) {
  const dest = join(petsDir, slug)
  mkdirSync(dest, { recursive: true })
  cpSync(srcDir, dest, { recursive: true })
  return dest
}

/**
 * Copy every bundled pet folder into HERMES_HOME/pets/ and clear stale
 * thumbnails so overwritten sprites re-render. Idempotent.
 * @returns {string[]} installed slugs (the bundled folder names)
 */
export function installPets(bundledPetsDir, petsDir) {
  mkdirSync(petsDir, { recursive: true })
  const slugs = readdirSync(bundledPetsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
  for (const slug of slugs) installPet(join(bundledPetsDir, slug), petsDir, slug)
  const thumbs = join(petsDir, '.thumbs')
  if (existsSync(thumbs)) {
    try {
      rmSync(thumbs, { recursive: true, force: true })
    } catch {
      // best-effort: a locked thumb dir shouldn't fail the install
    }
  }
  return slugs
}
