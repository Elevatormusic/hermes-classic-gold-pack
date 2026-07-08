# Uninstall — instructions for an AI assistant

Help the user remove the **Hermes "Classic Gold" pack**. A user points their AI
assistant here ("read `ai/uninstall.md`, ask what to remove, follow it").

> **You need shell + file access.** If you can't run commands, give the user the
> exact steps to run themselves. Confirm before deleting anything.

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
