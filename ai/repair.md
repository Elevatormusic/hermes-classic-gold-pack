# Remove an unsafe legacy source patch

Use this guide only when restore-only migration stops because it cannot prove a
safe automatic restore. This is a removal procedure. Do not port, reapply, or
rebuild the old status-bar or caduceus source patch.

For a normal run-time plug-in problem, use the troubleshooting table in
`README.md`. Do not edit the Hermes checkout.

## Goal

Return only proved Classic Gold source edits to the current Hermes `HEAD`
content while you preserve all unrelated user changes, index state, and stashes.
Then use the current run-time plug-in architecture.

## Evidence first

1. Identify the exact profile and checkout. Record:

   ```bash
   git -C "<path-to-hermes-agent>" status --short --branch
   git -C "<path-to-hermes-agent>" rev-parse HEAD
   git -C "<path-to-hermes-agent>" diff --cached --name-status
   git -C "<path-to-hermes-agent>" stash list
   ```

2. Run the migration dry run with both explicit paths:

   ```bash
   node scripts/migrate-to-plugin.mjs --dry-run --home "<HERMES_HOME>" --repo "<path-to-hermes-agent>"
   ```

3. Read `HERMES_HOME/hermes-classic-gold-pack.manifest.json`. For each reported
   file, identify the recorded method, Hermes `HEAD`, original path, and
   installed hash or blob hash.
4. Compare three versions of each file:

   - the current worktree file;
   - the same path at current `HEAD`;
   - the matching Pack legacy payload under `advanced/`, if one exists.

Do not treat a similar file, a stale `.orig`, or a baseline version name as
ownership proof.

## Removal rules

- If the current file exactly matches a known Pack payload and `.orig` exactly
  matches the same path at current `HEAD`, let migration restore it.
- If the current file includes both Pack hunks and later user edits, save the
  proved user hunks in a separate reviewed patch or copy outside the checkout.
  Automatic migration requires the live target to match the recorded or
  bundled Pack-installed blob. After a manual cleanup makes the live file equal
  to current `HEAD`, that file needs no automatic restore.
- If the current file was deleted, do not recreate it until you prove that the
  deletion was accidental and the user approves the restore.
- If a conflict includes an updater stash, do not drop or clear the stash.
- Do not replace a complete current file with an old baseline file.
- Do not use `git reset --hard`, `git checkout -- .`, or a broad `git restore`.
- Show the proposed per-file diff to the user before you write a manual repair.

If exact hunk ownership is not clear, stop and report the file as blocked. A
wrong restore can erase user work.

For a mixed file, show the saved user-only patch and its destination to the
user. After approval, restore only that exact target to current `HEAD`. Run
migration and the Hermes update. Then replay the user-only patch against the new
source and review the result. Do not use a broad restore command.

## Complete the migration

After manual removal, rerun the dry run. Continue only when it has no unsafe
file:

```bash
node scripts/migrate-to-plugin.mjs --dry-run --home "<HERMES_HOME>" --repo "<path-to-hermes-agent>"
node scripts/migrate-to-plugin.mjs --home "<HERMES_HOME>" --repo "<path-to-hermes-agent>" --yes
hermes update
node install.mjs --home "<HERMES_HOME>"
```

Then fully quit and start Hermes Desktop. Do not install the renderer or backend
before the clean Hermes update finishes.

## Verify

- `git status` shows only user-intended changes.
- No known Classic Gold source marker remains.
- The renderer and backend are under the exact `HERMES_HOME`.
- **Classic Gold** is enabled in **Settings > Plugins**.
- The first-start screenshot and interaction checklist in `README.md` passes.

Do not create a new legacy baseline as part of this repair. The supported result
is the run-time plug-in, not another source-patched Hermes build.
