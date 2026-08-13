---
name: Classic Gold failure
about: Report an install, run-time, migration, or removal problem
title: "Classic Gold: <short symptom>"
labels: install-failure
---

## What failed
<!-- One short paragraph. Do not paste raw logs, secrets, prompts, or local paths. -->

## Area
<!-- installer | renderer plug-in | telemetry backend | theme and settings | pets | legacy migration | uninstall -->

## Exact flow
<!-- Include the dry run, command, full restart, and minimal reproduction. Redact HERMES_HOME and repo paths. -->

## Environment
<!-- Use the prefilled issue URL from: node scripts/diagnostics.mjs. It redacts HERMES_HOME. -->
<!-- Include Pack version, Hermes version and commit, operating system, Node version, and local or remote backend. -->

## Telemetry state
<!-- actual | included | unknown | not applicable; nvidia-smi result; RAM and VRAM are host-wide -->

## Interaction check
<!-- Which model, reasoning, provider, context, customizer, and duplicate-selector checks passed or failed? -->

## Screenshots
<!-- Add a redacted initial full-window screenshot and a redacted failure screenshot. -->

## Safe recovery tried
<!-- Full restart, renderer reload, reinstall, or restore-only migration. Do not apply a legacy source patch. -->
