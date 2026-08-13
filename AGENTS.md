# hermes-classic-gold-pack - Agent guide

Use this guide when you change this repository. The supported installer puts a
renderer plug-in, a telemetry backend, and optional Noir Neko pets in a real
Hermes profile. It does not change the Hermes source checkout. The files under
`advanced/` are legacy migration evidence. Because this code writes to a live
profile, the main rule is: **do not harm the user's existing setup**.

## Repository shape

- Pack commands use Node ESM and require Node.js 18 or later.
- The renderer source is `desktop-plugin/classic-gold/plugin.js`.
- The backend source is `backend/classic-gold/`.
- Managed state is in the Pack stamp and append-only manifest under
  `HERMES_HOME`.
- Legacy source-patch data is under `advanced/`. Do not present it as the
  normal install path.

## Build, test, and lint

- Run `npm test` for the Node test suite.
- Run `python -m unittest -v test.test_plugin_api` with the Hermes managed
  Python environment for the telemetry backend.
- Run `node --check` on changed JavaScript files.
- The supported Pack path has no build step and does not run `npm run pack` in
  the Hermes checkout.
- CI uses Super-Linter for secrets, JavaScript, YAML, actions, shell, JSON, and
  Markdown checks.

## Code conventions

- Use ESM in Pack code. The old `.cjs` files under `advanced/` are payloads.
- Use dependency injection for reads and time where a pure test needs it.
  Write paths use real temporary profiles in tests. Do not inject file writers.
- Add JSDoc types to exported functions.
- Treat a corrupt state file as absent. Do not fail while reading diagnostics.
- Use `node:path`. Do not hard-code platform separators.
- Use ASD-STE100 Simplified Technical English in comments and documentation.

## Safety invariants

1. **Record intent before every managed write.** Append a planned receipt before
   you create a directory, temporary file, backup, or target under
   `HERMES_HOME` or a Hermes checkout.
2. **Complete or roll back each transaction.** After hash verification, append
   a completed receipt and write a component stamp with the same transaction
   ID. On failure, restore prior bytes, remove Pack-created temporary files and
   empty directories, and append a rolled-back receipt.
3. **Use current ownership only.** Reinstall and removal must bind receipts to
   the active component stamp. Historical rows in the append-only manifest do
   not prove current ownership.
4. **Protect user changes.** Require an exact current hash before replacement
   or removal. Require the recorded hash before you restore a backup. If a file
   or config membership changed later, keep it, return a nonzero result, and
   keep the component stamp for a safe retry.
5. **Never guess an ambiguous target.** An explicit `--home` or `--repo` is
   authoritative. If auto-detection finds more than one profile, refuse the
   write. `--yes` must not select the first profile.
6. **Use targeted config edits.** Do not restore a full old `config.yaml` during
   normal removal. Change only owned plug-in membership or the recorded
   `display.pet` block. Fail closed on an unsupported YAML shape.
7. **Keep the supported and legacy paths separate.** The run-time plug-ins and
   old source tiers must not be active together. Migration restores the old
   source, then Hermes updates, then the supported Pack installs.
8. **Do not delete broad directories.** Removal consumes exact active receipts.
   Never remove all of `HERMES_HOME`, `desktop-plugins`, `plugins`, or `pets`.

## Review priorities

- **P0:** A write happens before its planned receipt, or failure can leave an
  unrecorded target, backup, temporary file, or directory.
- **P0:** A command writes to an ambiguous or different profile or checkout.
- **P0:** A secret or a real user-specific path enters the repository.
- **P1:** Reinstall or removal trusts history without an active stamp and
  transaction ID.
- **P1:** A current file, backup, or config value is changed without an exact
  ownership check.
- **P1:** The renderer and backend, or the supported and legacy paths, can get
  out of sync without a clear restart or migration instruction.
- **P1:** A bug fix lacks a focused test, including a failure or rollback test
  for a write-path bug.
- **P1:** Shared code has a platform-specific path assumption.
- **P2:** ESM, JSDoc, documentation, or style does not follow this guide.

Keep reviews focused on P0 and P1 issues. Report exact evidence and the smallest
safe fix.
