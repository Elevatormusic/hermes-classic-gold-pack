# Hermes Classic Gold Pack

![Hermes desktop running the Classic Gold theme — caduceus wordmark & backdrop, custom TelemetryTape status bar, and the Noir Neko ASCII pet](docs/hermes-classic-gold.png)

A drop-in look for the [Hermes agent](https://github.com/NousResearch/hermes-agent):
the **Classic Hermes gold theme** (warm gold borders, cornsilk text, light + dark),
**two Noir Neko pets**, and — for the adventurous — a custom **TelemetryTape
status bar** and optional **caduceus extras** (loader, backdrop, hero wordmark).

The theme and pets install in ~30 seconds and work on any machine. The status
bar and extras edit the desktop app's source, so they're a separate, honest
"advanced" tier (see the caveats below).

## What's inside

The screenshot above is the real desktop with **everything applied**. Here's each
piece on its own.

### 🎨 Theme — gold & kawaii

![Classic Hermes gold theme — dark & light palette](docs/theme-palette.png)

The `hermes-classic-gold` desktop theme — warm gold borders, cornsilk text, in
both **light and dark**. Installs via a one-time DevTools console paste
(localStorage), so it needs no rebuild and works on any Hermes version.

### 📊 Status bar — TelemetryTape HUD

![Custom TelemetryTape status bar](docs/status-bar.png)

A compact heads-up display along the bottom edge. Left → right:

- **workspace** (`HERMES-AGENT`) · **agent state** (`[IDLE]`)
- **active model** (`qwen3.6-35b-a3b-mtp ⌄`) · **reasoning effort** (`◆`) · **provider** (`⌂ LM Studio`)
- **tokens + context-usage bar** (`0tok [▨▨] 00%`)
- **throughput** (`⚡ --/s`) · **cost** (`$ --`) · **turn timer** (`⊙ --`)
- **live system resources** — GPU **VRAM** (`21.5/24G`) and system **RAM** (`42.5/63G`)

This is an *advanced* piece (a source patch + rebuild — see [`advanced/`](advanced/README.md)).

### 🌀 Background & loader — caduceus

![Caduceus dotted backdrop behind the HERMES-AGENT wordmark](docs/caduceus-backdrop.png)

The optional *caduceus extras*: a dotted-caduceus **backdrop** filling the empty
state behind the gold "HERMES-AGENT" wordmark, plus a caduceus **loader** — two
entwined sine-snakes that animate as a gold particle trail while Hermes is working
(replacing the stock rose-curve spinner). Advanced piece.

### 🐾 Pets — Noir Neko

<p>
  <img src="docs/noir-neko-idle.gif" alt="Noir Neko idle animation" height="180">
  &nbsp;&nbsp;&nbsp;
  <img src="docs/noir-neko-ascii-idle.gif" alt="Noir Neko ASCII idle animation" height="180">
</p>

<sub>Left: <b>Noir Neko</b>. Right: <b>Noir Neko ASCII Fine</b>. (Idle animations, shown on the theme's dark background.) Installed by <code>node install.mjs</code>.</sub>

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

## Install with an AI agent (recommended)

Copy the prompt below and paste it into an **agentic** coding assistant that can
run shell commands and edit files — **Claude Code, Cursor, or Codex CLI**. It
fetches the repo and does everything itself; you don't open or paste any file.

```text
You have shell + file access. Install the Hermes "Classic Gold" pack on my machine.

1. Clone https://github.com/Elevatormusic/hermes-classic-gold-pack and cd into it.
2. Core (theme + pets): run  node install.mjs --activate noir-neko-ascii-fine
   Then tell me the one manual theme step: open Hermes Desktop -> Ctrl/Cmd+Shift+I
   -> Console tab -> paste the contents of theme/install-theme.js -> Enter.
3. Ask me whether I also want the custom status bar and/or the caduceus extras.
   If yes, run the matching script in advanced/ (Hermes must be FULLY quit for the
   build): advanced/statusbar/apply-statusbar.mjs and/or
   advanced/extras-caduceus/apply-caduceus.mjs.
4. If anything fails, DIAGNOSE YOURSELF FIRST: read the failing command's output
   and run  node scripts/diagnostics.mjs --logs  (reads errors.log, desktop.log,
   agent.log, gateway.log); check any .rej files; fix the likely cause; rebuild;
   re-check the logs. Follow ai/install.md and ai/repair.md for the full self-heal
   protocol. Only ask me as a LAST RESORT, once — and for a visual-only problem,
   ask for a screenshot plus the DevTools console (Ctrl/Cmd+Shift+I -> Console).

Rules: back up before overwriting; confirm before editing config.yaml or applying
a patch; never run `npm run pack` while Hermes is open.
```

That's the whole install — it clones the repo, sets up the theme + pets, and
(with your OK) the advanced tiers, diagnosing from the Hermes logs on its own if
something breaks. A plain chat assistant with no tools can't run it — use the
manual steps below instead.

## Manual install (theme + pets)

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
