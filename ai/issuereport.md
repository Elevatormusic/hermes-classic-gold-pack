# Report a problem — instructions for an AI assistant

Something in the **Hermes-Agent "Classic Gold" pack** isn't working. Your job
order is: **fix it first → if it's genuinely unfixable, file a good issue for the
user automatically** (they shouldn't have to upload anything or click a link).

> **You need shell + file access.** If you can't run commands, run
> `node scripts/diagnostics.mjs --logs` for the user and hand them the pre-filled
> issue link it prints.

## Step 1 — Try to FIX it first (don't report a fixable problem)

Exhaust the self-heal before reporting. Most problems are fixable here:

- Re-read the failing command's own output.
- Run `node scripts/diagnostics.mjs --logs` and read the Hermes-Agent log tails
  (`errors.log`, `desktop.log`, `agent.log`, `gateway.log`); check for `.rej`
  files from a rejected `git apply`.
- Follow [`ai/install.md`](install.md) (the self-heal loop) and
  [`ai/repair.md`](repair.md) (reconcile a patch that rejected on a different
  Hermes-Agent version). Loop up to 3 times.

Only continue to reporting if it truly cannot be fixed.

## Step 2 — Gather diagnostics

```bash
node scripts/diagnostics.mjs --logs --error "<one line: what failed>"
```

Note the environment (OS, Node, Hermes-Agent commit, on-base?) and read the logs
so your summary is accurate. **Do not paste raw logs** into the issue — they can
contain prompts and local paths. Summarize instead; include raw logs only if the
user explicitly asks.

## Step 3 — File the issue automatically

Don't make the user click or accept a link. **Check for duplicates, then file it
directly:**

```bash
# 1. Avoid duplicates — comment on a match instead of opening a new one.
gh issue list --repo Elevatormusic/hermes-classic-gold-pack --state open --search "<keywords>"

# 2. File it (fill the template below into the body).
gh issue create \
  --repo Elevatormusic/hermes-classic-gold-pack \
  --title "<concise, specific title>" \
  --body "$(cat <<'EOF'
<filled template>
EOF
)"
```

Then tell the user: *"I filed this as an issue — <url>."* Give them the URL the
command returns.

**If the problem is visual** — something renders wrong, is missing, or looks off
(a broken layout, a hidden panel, a mangled glyph) — **a screenshot is worth more
than any description.** `gh` can't upload images, so ask the user to add one:
open the issue URL, scroll to the comment box, and **drag the screenshot in** (or
click the paperclip). Say it in one line, e.g. *"This is a visual glitch, so a
screenshot would really help — open <url> and drag one into the comment box."*

**Fallback:** if `gh` isn't installed or authenticated, run
`node scripts/diagnostics.mjs --logs` and give the user the pre-filled
`issues/new?...` URL it prints so they can open it in one click.

## Issue template — fill this into the `--body`

```markdown
### What's wrong
<one short paragraph: the symptom, in plain language>

### What I tried (self-heal)
<the fixes you attempted from ai/install.md / ai/repair.md and why they didn't resolve it>

### Suspected area
<theme / pets / status bar / caduceus extras / installer — name the file or patch if known>

### Environment
<paste the "### Environment" block printed by `node scripts/diagnostics.mjs` — env only, no raw logs>

### Screenshot
<for a visual issue, attach one after filing — drag it into the comment box (see the screenshot note above)>

### Repro
<minimal steps to reproduce, if known>
```

## Rules

- **Fix first;** only file if the problem is genuinely unfixable.
- **One issue.** Search open issues first and comment on a match rather than duplicating.
- Keep the **title specific** (e.g. `status bar patch rejects on hermes-agent@<sha>`),
  not "it doesn't work."
- **Never** include raw logs, secrets, tokens, or personal paths unless the user opts in.
- If you filed it, tell the user the URL — don't ask them to submit anything.
