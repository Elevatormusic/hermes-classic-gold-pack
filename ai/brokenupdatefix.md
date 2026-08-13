# Recover from a legacy Classic Gold update conflict

Current Hermes can preserve local checkout changes through an update. The old
Classic Gold installer changed Hermes source. When the updater restores those
changes on a new source version, git or the desktop build can fail.

## Safety rules

- Keep the user's stash and unrelated local changes.
- Do not run `git reset --hard`.
- Do not drop or clear a stash.
- Do not copy old baseline files over a new Hermes version.
- Do not apply a legacy patch as a repair.
- Record the exact `HERMES_HOME`, checkout path, branch, `HEAD`, worktree state,
  index state, and stash list before repair.

## Recovery sequence

1. Stop any repeated update or rebuild loop.
2. In the exact Hermes checkout, collect read-only evidence:

   ```bash
   git status --short --branch
   git rev-parse HEAD
   git diff --cached --name-status
   git stash list
   git diff --name-only --diff-filter=U
   ```

3. Run the restore-only migration as a plan:

   ```bash
   node scripts/migrate-to-plugin.mjs --dry-run --home "<HERMES_HOME>" --repo "<path-to-hermes-agent>"
   ```

4. Continue only when the plan reports safe, exact ownership proof. Use this
   order without inserting a plug-in install before the update:

   ```bash
   node scripts/migrate-to-plugin.mjs --home "<HERMES_HOME>" --repo "<path-to-hermes-agent>" --yes
   hermes update
   node install.mjs --home "<HERMES_HOME>"
   ```

5. Fully quit and start Hermes Desktop. A renderer reload cannot load the new
   backend route.
6. If migration reports an unsafe file, stop. Follow
   [`repair.md`](repair.md). That guide removes only proved Classic Gold hunks.
   It does not port or reapply the old patch.

The execution command uses `--yes` only after review of the dry-run plan. It
skips confirmation. It does not resolve an ambiguous profile and does not make
an unsafe file safe.

## Common states

| State | Action |
|---|---|
| Update has not started; exact receipt and `.orig` proofs pass | Run migration, update, install, and fully restart. |
| Updater created a stash but did not change `HEAD` | Keep the stash. Run migration only when the exact plan is safe. |
| `HEAD` changed and stash restore has conflicts | Do not run automatic migration. Resolve only proved Gold hunks and keep unrelated changes. |
| A current Pack target file was deleted | Stop. Migration must not recreate it. Inspect the deletion and use `repair.md`. |
| A current Pack target file has user edits | Stop. Preserve the user-only hunks outside the checkout, restore the exact target to `HEAD` with approval, then replay the user hunks after update. |
| No manifest exists | Use a trusted checkout and the removal-only `repair.md` process. Do not use an old full-file baseline. |
| Source is clean but Gold UI is absent | Run the current installer against the exact `HERMES_HOME`, then fully restart. |
| Theme works but RAM, VRAM, and cost are absent | Confirm the backend files and config entry, then fully restart the correct backend host. |

## Verify the recovered state

After recovery, `git status` must contain only changes that the user intends to
keep. Confirm the renderer and backend paths under the exact `HERMES_HOME`.
Then use the first-start screenshot and interaction checklist in `README.md`.

Unknown telemetry can be correct. Speed appears only after a completed turn.
Cost appears only for an actual or included Hermes cost record. RAM and VRAM
cover the complete backend host. If the profile is remote, install and restart
that remote backend before you test these fields.
