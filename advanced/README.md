# Advanced: status bar & caduceus extras

> ⚠️ **Read this first.** These two patches edit the Hermes **desktop app
> source** and rebuild it. Unlike the theme and pets, they are **not** a simple
> drop-in.
>
> - You need a Hermes desktop **dev environment**: an `apps/desktop` checkout
>   with its dependencies installed, plus **Node** and **Git**.
> - **Hermes must be fully quit** during the build (`npm run pack`), or the
>   file locks abort it.
> - **A Hermes app update reverts BOTH tiers** (it rebuilds from a hard `git
>   reset`). To update, ask your AI assistant to "update Hermes and re-apply
>   Classic Gold" ([`ai/update.md`](../ai/update.md)) — it re-applies + self-heals,
>   no terminal needed. (Terminal equivalent: `node update-hermes.mjs`.) If a
>   re-apply ever fails, see [`ai/brokenupdatefix.md`](../ai/brokenupdatefix.md).
> - The pack ships **multiple version baselines** (see *Versioned baselines*
>   below). The installer auto-selects the one matching your Hermes; if none
>   matches, the scripts stop and point you at *If a patch rejects*.

## Versioned baselines

Hermes-Agent moves fast, so each tier stores its `patch` + full-file `files/`
fallback (+ statusbar's additive `.d.ts` patches) **per baseline**:

```
advanced/
  baselines.json                          # index (oldest → newest)
  statusbar/baselines/<id>/{hermes-statusbar.patch, files/…, additive/…}
  extras-caduceus/baselines/<id>/{hermes-caduceus.patch, files/…}
```

`baselines.json` rows: `{ id: "<appVersion>-<shortsha>", commit, appVersion,
electronExt: "ts"|"cjs" }`. The resolver ([`../lib/baseline.mjs`](../lib/baseline.mjs))
picks a baseline in order: **exact git HEAD commit → electron-layer probe
(`electron/main.ts` vs `main.cjs`) + newest `appVersion ≤` yours → none**. Two
builds can share an `appVersion` (e.g. `0.17.0`) but differ in source shape, so
the commit and the `.ts`/`.cjs` probe are decisive, not semver alone. When
nothing matches, reconcile a new baseline via [`../ai/repair.md`](../ai/repair.md).

## Status bar (TelemetryTape HUD)

Adds the custom status bar (system RAM/VRAM, context usage, session/turn timers,
caduceus rail glyphs). Touches ~13–14 files: renderer files under
`apps/desktop/src/` plus an Electron IPC pair (`electron/main.{ts,cjs}` +
`electron/preload.{ts,cjs}`, per the baseline's era) that reports RAM (via `os`)
and VRAM (via `nvidia-smi`). It also lifts the chat composer to sit
above the status bar and reserves that space in the thread's scroll clamp (via a
single `--composer-dock-offset` variable) so the last message never slides under
the prompt box, hides the composer's redundant model pill (the tape has its own
selector), and makes the stock status bar follow the prompt window instead of
spilling under the left sidebar.

It does **not** relocate `<StatusbarControls>` in `app-shell.tsx` — the status
bar renders in Hermes-Agent's stock slot (anchored to `<main>`). An earlier
version moved it inside `<PaneShell>`, which re-anchored the absolute footer and
**hid the composer on some Hermes-Agent versions** (thanks @AnikaWilliams,
[#2](https://github.com/Elevatormusic/hermes-classic-gold-pack/issues/2)). Staying
in the stock slot is version-stable.

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

1. **Select the matching baseline** (commit → electron probe → semver, via
   `lib/baseline.mjs`) and warn if your HEAD isn't that baseline's commit. If no
   baseline matches, stop and point at `ai/repair.md` (nothing is touched).
2. **Refuse to build while Hermes is running** — on Windows this is detected
   automatically (a running `Hermes.exe` locks `release/win-unpacked` and would
   fail the build); on other OSes you get a reminder to quit it. Pass `--no-build`
   to stage files without building.
3. Back up every target file to `<file>.orig` (once).
4. **Reset the target paths to a clean base** (`git checkout -- …`) so a prior
   install's modified/staged files don't force `git apply --3way` into
   "does not match index" and the risky full-file fallback.
5. `git apply --3way` the shipped patch. **If it rejects**, fall back per file:
   - **On the baseline's commit:** copy the full post-edit file from the
     baseline's `files/` —
     **except** the type-declaration files (`global.d.ts`, `types/hermes.ts`),
     which are 3-way-merged from a tiny additive patch in `<tier>/additive/`. A
     full copy of those could drop a newer bridge API (e.g. `window.hermes.zoom`)
     and break `tsc`.
   - **On a DIVERGED checkout (HEAD ≠ the baseline's commit):** it **refuses to blind-copy** and
     **stops before building** — a base-file copy would silently overwrite your
     version's real code (and any `repair.md` reconciliation). It lists the
     unresolved files and points you to `repair.md`. Pass `--force-copy` to
     overwrite anyway. (Thanks @AnikaWilliams,
     [#2](https://github.com/Elevatormusic/hermes-classic-gold-pack/issues/2) /
     [#3](https://github.com/Elevatormusic/hermes-classic-gold-pack/issues/3).)
6. Unless `--no-build`, run `npm run pack` in `apps/desktop`, then write a pack
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
