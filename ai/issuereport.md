# Report a problem — instructions for an AI assistant

Help the user file a good bug report for the **Hermes "Classic Gold" pack**.

> **You need shell + file access.** If you can't run commands, tell the user to
> run `node scripts/diagnostics.mjs --logs` themselves and open the link it prints.

## Steps

**1. Gather diagnostics** from inside the repo:

```bash
node scripts/diagnostics.mjs --logs --error "<one line: what failed>"
```

This prints the environment (OS, Node, Hermes commit), recent Hermes log tails
(`errors.log`, `desktop.log`, `agent.log`, `gateway.log`), **and** a pre-filled
GitHub "New Issue" link.

**2. Try once more.** Read those logs and make one more attempt to explain or fix
the failure yourself (see [`ai/install.md`](install.md) and
[`ai/repair.md`](repair.md)).

**3. Hand off the report.** If it still isn't resolved, give the user the printed
**issue URL** and ask them to review and submit it.

- **Do not file the issue yourself** — the user reviews first.
- The URL body only contains the environment summary. The log tails are shown to
  you locally and are **not** placed in the issue unless the user chooses to add
  them.
- Alternative: the user can open the repo's **Issues → New → "Install failure"**
  template and paste the diagnostics.

## Rules
- Never submit the issue for the user.
- Remind the user to remove anything private from logs before pasting them anywhere.
