#!/usr/bin/env node
// apply-statusbar.mjs — apply the custom TelemetryTape status bar to a
// hermes-agent checkout, then rebuild the desktop app.
//
//   node apply-statusbar.mjs [--repo <path-to-hermes-agent>] [--no-build]
//
// Tries `git apply` (3-way) against the shipped patch; if that rejects (you're
// on a different Hermes version), falls back to copying the full post-edit files.
// Backs up each target to <file>.orig first. Refuses to build while Hermes is
// running (Windows); pass --no-build to stage files only.
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyTier } from '../apply-common.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
process.exit(applyTier({ scriptDir: HERE, patchName: 'hermes-statusbar.patch', tier: 'statusbar', label: 'Status bar' }))
