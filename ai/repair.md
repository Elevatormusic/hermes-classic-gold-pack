# Patch-repair prompt

Use this when an advanced patch (`status bar` or `caduceus extras`) does **not**
apply cleanly because your Hermes version differs from the pack's base commit
(`830165473e0920c2baf8c2a6863976edb0c52943`). Paste the block below into your
coding assistant. It also works in plain chat if you paste your current files.

---

```
Goal: apply this pack's <status bar | caduceus extras> change to my Hermes
version, which the shipped patch does not apply to cleanly.

READ THESE INPUTS from the pack:
  - advanced/<tier>/hermes-<tier>.patch      → the exact intended diff
  - advanced/<tier>/files/apps/desktop/src/… → the full intended post-edit files
  - base commit: 830165473e0920c2baf8c2a6863976edb0c52943
  (<tier> is "statusbar" (files: hermes-statusbar.patch) or "extras-caduceus"
   (files: hermes-caduceus.patch).)

PROCEDURE — do NOT blindly overwrite my files:
  1. For each target file, compare the pack's post-edit files/ version against
     MY current file at the same path in my hermes-agent checkout.
  2. Port the INTENT of the change into my current file: new imports, the new
     component/hook logic (e.g. useSystemResources, the TelemetryTape HUD, the
     caduceus LoaderCurve, the Backdrop settings, the hero wordmark), and any
     type additions in global.d.ts / types/hermes.ts. Keep MY version's
     surrounding code, names, and refactors intact.
  3. The status bar adds a new file, app/shell/hooks/use-system-resources.ts —
     create it if my tree lacks it.
  4. Show me a diff of what you changed before writing.

THEN build (Hermes fully quit):
  cd apps/desktop && npm run pack
  Relaunch Hermes to verify.

PLAIN-CHAT FALLBACK: if you can't read my files directly, ask me to paste each
current target file; return the merged version for me to save.
```
