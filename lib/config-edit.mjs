function isTrivia(line) {
  const trimmed = line.trim()
  return trimmed === '' || trimmed.startsWith('#')
}

function lineIndent(line) {
  if (/^ *\t/.test(line)) throw new Error('config.yaml uses a tab for indentation')
  return line.match(/^ */)?.[0].length || 0
}

function mappingLine(line) {
  const indent = lineIndent(line)
  const match = /^([ ]*)([A-Za-z_][A-Za-z0-9_-]*)([ ]*:[ ]*)(.*)$/.exec(line)
  if (!match) return null
  return {
    indent,
    key: match[2],
    prefix: `${match[1]}${match[2]}${match[3]}`,
    rawValue: match[4],
  }
}

function scalarParts(rawValue) {
  let quote = null
  let escaped = false
  let commentAt = -1
  for (let index = 0; index < rawValue.length; index += 1) {
    const char = rawValue[index]
    if (quote === '"') {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quote = null
      continue
    }
    if (quote === "'") {
      if (char === "'" && rawValue[index + 1] === "'") index += 1
      else if (char === "'") quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#' && (index === 0 || /\s/.test(rawValue[index - 1]))) {
      commentAt = index
      break
    }
  }
  if (quote !== null) throw new Error('config.yaml has an unterminated quoted scalar')

  const beforeComment = commentAt < 0 ? rawValue : rawValue.slice(0, commentAt)
  const value = beforeComment.trimEnd()
  return { suffix: rawValue.slice(value.length), value }
}

function hasEmptyValue(entry) {
  return scalarParts(entry.rawValue).value === ''
}

