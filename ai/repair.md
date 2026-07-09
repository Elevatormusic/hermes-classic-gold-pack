# Patch-repair prompt

Use this when an advanced patch (`status bar` or `caduceus extras`) does **not**
apply cleanly because your Hermes version differs from the pack's base commit
(the `BASE` constant in `advanced/apply-common.mjs` — currently
`4d7f8ade3e586d83003d61be76e909f364040fba`). Paste the block below into your
coding assistant. It also works in plain chat if you paste your current files.

> For a broad post-update recovery playbook (blank screen, `tsc` errors, orphan
> files, missing composer/tape/background), see **[`brokenupdatefix.md`](brokenupdatefix.md)**
> — this file is specifically the *version-divergence* case.

---

```
Goal: apply this pack's <status bar | caduceus extras> change to my Hermes
version, which the shipped patch does not apply to cleanly.

READ THESE INPUTS from the pack:
  - advanced/<tier>/hermes-<tier>.patch      → the exact intended diff
  - advanced/<tier>/files/apps/desktop/src/… → the full intended post-edit files
  - base commit: the BASE constant in advanced/apply-common.mjs
  (<tier> is "statusbar" (files: hermes-statusbar.patch) or "extras-caduceus"
   (files: hermes-caduceus.patch).)

PROCEDURE — do NOT blindly overwrite my files:
  1. For each target file, compare the pack's post-edit files/ version against
     MY current file at the same path in my hermes-agent checkout.
  2. Port the INTENT of the change into my current file: new imports, the new
     component logic (the TelemetryTape HUD with its inlined useSystemResources
     hook, the caduceus LoaderCurve, the Backdrop settings, the pixel wordmark),
     the composer dock-offset clamp, the model-pill hide, and the system-resource
     IPC (electron/main.cjs handler + electron/preload.cjs bridge). Keep MY
     version's surrounding code, names, and refactors intact.
  3. TYPE-DECLARATION FILES ARE ADDITIVE ONLY. For global.d.ts and
     types/hermes.ts, SPLICE IN the pack's added declarations (getSystemResources;
     the UsageStats telemetry fields) — never replace the whole file, or you may
     drop a newer bridge API (e.g. window.hermes.zoom) and break `tsc`.
  4. use-system-resources.ts is CONDITIONAL — check before deleting. The current
     pack folds system resources into the IPC, so if you migrated
     statusbar-controls.tsx to `window.hermesDesktop.getSystemResources`, the old
     `app/shell/hooks/use-system-resources.ts` is a dangling orphan → delete it.
     BUT if your reconciled statusbar-controls.tsx still
     `import { useSystemResources } from '@/app/shell/hooks/use-system-resources'`
     and calls it, the file is NOT orphan — deleting it breaks the build. Only
     remove it once nothing imports it.
  5. If you kept the renderer-hook design, make sure the IPC it reads actually
     EXISTS: `electron/main.cjs` must have the `hermes:system-resources` handler
     and `electron/preload.cjs` the `getSystemResources` bridge — otherwise
     RAM/VRAM silently reads blank with no error (see brokenupdatefix.md).
  6. Show me a diff of what you changed before writing.

THEN build (Hermes fully quit):
  cd apps/desktop && npm run pack
  Relaunch Hermes to verify.

VERIFY AND SELF-HEAL (do this yourself before asking me anything):
  - Read the `npm run pack` output for TypeScript/build errors; if it fails,
    read the error, fix the merge, rebuild. Repeat up to 3 times.
  - After relaunch, run `node scripts/diagnostics.mjs --logs` and read
    errors.log / desktop.log for renderer errors (e.g. ERR_FILE_NOT_FOUND, a
    stack trace, "Unexpected end of input"). A blank window almost always shows
    up there. Fix and rebuild rather than asking me.
  - Only if it's a purely VISUAL problem with clean logs, ask me — in ONE
    message — for a screenshot of the affected area AND the DevTools console
    (Ctrl/Cmd+Shift+I → Console). Then finish the fix.

PLAIN-CHAT FALLBACK: if you can't read my files directly, ask me to paste each
current target file; return the merged version for me to save.
```
