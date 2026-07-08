# Hermes Classic Gold Pack

A drop-in look for the [Hermes agent](https://github.com/NousResearch/hermes-agent):
the **Classic Hermes gold theme** (warm gold borders, cornsilk text, light + dark),
**two Noir Neko pets**, and — for the adventurous — a custom **TelemetryTape
status bar** and optional **caduceus extras** (loader, backdrop, hero wordmark).

The theme and pets install in ~30 seconds and work on any machine. The status
bar and extras edit the desktop app's source, so they're a separate, honest
"advanced" tier (see the caveats below).

## Preview

![Classic Hermes gold theme — dark & light palette](docs/theme-palette.png)

<p>
  <img src="docs/noir-neko-idle.gif" alt="Noir Neko idle animation" height="180">
  &nbsp;&nbsp;&nbsp;
  <img src="docs/noir-neko-ascii-idle.gif" alt="Noir Neko ASCII idle animation" height="180">
</p>

<sub>Left: <b>Noir Neko</b>. Right: <b>Noir Neko ASCII Fine</b>. (Idle animations, shown on the theme's dark background.)</sub>

> **Note on scope:** this pack targets the Hermes *desktop* app. The core
> installer is cross-platform (Windows/macOS/Linux); it has been verified on
> Windows. macOS/Linux path handling is best-effort — issues/PRs welcome.

---

## Requirements

- Hermes installed (the pack finds your `HERMES_HOME` automatically).
- **Node.js** to run the installer — it ships with Hermes (Electron), so you
  already have it.
- For the **advanced** tier only: a Hermes desktop **dev environment**
  (`apps/desktop` with its dependencies installed) and Git.

## Core install (theme + pets)

```bash
git clone https://github.com/Elevatormusic/hermes-classic-gold-pack
cd hermes-classic-gold-pack
node install.mjs --activate noir-neko-ascii-fine
```

- `--activate <slug>` sets that pet active (`noir-neko` or `noir-neko-ascii-fine`).
  **Omit it** to install both pets without touching your current pet.
- `--home <path>` targets a specific `HERMES_HOME` (the folder containing
  `config.yaml`). Without it, the installer auto-detects.

Then install the **theme** (one manual step — there's no theme-import API):
open Hermes Desktop → `Ctrl/Cmd+Shift+I` → **Console** tab → paste the contents
of [`theme/install-theme.js`](theme/install-theme.js) → Enter. It registers and
activates the gold theme (dark mode) and reloads.

Restart Hermes to see the pets and theme.

## What each piece does

| Piece | What it is | How it installs |
|---|---|---|
| **Gold theme** | `hermes-classic-gold` desktop theme (light + dark) | DevTools console paste (localStorage) |
| **Two pets** | `noir-neko`, `noir-neko-ascii-fine` sprite mascots | `node install.mjs` → `HERMES_HOME/pets/` |
| **Status bar** | Custom TelemetryTape HUD (CPU/mem, context, timers) | Source patch + rebuild (advanced) |
| **Caduceus extras** | Caduceus loader, backdrop, hero wordmark | Optional source patch + rebuild (advanced) |

## AI-assisted install (optional)

Prefer to let an AI handle everything — including reconciling the advanced
patches to your Hermes version? Paste [`ai/install.md`](ai/install.md) into an
**agentic** coding assistant (Claude Code, Cursor, Codex CLI — one that can run
shell commands and edit files). It runs the core install, offers the advanced
tiers, and falls back to [`ai/repair.md`](ai/repair.md) if a patch rejects.

It's built to be hands-off: when something fails it **diagnoses itself first** —
reads its own build/patch output and the Hermes logs via
`node scripts/diagnostics.mjs --logs` (errors.log, desktop.log, agent.log,
gateway.log), inspects any `.rej` files, fixes the likely cause, rebuilds, and
re-checks the logs — looping before it bothers you. It only asks you as a **last
resort, once**, and for genuinely visual problems it requests a specific
screenshot (plus the DevTools console) with exact steps. Only if it truly can't
fix it does it hand you a pre-filled issue link to review and submit. Plain chat
assistants (no tools) instead hand you the exact commands.

## Advanced: status bar + caduceus extras

These edit Hermes desktop **source** and rebuild the app. Read
[`advanced/README.md`](advanced/README.md) first. Three caveats up front:

1. **Needs the desktop dev env + Node** (`apps/desktop` deps installed, Hermes
   fully quit for the build).
2. **A Hermes app update reverts them** — you'll re-apply after updates.
3. **Version-specific**: patches are generated against
   `NousResearch/hermes-agent@8301654`. On a different version they may reject;
   the scripts fall back to full-file copies, and `ai/repair.md` can reconcile
   the rest.

```bash
# status bar
node advanced/statusbar/apply-statusbar.mjs --repo "<path-to>/hermes-agent"
# optional caduceus extras
node advanced/extras-caduceus/apply-caduceus.mjs --repo "<path-to>/hermes-agent"
```

## Uninstall / revert

- **Theme** — pick another theme in Appearance, or in the DevTools console:
  `localStorage.setItem('hermes-desktop-theme-v2','nous');location.reload()`.
- **Pets** — delete `HERMES_HOME/pets/<slug>`. (Don't use the in-app "remove" on
  a pet the desktop already adopted — just delete/overwrite the folder.) Restore
  your active pet in `config.yaml` (a `config.yaml.bak` was written if you used
  `--activate`).
- **Status bar / extras** — restore the `*.orig` backups the apply scripts made,
  then `cd apps/desktop && npm run pack` (Hermes quit) and relaunch.

## Reporting problems

Run `node scripts/diagnostics.mjs` and open the pre-filled issue URL it prints
(or use **Issues → New → "Install failure"**). Review before submitting — the
issue body includes your OS, Node version, and Hermes commit, nothing else. Add
`--logs` to also print recent Hermes log tails locally for diagnosis (those are
**not** put in the issue URL — share them only if you choose, after reviewing).

## Credits & license

Theme, pets, and status bar by **Shaya (Elevatormusic)**. Built for the Hermes
agent by Nous Research. Released under the [MIT License](LICENSE).
