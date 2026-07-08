#!/usr/bin/env node
// apply-caduceus.mjs — apply the optional caduceus extras (caduceus loader,
// backdrop, hero wordmark) to a hermes-agent checkout, then rebuild.
//
//   node apply-caduceus.mjs [--repo <path-to-hermes-agent>] [--no-build]
//
// Independent of the status bar patch — apply either or both. Tries `git apply`
// (3-way) against the shipped patch; on reject, copies the full post-edit files.
// Backs up each target to <file>.orig first. Refuses to build while Hermes is
// running (Windows); pass --no-build to stage files only.
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyTier } from '../apply-common.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
process.exit(applyTier({ scriptDir: HERE, patchName: 'hermes-caduceus.patch', tier: 'caduceus', label: 'Caduceus extras' }))
