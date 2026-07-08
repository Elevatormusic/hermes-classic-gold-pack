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

STEP 3 — IF A PATCH REJECTS (I'm on a different Hermes version):
  The apply script already falls back to copying full files; if that also looks
  wrong (surrounding code moved), follow ai/repair.md: read the shipped patch +
  advanced/<tier>/files/ (the intended post-edit state), reconcile the INTENT
  against my actual current files, then re-run `npm run pack`.

STEP 4 — IF SOMETHING TRULY CAN'T BE FIXED:
  Run:  node scripts/diagnostics.mjs --error "<what failed>"
  Show me the printed pre-filled GitHub issue URL and ask me to review and
  submit it. DO NOT file the issue yourself.

SAFETY RULES:
  - Never run `npm run pack` while Hermes is open.
  - Back up any file before overwriting it.
  - Confirm with me before editing config.yaml or applying an advanced patch.
  - Report exactly what you changed.
```
