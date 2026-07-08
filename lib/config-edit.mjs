/**
 * Set `display.pet.slug` + `display.pet.enabled: true` in a Hermes config.yaml,
 * preserving every other line, comment, and the file's EOL style. Pure.
 *
 * A targeted line edit — NOT a full YAML re-serialize — so we never reorder keys
 * or drop comments.
 *
 * - No `display:` block at all → throws (that's a malformed Hermes config).
 * - `display:` exists but has no `pet:` child (a fresh Hermes where no pet was
 *   ever adopted in-app) → creates the `pet:` block as the first child of
 *   `display:`. (Previously this threw, which broke `install.mjs --activate` on
 *   clean configs — see issue #1.)
 *
 * @param {string} text  full config.yaml contents
 * @param {string} slug  pet slug to activate
 * @returns {string} updated text
 */
export function activatePetInConfig(text, slug) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)

  const displayIdx = lines.findIndex((l) => /^display:\s*$/.test(l))
  if (displayIdx === -1) throw new Error('config.yaml has no top-level "display:" block')

  // Indent used by display's children (default 2 spaces if it currently has none).
  let childIndent = 2
  for (let i = displayIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue
    if (/^\S/.test(lines[i])) break // display has no children
    childIndent = lines[i].match(/^(\s*)/)[1].length
    break
  }

  // Find pet: nested under display:.
  let petIdx = -1
  for (let i = displayIdx + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break // dedented out of the display block
    if (/^\s+pet:\s*$/.test(lines[i])) {
      petIdx = i
      break
    }
  }

  // No pet block → create one as the first child of display:.
  if (petIdx === -1) {
    const pad = ' '.repeat(childIndent)
    const kid = ' '.repeat(childIndent + 2)
    lines.splice(displayIdx + 1, 0, `${pad}pet:`, `${kid}enabled: true`, `${kid}slug: ${slug}`)
    return lines.join(eol)
  }

  // pet block exists → set slug + enabled among its children.
  const petIndent = lines[petIdx].match(/^(\s*)/)[1].length
  let slugDone = false
  let enabledDone = false
  for (let i = petIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue
    const ind = lines[i].match(/^(\s*)/)[1].length
    if (ind <= petIndent) break // left the pet block
    if (/^\s+slug:/.test(lines[i])) {
      lines[i] = lines[i].replace(/slug:.*/, `slug: ${slug}`)
      slugDone = true
    } else if (/^\s+enabled:/.test(lines[i])) {
      lines[i] = lines[i].replace(/enabled:.*/, 'enabled: true')
      enabledDone = true
    }
  }

  const kidPad = ' '.repeat(petIndent + 2)
  const inserts = []
  if (!enabledDone) inserts.push(`${kidPad}enabled: true`)
  if (!slugDone) inserts.push(`${kidPad}slug: ${slug}`)
  if (inserts.length) lines.splice(petIdx + 1, 0, ...inserts)

  return lines.join(eol)
}
