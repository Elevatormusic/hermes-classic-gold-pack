# Advanced: status bar & caduceus extras

> ⚠️ **Read this first.** These two patches edit the Hermes **desktop app
> source** and rebuild it. Unlike the theme and pets, they are **not** a simple
> drop-in.
>
> - You need a Hermes desktop **dev environment**: an `apps/desktop` checkout
>   with its dependencies installed, plus **Node** and **Git**.
> - **Hermes must be fully quit** during the build (`npm run pack`), or the
>   file locks abort it.
> - **A Hermes app update reverts these** — re-run the apply script afterwards.
> - Patches are generated against `NousResearch/hermes-agent@8301654`. On a
>   different version they may not apply cleanly (see *If a patch rejects*).

## Status bar (TelemetryTape HUD)

Adds the custom status bar (system CPU/mem, context usage, session/turn timers,
caduceus rail glyphs). Touches 13 files under `apps/desktop/src/` including a new
`app/shell/hooks/use-system-resources.ts`. This also lifts the chat composer to
sit above the status bar and reserves that space in the thread's scroll clamp (via
a single `--composer-dock-offset` variable) so the last message never slides under
the prompt box.

```bash
node advanced/statusbar/apply-statusbar.mjs --repo "<path-to>/hermes-agent"
# --repo defaults to %LOCALAPPDATA%\hermes\hermes-agent
# --no-build stages the files but skips `npm run pack`
```

## Caduceus extras (optional, independent)

The caduceus loader (two entwined sine-snakes), the resized/centered backdrop,
and the "HERMES AGENT" hero wordmark. Independent of the status bar — apply
either or both.

```bash
node advanced/extras-caduceus/apply-caduceus.mjs --repo "<path-to>/hermes-agent"
```

## How the apply scripts work

1. Warn if your `hermes-agent` HEAD isn't the base commit `8301654`.
2. **Refuse to build while Hermes is running** — on Windows this is detected
   automatically (a running `Hermes.exe` locks `release/win-unpacked` and would
   fail the build); on other OSes you get a reminder to quit it. Pass `--no-build`
   to stage files without building.
3. Back up every target file to `<file>.orig` (once).
4. `git apply --3way` the shipped patch. **If it rejects**, fall back to copying
   the full post-edit files from `<tier>/files/`.
5. Unless `--no-build`, run `npm run pack` in `apps/desktop`, then write a pack
   stamp to `HERMES_HOME/hermes-classic-gold-pack.json` (read by
   `scripts/diagnostics.mjs`) and tell you to relaunch.

## If a patch rejects (different Hermes version)

The full-file fallback assumes the surrounding code hasn't moved. If your
version has diverged, use [`../ai/repair.md`](../ai/repair.md): hand an AI the
shipped patch + `<tier>/files/` (the intended post-edit state) and it reconciles
the *intent* into your current files, then rebuilds.

## Revert

Restore the backups and rebuild:

```bash
# in your hermes-agent checkout, for each touched file: mv <file>.orig <file>
cd apps/desktop && npm run pack   # Hermes quit
```
