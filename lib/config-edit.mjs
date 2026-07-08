/**
 * Set `display.pet.slug` + `display.pet.enabled: true` in a Hermes config.yaml,
 * preserving every other line, comment, and the file's EOL style. Pure.
 *
 * A targeted line edit — NOT a full YAML re-serialize — so we never reorder keys
 * or drop comments. Throws if the `display:` or nested `pet:` block is absent.
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

  let petIdx = -1
  for (let i = displayIdx + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break // dedented out of the display block
    if (/^\s+pet:\s*$/.test(lines[i])) {
      petIdx = i
      break
    }
  }
  if (petIdx === -1) throw new Error('config.yaml has no "display.pet:" block')

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

  const childIndent = ' '.repeat(petIndent + 2)
  const inserts = []
  if (!enabledDone) inserts.push(`${childIndent}enabled: true`)
  if (!slugDone) inserts.push(`${childIndent}slug: ${slug}`)
  if (inserts.length) lines.splice(petIdx + 1, 0, ...inserts)

  return lines.join(eol)
}