function requireScalar(entry, label) {
  const parts = scalarParts(entry.rawValue)
  const value = parts.value.trimStart()
  if (value === '' || /^[|>{[]/.test(value)) {
    throw new Error(`config.yaml ${label} must be a direct scalar value`)
  }
  return parts
}

function findDisplay(lines) {
  const matches = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (isTrivia(line) || lineIndent(line) !== 0) continue
    const entry = mappingLine(line)
    if (entry?.key === 'display') {
      matches.push({ entry, index })
    } else if (/^(?:"display"|'display')\s*:/.test(line)) {
      matches.push({ entry: null, index })
    }
  }
  if (matches.length === 0) throw new Error('config.yaml has no top-level "display:" block')
  if (matches.length > 1) throw new Error('config.yaml has duplicate top-level "display:" blocks')
  if (!matches[0].entry) throw new Error('config.yaml has an unsupported top-level display key')
  if (!hasEmptyValue(matches[0].entry)) {
    throw new Error('config.yaml "display:" must be a mapping block')
  }
  return matches[0].index
}

function displayEnd(lines, displayIndex) {
  for (let index = displayIndex + 1; index < lines.length; index += 1) {
    if (isTrivia(lines[index])) continue
    if (lineIndent(lines[index]) === 0) return index
  }
  return lines.length
}

function validateDisplayShape(lines, start, end, childIndent) {
  const levels = [childIndent]
  let previous = null
  for (let index = start; index < end; index += 1) {
    const line = lines[index]
    if (isTrivia(line)) continue
    const indent = lineIndent(line)
    const entry = mappingLine(line)
    if (!entry) throw new Error('config.yaml has an unsupported display mapping line')

    while (levels.length > 1 && indent < levels.at(-1)) levels.pop()
    const current = levels.at(-1)
    if (indent > current) {
      if (!previous || !hasEmptyValue(previous) || indent !== current + childIndent) {
        throw new Error('config.yaml has ambiguous indentation under "display:"')
      }
      levels.push(indent)
    } else if (indent !== current) {
      throw new Error('config.yaml has ambiguous indentation under "display:"')
    }
    if (entry.key === 'pet' && indent > childIndent) {
      throw new Error('config.yaml has a nested "pet:" key under "display:"')
    }
    previous = entry
  }
}

function petBlockEnd(lines, petIndex, displayBlockEnd, petIndent) {
  let end = displayBlockEnd
  for (let index = petIndex + 1; index < displayBlockEnd; index += 1) {
    const line = lines[index]
    if (isTrivia(line)) continue
    const indent = lineIndent(line)
    if (indent <= petIndent) {
      end = index
      break
    }
  }
  while (end > petIndex + 1) {
    const line = lines[end - 1]
    if (line.trim() === '' || (line.trimStart().startsWith('#') && lineIndent(line) <= petIndent)) {
      end -= 1
      continue
    }
    break
  }
  return end
}

function parsePetConfig(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  for (const line of lines) lineIndent(line)

  const displayIndex = findDisplay(lines)
  const end = displayEnd(lines, displayIndex)
  const material = []
  for (let index = displayIndex + 1; index < end; index += 1) {
    if (!isTrivia(lines[index])) material.push(index)
  }

  const childIndent = material.length > 0
    ? Math.min(...material.map(index => lineIndent(lines[index])))
    : 2
  if (![2, 4].includes(childIndent)) {
    throw new Error('config.yaml has ambiguous indentation under "display:"')
  }
  validateDisplayShape(lines, displayIndex + 1, end, childIndent)

  const pets = material.filter(index => {
    const entry = mappingLine(lines[index])
    return lineIndent(lines[index]) === childIndent && entry?.key === 'pet'
  })
  if (pets.length > 1) throw new Error('config.yaml has duplicate direct "display.pet" blocks')
  if (pets.length === 0) {
    return { childIndent, displayIndex, eol, lines, petEnd: -1, petIndex: -1 }
  }

  const petIndex = pets[0]
  const petEntry = mappingLine(lines[petIndex])
  if (!petEntry || !hasEmptyValue(petEntry)) {
    throw new Error('config.yaml "display.pet" must be a mapping block')
  }

  const petEnd = petBlockEnd(lines, petIndex, end, childIndent)
  const seen = new Set()
  const children = new Map()
  for (let index = petIndex + 1; index < petEnd; index += 1) {
    const line = lines[index]
    if (isTrivia(line)) continue
    const indent = lineIndent(line)
    if (indent !== childIndent * 2) {
      throw new Error('config.yaml "display.pet" accepts direct scalar children only')
    }
    const entry = mappingLine(line)
    if (!entry) throw new Error('config.yaml "display.pet" has an unsupported child')
    const parts = requireScalar(entry, `"display.pet.${entry.key}"`)
    if ((entry.key === 'slug' || entry.key === 'enabled') && seen.has(entry.key)) {
      throw new Error(`config.yaml has duplicate "display.pet.${entry.key}" keys`)
    }
    seen.add(entry.key)
    children.set(entry.key, { entry, index, parts })
  }
  return { childIndent, children, displayIndex, eol, lines, petEnd, petIndex }
}

/**
 * Set display.pet.slug and display.pet.enabled while preserving supported YAML.
 *
 * @param {string} text Full config.yaml contents.
 * @param {string} slug Pet slug to activate.
 * @returns {string} Updated text.
 */
export function activatePetInConfig(text, slug) {
  const parsed = parsePetConfig(text)
  const { childIndent, children, displayIndex, eol, lines, petIndex } = parsed

  if (petIndex < 0) {
    const pad = ' '.repeat(childIndent)
    const kid = ' '.repeat(childIndent * 2)
    lines.splice(displayIndex + 1, 0, `${pad}pet:`, `${kid}enabled: true`, `${kid}slug: ${slug}`)
    return lines.join(eol)
  }

  for (const [key, value] of [['slug', slug], ['enabled', 'true']]) {
    const child = children.get(key)
    if (child) lines[child.index] = `${child.entry.prefix}${value}${child.parts.suffix}`
  }

  const kidPad = ' '.repeat(childIndent * 2)
  const inserts = []
  if (!children.has('enabled')) inserts.push(`${kidPad}enabled: true`)
  if (!children.has('slug')) inserts.push(`${kidPad}slug: ${slug}`)
  if (inserts.length > 0) lines.splice(petIndex + 1, 0, ...inserts)
  return lines.join(eol)
}

/** Return the exact display.pet block, or null when no direct block exists. */
export function petConfigBlock(text) {
  const parsed = parsePetConfig(text)
  return parsed.petIndex < 0
    ? null
    : parsed.lines.slice(parsed.petIndex, parsed.petEnd).join(parsed.eol)
}

/** Replace or remove only display.pet while preserving every other config line. */
export function replacePetConfigBlock(text, replacement) {
  const parsed = parsePetConfig(text)
  const replacementLines = replacement === null ? [] : String(replacement).split(/\r?\n/)

  if (replacementLines.length > 0) {
    const replacementParsed = parsePetConfig(`display:\n${replacementLines.join('\n')}`)
    if (replacementParsed.petIndex < 0 || replacementParsed.childIndent !== parsed.childIndent) {
      throw new Error('replacement display.pet block has incompatible indentation')
    }
    const directEntries = replacementParsed.lines
      .slice(1)
      .filter(line => !isTrivia(line) && lineIndent(line) === replacementParsed.childIndent)
    if (directEntries.length !== 1) {
      throw new Error('replacement must contain only one direct display.pet block')
    }
  }

  if (parsed.petIndex >= 0) {
    parsed.lines.splice(parsed.petIndex, parsed.petEnd - parsed.petIndex, ...replacementLines)
  } else if (replacementLines.length > 0) {
    parsed.lines.splice(parsed.displayIndex + 1, 0, ...replacementLines)
  }
  return parsed.lines.join(parsed.eol)
}
