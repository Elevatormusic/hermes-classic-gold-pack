# Update Classic Gold and Hermes safely

A current Classic Gold install is a run-time plug-in under `HERMES_HOME`. A
normal Hermes update does not need to reapply it or rebuild the desktop.

## Select exact targets

Confirm the profile and checkout before any update:

```text
<HERMES_HOME>/desktop-plugins/classic-gold/plugin.js
<HERMES_HOME>/plugins/classic-gold/dashboard/manifest.json
<path-to-hermes-agent>/apps/desktop/
```

Use `--home` for the profile and `--repo` for the checkout. Do not use an
auto-detected path when more than one profile or checkout can match.

## Current run-time install

Run the normal update:

```bash
hermes update
```

The optional guard wrapper checks the exact profile and checkout for known
legacy source-patch markers before it starts the same update:

```bash
node update-hermes.mjs --home "<HERMES_HOME>" --repo "<path-to-hermes-agent>"
```

The wrapper does not patch, rebuild, reinstall, restart, or relaunch Hermes.

## Update the Gold Pack

Update this Pack checkout, preview the same profile, reinstall, and then fully
restart Hermes Desktop:

```bash
git pull --ff-only
node install.mjs --dry-run --home "<HERMES_HOME>" --activate noir-neko-ascii-fine
node install.mjs --home "<HERMES_HOME>" --activate noir-neko-ascii-fine
```

Keep `--home` explicit for an automated install. `--yes` can skip confirmation
for one auto-detected profile, but it cannot select between profiles. The
installer keeps the first pre-install backup for each managed file and refuses
to overwrite a later user edit.

## Existing legacy source-patch install

Do not update while an old TelemetryTape or caduceus source patch is present.
Migration is restore-only. It does not install the new plug-in. Use this exact
order:

```bash
node scripts/migrate-to-plugin.mjs --dry-run --home "<HERMES_HOME>" --repo "<path-to-hermes-agent>"
node scripts/migrate-to-plugin.mjs --home "<HERMES_HOME>" --repo "<path-to-hermes-agent>" --yes
hermes update
node install.mjs --home "<HERMES_HOME>" --activate noir-neko-ascii-fine
```

Then fully quit and start Hermes Desktop. The execution command uses `--yes`
only after review of the dry run. It skips confirmation. It does not resolve an
ambiguous profile or bypass a file safety check.

Migration stops before any write when a source file is missing, user-edited, or
lacks exact same-version ownership proof. If it stops, follow
[`brokenupdatefix.md`](brokenupdatefix.md). Do not use `git reset --hard`, drop an
update stash, or copy an old baseline over current Hermes files.

## Verify after the full restart

1. Confirm that **Classic Gold** is enabled in **Settings > Plugins**.
2. Confirm that **Classic Hermes** is present in **Settings > Appearance**.
3. Compare a full-window screenshot with the repository reference.
4. Open the quick customizer and the full settings page. Confirm that saved
   values remain.
5. Test the model, reasoning, provider, and context controls.
6. Confirm that the active session hides the duplicate composer model selector
   and that a new draft keeps it.
7. Complete one turn and check the prompt-cache hit rate, final-turn rate, and
   session cost. `--` is the correct cache rate without prompt-cache reads and
   the correct cost when Hermes did not record an actual or included value.
8. Check RAM and VRAM. They cover the complete backend host. For a remote
   profile, confirm that the remote backend was also installed and restarted.

If the theme works but all backend values are absent, do a full restart before
you use a renderer reload. A renderer reload cannot mount the Python route.
