# Uninstall Classic Gold

Use the recorded change manifest and an explicit profile. Preview all changes:

```bash
node scripts/uninstall.mjs --dry-run --home "<HERMES_HOME>"
node scripts/uninstall.mjs --home "<HERMES_HOME>" --yes
node scripts/uninstall.mjs --home "<HERMES_HOME>" --theme-cleaned --yes
```

If the current stamp or dry-run plan reports an active legacy source tier, also
pass the exact Hermes checkout:

```bash
node scripts/uninstall.mjs --dry-run --home "<HERMES_HOME>" --repo "<path-to-hermes-agent>"
```

Ask the user to confirm the dry-run target and plan before the removal command.
The execution command uses `--yes` only after this review. The uninstaller
refuses an ambiguous profile instead of using `--yes` to select one.

## What removal can reverse

The uninstaller:

- removes or restores the recorded renderer file only when its hash matches the
  installed receipt;
- removes or restores the three recorded backend files with the same check;
- restores only the recorded `classic-gold` membership in `plugins.enabled` and
  `plugins.disabled` when the current state still matches the install state;
- removes or restores each current-format pet file only when its live hash
  matches the receipt;
- refuses automatic removal for an old directory-only pet receipt because it
  cannot prove ownership of each file;
- restores only the recorded `display.pet` block when the user did not change
  that block after install;
- restores a prior managed file only after it verifies the backup hash;
- prints an ownership-checked theme-revert command;
- restores legacy source files only from safe, same-version `.orig` backups.

It does not restore a legacy full `config.yaml` backup because that could erase
later user settings. It leaves a changed or unproved item in place and keeps its
stamp for a safe retry. It keeps the append-only manifest as history.

For a legacy source file, the uninstaller requires the recorded installed git
blob. The live file must match that blob, and `.orig` must match the same path
at current `HEAD`. It leaves an edited, deleted, cross-version, or unproved file
in place.

Paste the printed theme-revert command in the Hermes DevTools console. It
removes the owned Classic Gold mirror only when its stored value still matches
the ownership snapshot. A run-time install stops when Classic Gold is still
selected. Select another theme first, then run the printed command again. A
legacy theme receipt restores only its recorded prior theme and mode. The
command keeps a later user theme choice. Run the final `--theme-cleaned`
command only after the renderer command reloads Hermes. This confirmation
clears the renderer ownership stamp. Then fully quit and start Hermes Desktop
to unload the Python backend.

## Customizer values

Customizer values are in the plug-in SDK's private, namespaced storage. The
file uninstaller cannot delete that record. Use **Reset to original** before
removal if you do not want the custom values to return after a later reinstall.
Disabling or removing the renderer stops all of its visual effects.

## Remote backend

When the renderer uses a backend on another host, run the same dry-run and
removal commands on both exact profiles. Remove the local renderer install and
the remote backend install. Restart the remote Hermes backend or gateway, and
then fully restart Hermes Desktop.

## Old install with no manifest

Do not use a broad recursive removal. First prove that each exact path belongs
to this Pack. The known paths are:

```text
HERMES_HOME/desktop-plugins/classic-gold/plugin.js
HERMES_HOME/plugins/classic-gold/dashboard/manifest.json
HERMES_HOME/plugins/classic-gold/dashboard/plugin_api.py
HERMES_HOME/plugins/classic-gold/dashboard/dist/index.js
HERMES_HOME/pets/noir-neko/
HERMES_HOME/pets/noir-neko-ascii-fine/
```

Remove only the `classic-gold` entry from `plugins.enabled` and
`plugins.disabled`. Select another theme in **Settings > Appearance**. If a pet
is active, select another installed pet or disable it in **Settings > Pet**.

Do not delete a full `desktop-plugins`, `plugins`, `pets`, or `HERMES_HOME`
directory. An old source-patched checkout needs the restore-only procedure in
[`brokenupdatefix.md`](brokenupdatefix.md), not a blind file copy.
