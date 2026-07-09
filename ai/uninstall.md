# Uninstall — instructions for an AI assistant

Help the user remove the **Hermes "Classic Gold" pack**. A user points their AI
assistant here ("read `ai/uninstall.md`, ask what to remove, follow it").

> **You need shell + file access.** If you can't run commands, give the user the
> exact steps to run themselves. Confirm before deleting anything.

> **Brief the user first.** For each part they choose, say in one line what you'll
> do and that it's reversible (e.g. "I'll delete the two pet folders and restore
> your previous pet from the backup") — then do it and report what changed. Don't
> make them guess.

## Fastest path — the automated uninstaller

For any normal pack install there's a change manifest, so prefer:

```bash
node scripts/uninstall.mjs --dry-run    # preview the plan, change nothing
node scripts/uninstall.mjs              # do it (asks to confirm; --yes to skip)
```

It reverses the install from the recorded manifest — restoring **your real prior
theme + mode, pet, and config.yaml** (not a hardcoded default), deleting only pets
the pack added (keeping any you already had), and rebuilding after restoring source
files. For safety it auto-restores a source file **only** from a same-version
`.orig` backup; anything applied by full-copy/reconcile or against a different
Hermes version is left alone and flagged for `ai/repair.md`. Theme is localStorage,
so it prints the exact one-line revert snippet to paste. Run
`node scripts/diagnostics.mjs status` first to see what's currently installed.

The manual steps below are the fallback for older installs that predate the manifest.

## Step 1 — Ask what to remove

Ask the user which parts to uninstall (they may pick more than one):

- **Theme** — the gold colors
- **Pets** — Noir Neko (both variants)
- **Status bar** — the advanced TelemetryTape HUD
- **Caduceus extras** — the advanced backdrop / loader / wordmark
- **Everything**

Only touch what they choose.

## Step 2 — Remove the chosen parts

### Theme
Simplest: tell the user to open Hermes → **Appearance** → pick any other theme.
Or revert instantly in the DevTools console (`Ctrl/Cmd+Shift+I` → Console):

```js
localStorage.setItem('hermes-desktop-theme-v2','nous');location.reload()
```

To also delete the stored theme, remove the `hermes-classic-gold` entry from the
`hermes-desktop-user-themes-v1` localStorage key.

### Pets
Find **HERMES_HOME** — the folder that contains `config.yaml` (Windows
`%LOCALAPPDATA%\hermes`, macOS `~/Library/Application Support/hermes`, Linux
`~/.local/share/hermes` or `~/.hermes`). Then:

- Delete the folders `HERMES_HOME/pets/noir-neko` and
  `HERMES_HOME/pets/noir-neko-ascii-fine`.
- Do **not** use the in-app "remove" on a pet the desktop already adopted (it
  errors) — just delete the folder.
- If one of these was the active pet, restore the previous one: a backup was saved
  as `HERMES_HOME/config.yaml.bak` when it was activated. Restore that, or edit
  `config.yaml` → `display.pet.slug` to another installed pet (or set
  `display.pet.enabled: false`).
- Delete stale thumbnails: `HERMES_HOME/pets/.thumbs/`.

### Status bar and/or Caduceus extras (advanced)
The apply scripts saved a backup of every file they touched as `<file>.orig` in
the `hermes-agent` checkout. To revert:

1. Restore each touched file — overwrite it with its `.orig` backup
   (`mv <file>.orig <file>`). The exact files are the ones under
   `advanced/statusbar/files/…` and `advanced/extras-caduceus/files/…` in this
   repo (same relative paths inside `hermes-agent`).
2. Rebuild with Hermes **fully quit**: `cd apps/desktop && npm run pack`.
3. Relaunch Hermes.

(A Hermes app update also reverts these automatically.)

## Step 3 — Confirm
Tell the user exactly what you removed, and that restarting Hermes finalizes it.
