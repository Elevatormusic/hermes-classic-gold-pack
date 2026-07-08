# One-prompt installer

Copy everything in the fenced block below and paste it into an **agentic coding
assistant that can run shell commands and edit files** — Claude Code, Cursor,
Codex CLI, etc. (A plain chat assistant with no tools can't run the install; it
should instead read this file and tell you the exact commands.)

---

```
You are an agentic coding assistant with shell + file access. Install the
"hermes-classic-gold-pack" theme pack on my machine. Work carefully and confirm
before anything destructive.

REQUIREMENT: You must be able to run shell commands and edit files. If you
cannot, stop and give me the exact commands to run myself instead.

REPO: https://github.com/Elevatormusic/hermes-classic-gold-pack
If it isn't already on disk, clone it and cd into it. Node (bundled with Hermes)
must be available.

STEP 1 — CORE (theme + pets), safe and cross-platform:
  1a. Run:  node install.mjs --activate noir-neko-ascii-fine
      (Omit --activate to install both pets without changing my active pet.)
      It resolves HERMES_HOME, installs the two Noir Neko pets, and — with
      --activate — edits config.yaml (backing it up to config.yaml.bak first).
  1b. Tell me to install the gold theme by hand (there is no theme-import API):
      open Hermes Desktop → Ctrl/Cmd+Shift+I → Console tab → paste the contents
      of theme/install-theme.js → Enter. It self-reverts (see its header).

STEP 2 — ADVANCED (ask me first; these edit Hermes source and need a rebuild):
  Hermes must be FULLY QUIT before any build. The desktop dev deps must be
  installed (apps/desktop). These patches target hermes-agent base commit
  830165473e0920c2baf8c2a6863976edb0c52943.
  2a. Status bar:
        node advanced/statusbar/apply-statusbar.mjs --repo "<path-to>/hermes-agent"
      (Defaults to %LOCALAPPDATA%\hermes\hermes-agent if --repo is omitted.)
  2b. Optional caduceus extras (loader + backdrop + hero wordmark):
        node advanced/extras-caduceus/apply-caduceus.mjs --repo "<path-to>/hermes-agent"
  Each backs up touched files to *.orig, then runs `npm run pack`. Relaunch
  Hermes when done.

STEP 3 — IF ANYTHING FAILS OR LOOKS WRONG, DIAGNOSE YOURSELF FIRST (do NOT ask me yet).
  Work autonomously. Loop up to 3 times before involving me:
  a. Read the failing command's own output (`npm run pack` / `git apply`).
  b. Run:  node scripts/diagnostics.mjs --logs
     Read the Hermes log tails it prints (errors.log, desktop.log, agent.log,
     gateway.log). Look for the newest stack trace / "ERR" / "Failed to" /
     "ERR_FILE_NOT_FOUND" lines near the time of the failure.
  c. If `git apply` rejected, find and read any *.rej files in the hermes-agent
     tree, then port the intent by hand per ai/repair.md.
  d. Apply the most likely fix, re-run the step, and re-read the logs to confirm
     the error is gone. Common causes & fixes:
       - Hermes wasn't fully quit before pack → quit it, retry.
       - apps/desktop deps missing → install them, retry.
       - wrong --repo path → correct it.
       - patch rejected → use the files/ fallback, or reconcile via ai/repair.md.
  Only escalate to me after these attempts are genuinely exhausted.

STEP 4 — ASK ME ONLY AS A LAST RESORT, ONCE, WITH EVERYTHING AT ONCE.
  If you still can't resolve it — or the problem is purely VISUAL and the logs
  are clean (theme colors look off, status bar layout wrong, a pet renders
  sliced/offset) — ask me in ONE message for exactly what you need. Don't drip
  questions. For a visual issue, request a screenshot and tell me precisely how:
    • the specific area (the status bar / the pet / the whole window), AND
    • the DevTools console: open Hermes → Ctrl/Cmd+Shift+I → Console tab →
      screenshot or copy any red errors.
  Then use that to finish the fix, and verify again via the logs.

STEP 5 — IF IT GENUINELY CANNOT BE FIXED:
  Run:  node scripts/diagnostics.mjs --logs --error "<what failed>"
  Give me the printed pre-filled GitHub issue URL plus the relevant log excerpt,
  and ask me to review & submit. DO NOT file the issue yourself.

SAFETY RULES:
  - Exhaust automatic diagnosis (STEP 3) before asking me anything; batch any
    questions into one message.
  - Never run `npm run pack` while Hermes is open.
  - Back up any file before overwriting it.
  - Confirm with me before editing config.yaml or applying an advanced patch.
  - Report exactly what you changed.
```
