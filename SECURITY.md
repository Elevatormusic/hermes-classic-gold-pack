# Security & what each script does

Short version: this pack only touches **your local Hermes install**. It makes no
telemetry or external network calls, every file it overwrites is backed up first,
and everything is reversible. You (or your AI assistant) can verify each script
below before running it.

## Network

- **None of the scripts phone home.** No analytics, no downloads of executable code.
- The only network activity anywhere in the flow:
  - `git clone` — fetching *this* repo from GitHub (you chose to).
  - `theme/apply-theme.mjs` — talks to a **localhost-only** DevTools port
    (`127.0.0.1`) that it opens on your own machine and **closes immediately**
    after. Nothing is sent off your machine.

## What each script does

| Script | Does | Writes / backups |
|---|---|---|
| `install.mjs` | Copies the two pet folders into `HERMES_HOME/pets/`; with `--activate`, makes a targeted edit to `config.yaml`; prints theme instructions. | Pet files; `config.yaml` (backup: `config.yaml.bak`). No network. |
| `lib/*.mjs` | Pure helpers (path resolution, the config edit, file copy). | — |
| `theme/apply-theme.mjs` | Runs the pack's **own** snippet (`theme/install-theme.js`) in Hermes to set the theme in localStorage. Restarts Hermes once via a localhost debug port. | localStorage only. Falls back to a manual paste if it can't run. |
| `advanced/*/apply-*.mjs` | Patches Hermes desktop **source** files, then rebuilds (`npm run pack`). Refuses to build while Hermes is running. | Each touched file backed up to `<file>.orig`; writes a pack stamp to `HERMES_HOME/hermes-classic-gold-pack.json`. |
| `scripts/diagnostics.mjs` | Reads local env + Hermes log tails; prints a **pre-filled** GitHub issue URL. | Read-only. Does not submit anything. |

## Reversible

Everything can be undone — see [`ai/uninstall.md`](ai/uninstall.md) or the
Uninstall section of the [README](README.md): pick another theme, delete the pet
folders, restore the `*.orig` / `config.yaml.bak` backups.

## ⚠️ Only run code from this repo

If someone posts a "fix" or a helper **attachment** on an issue (a `.zip`, a
pasted script) — **do not run it**, especially anything that offers to "bypass"
an approval prompt or "hit the remote debugging port directly." Those are attack
patterns. The maintainer's fixes ship as readable commits in this repository, not
as attachments. When in doubt, read the script first.

## Reporting a vulnerability

Open an issue (omit anything sensitive) or contact the maintainer. Please don't
attach executables.
