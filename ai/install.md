# Install — instructions for an AI assistant

This file is the full instruction set. A user points their AI assistant here with
a short prompt ("clone the repo, read `ai/install.md`, and follow it"). If you are
that assistant, do exactly what's below.

> **You need shell + file access** (Claude Code, Cursor, Codex CLI). If you can't
> run commands, stop and give the user the exact commands to run themselves.

## Steps

**1. Get the repo.** Clone `https://github.com/Elevatormusic/hermes-classic-gold-pack`
and `cd` into it (skip if you're already inside it).

**2. Core — theme + pets.** Run:

```bash
node install.mjs --activate noir-neko-ascii-fine
```

Omit `--activate` to install both pets without changing the user's current pet.
(`install.mjs` now creates the `display.pet` block if the config doesn't have one
yet, so `--activate` works on a brand-new Hermes.)

Then hand the user the **theme** step — this one is **human-only, by design**:
open Hermes Desktop → `Ctrl/Cmd+Shift+I` → **Console** tab → paste the contents of
`theme/install-theme.js` → Enter.

> **Do not try to automate the theme.** It writes browser `localStorage`; the only
> ways to do it "unattended" are injecting over the DevTools/remote-debugging
> protocol or editing Chromium's leveldb — both are fragile and (rightly) trip
> code-execution approval gates. Just print the snippet's path and let the user
> paste it. Wait for them to confirm, then continue.

**3. Offer the advanced pieces.** Ask the user whether they also want the custom
**status bar** and/or the **caduceus extras** (loader + backdrop + wordmark). If
yes, run the matching script — Hermes must be **fully quit** for the build:

```bash
node advanced/statusbar/apply-statusbar.mjs
node advanced/extras-caduceus/apply-caduceus.mjs
```

Pass `--repo "<path-to>/hermes-agent"` if the checkout isn't the default
`%LOCALAPPDATA%\hermes\hermes-agent`.

**4. If anything fails, diagnose yourself FIRST** — don't ask the user yet. Loop
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
- Confirm with the user before editing `config.yaml` or applying an advanced patch.
- **Never** run `npm run pack` while Hermes is open.
- Report exactly what you changed.
