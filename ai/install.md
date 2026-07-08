# Install — instructions for an AI assistant

This file is the full instruction set. A user points their AI assistant here with
a short prompt ("clone the repo, read `ai/install.md`, and follow it"). If you are
that assistant, do exactly what's below.

> **You need shell + file access** (Claude Code, Cursor, Codex CLI). If you can't
> run commands, stop and give the user the exact commands to run themselves.

> **Two steps restart Hermes** — the advanced **build** (step 3) and the **theme**
> installer (step 4). Do them **last**. ⚠️ If *you* are running inside Hermes (e.g.
> this assistant was launched from Hermes' own terminal), restarting Hermes will
> **end your session** — so for those two steps, either run them dead last, or hand
> the user the exact commands to run after you're done. Detect this before acting.

## Steps

**1. Get the repo.** Clone `https://github.com/Elevatormusic/hermes-classic-gold-pack`
and `cd` into it (skip if you're already inside it).

**2. Core — pets.** Run:

```bash
node install.mjs --activate noir-neko-ascii-fine
```

Omit `--activate` to install both pets without changing the user's current pet.
`install.mjs` creates the `display.pet` block if the config doesn't have one yet,
so `--activate` works on a brand-new Hermes. This step is safe while Hermes runs.

**3. Offer the advanced pieces.** Ask the user whether they also want the custom
**status bar** and/or the **caduceus extras** (loader + backdrop + wordmark). If
yes, run the matching script:

```bash
node advanced/statusbar/apply-statusbar.mjs
node advanced/extras-caduceus/apply-caduceus.mjs
```

Pass `--repo "<path-to>/hermes-agent"` if the checkout isn't the default
`%LOCALAPPDATA%\hermes\hermes-agent`.

These **rebuild the app** (`npm run pack`), which needs Hermes fully quit — the
scripts **refuse to build while Hermes is running** and tell you so. Handle it:

- **If you are NOT inside Hermes:** offer to close it for the user — with their
  OK, run `taskkill /IM Hermes.exe /F` (Windows), then re-run the apply script,
  then offer to relaunch Hermes afterward.
- **If you ARE inside Hermes:** don't quit it (you'd kill this session). Run the
  scripts with `--no-build` to stage the files, then give the user the one build
  command to run after quitting Hermes:
  `cd "<repo>/apps/desktop" && npm run pack`.

**4. Theme — run the automated installer (do this LAST; it restarts Hermes):**

```bash
node theme/apply-theme.mjs
```

The theme lives only in the app's localStorage (no theme file/CLI), so this helper
applies it the way a human would: it quits Hermes, relaunches it once with a
**localhost** DevTools debug port, runs the pack's **own** snippet
(`theme/install-theme.js`) in the window, waits for the write to flush, closes
that instance, and relaunches Hermes normally.

- **Do NOT write your own CDP/remote-debugging driver** — use this vetted helper.
- If it can't run automatically (non-Windows, or any failure) it prints the exact
  snippet and the one manual paste step — relay that to the user.
- Same restart caveat as step 3: if you're inside Hermes, running this ends your
  session (Hermes relaunches themed without you). Run it last, or hand the user
  the one command above.

**5. If anything fails, diagnose yourself FIRST** — don't ask the user yet. Loop
up to 3 times:

- Read the failing command's own output.
- Run `node scripts/diagnostics.mjs --logs` and read the Hermes log tails it
  prints (`errors.log`, `desktop.log`, `agent.log`, `gateway.log`).
- Check for `.rej` files left by a failed `git apply`.
- Fix the most likely cause, re-run the step, and re-check the logs.
- If a source patch rejected because the user is on a different Hermes version,
  follow [`ai/repair.md`](repair.md) to reconcile it.

Only ask the user as a **last resort, once** — and for a visual-only problem, ask
for a screenshot **plus** the DevTools console (`Ctrl/Cmd+Shift+I` → Console). If
it genuinely can't be fixed, follow [`ai/issuereport.md`](issuereport.md).

## Rules

- Back up any file before overwriting it.
- **Confirm before** editing `config.yaml`, applying an advanced patch, or
  **closing Hermes**.
- The apply scripts refuse to build while Hermes runs — close it (with consent)
  or use `--no-build` and hand off the build.
- Report exactly what you changed.
