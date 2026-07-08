import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installPets } from '../lib/pets.mjs'

test('copies each pet folder and clears stale thumbs', () => {
  const root = mkdtempSync(join(tmpdir(), 'hcgp-'))
  const bundled = join(root, 'bundled')
  const petsDir = join(root, 'HERMES', 'pets')
  mkdirSync(join(bundled, 'noir-neko'), { recursive: true })
  writeFileSync(join(bundled, 'noir-neko', 'pet.json'), '{"id":"noir-neko"}')
  writeFileSync(join(bundled, 'noir-neko', 'spritesheet.webp'), 'PNGDATA')
  mkdirSync(join(petsDir, '.thumbs'), { recursive: true })
  writeFileSync(join(petsDir, '.thumbs', 'stale.png'), 'x')

  const slugs = installPets(bundled, petsDir)

  assert.deepEqual(slugs, ['noir-neko'])
  assert.equal(readFileSync(join(petsDir, 'noir-neko', 'pet.json'), 'utf8'), '{"id":"noir-neko"}')
  assert.equal(existsSync(join(petsDir, 'noir-neko', 'spritesheet.webp')), true)
  assert.equal(existsSync(join(petsDir, '.thumbs')), false)
})
