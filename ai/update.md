# Update prompt — keep Classic Gold through a Hermes-Agent update

A Hermes-Agent update rebuilds the app from source and wipes the advanced tier
(status bar + caduceus). You don't need to run anything yourself or remember a
command — just hand the short prompt below to your AI assistant. It updates
Hermes **and** re-applies the pack, and fixes anything that breaks along the way.

> Prefer this over the in-app **Update** button — that button leaves you
> un-themed, and over a plain command it can't self-heal if something drifts.

## The short prompt (copy this to your assistant)

```
Update my Hermes-Agent and re-apply my Classic Gold theme + status bar. Open
github.com/Elevatormusic/hermes-classic-gold-pack, read ai/update.md, and follow
it. Self-heal via ai/brokenupdatefix.md and ai/repair.md before asking me anything.
```

That's it — the rest of this file is instructions for the assistant.

---

## Instructions for the assistant

**Goal:** update Hermes-Agent and bring the user's Classic Gold pack back, with
no manual steps for them. Do NOT hand the user shell commands to run — you run
them, and you fix failures yourself.

**1. Get the pack.** Clone `https://github.com/Elevatormusic/hermes-classic-gold-pack`
and `cd` in (skip if already there).

**2. See the current state:**

```bash
node scripts/diagnostics.mjs status
```

**3. Run the seamless updater.** It quits Hermes, runs `hermes update`, re-applies
the installed tiers (auto-detected from the live source + the pack stamp, BEFORE
the update wipes them), rebuilds once, and relaunches:

```bash
node update-hermes.mjs
```

- If the user **already clicked the in-app Update button** and lost the theme,
  re-apply only: `node update-hermes.mjs --no-update`.
- Pass `--branch <name>` only if their checkout tracks a non-`main` branch.

**4. Self-heal BEFORE asking the user** (loop up to 3×):

- Read the command output, and `node scripts/diagnostics.mjs --logs`.
- Match the symptom to a row in [`ai/brokenupdatefix.md`](brokenupdatefix.md) and
  apply that fix, then re-run.
- If a tier **refused** because the user's Hermes version diverged from the pack
  base, reconcile it via [`ai/repair.md`](repair.md), then re-run with
  `--no-update`. (The updater refuses rather than regressing — that's expected.)

**5. Verify, then report.** `node scripts/diagnostics.mjs status` should show the
tiers `applied`; relaunch Hermes and confirm the status bar + theme are back.
Only ask the user as a **last resort, once** — and for a visual-only problem, ask
for a screenshot plus the DevTools console. If it truly can't be fixed, follow
[`ai/issuereport.md`](issuereport.md).
