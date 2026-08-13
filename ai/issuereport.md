# Report a Classic Gold problem

Try the safe run-time recovery steps before you file an issue. Do not change the
Hermes source checkout for a renderer, backend, theme, settings, or pet problem.

## 1. Try the safe checks

1. Record the exact `HERMES_HOME`. Confirm these files:

   ```text
   HERMES_HOME/desktop-plugins/classic-gold/plugin.js
   HERMES_HOME/plugins/classic-gold/dashboard/manifest.json
   HERMES_HOME/plugins/classic-gold/dashboard/plugin_api.py
   HERMES_HOME/plugins/classic-gold/dashboard/dist/index.js
   ```

2. Confirm that `classic-gold` is enabled in `config.yaml` and in
   **Settings > Plugins**.
3. Fully quit and start Hermes Desktop. A renderer reload cannot mount the
   Python route.
4. For a remote profile, confirm that the backend files and config entry are on
   the remote backend host. Restart that backend or gateway too.
5. Run diagnostics and read the local output:

   ```bash
   node scripts/diagnostics.mjs --logs
   ```

6. Use the troubleshooting table and the first-start checklist in `README.md`.
   Test an interaction and capture a screenshot before and after the failure.

Do not report `--` as a false value without checking the telemetry contract.
Speed needs a completed turn. Cache hit rate needs prompt-cache reads. Cost
needs an actual or included Hermes cost record. RAM and VRAM cover the full
backend host. VRAM also needs NVIDIA `nvidia-smi`.

If diagnostics show a legacy source patch, stop the normal recovery. Use
[`brokenupdatefix.md`](brokenupdatefix.md). Use [`repair.md`](repair.md) only
when restore-only migration cannot prove a safe file restore.

## 2. Gather a private summary

```bash
node scripts/diagnostics.mjs --logs --error "<one-line failure>"
```

Record the operating system, Node version, Pack version, Hermes version and
commit, exact command with private paths removed, profile type, and whether a
full restart occurred. For telemetry, record whether the backend is local or
remote and whether `nvidia-smi` works on that host.

Do not paste raw logs. They can contain prompts, session metadata, local paths,
branch names, and secrets. Summarize the relevant error. Include raw content
only after the user reviews it and gives explicit approval.

## 3. Search and file

Search open issues first. Comment on an exact match instead of making a
duplicate:

```bash
gh issue list --repo Elevatormusic/hermes-classic-gold-pack --state open --search "<keywords>"
```

If no issue matches, use the repository issue template. A direct `gh issue
create` command needs the user's authorization because it writes to GitHub. If
`gh` is not installed or authenticated, give the user the pre-filled issue URL
from diagnostics.

For a visual problem, ask the user to add the two screenshots. Remove or cover
workspace names, branch names, provider details, and other private metadata.

## Issue body

```markdown
### What failed
<one short paragraph with the visible or command symptom>

### Area
<installer | renderer plug-in | telemetry backend | theme and settings | pets | legacy migration | uninstall>

### Exact flow
<dry run, command, full restart, and minimal reproduction steps; remove private paths>

### Expected telemetry state
<actual | included | unknown | not applicable; local or remote backend; nvidia-smi result>

### Environment
<the diagnostics environment block only; no raw logs or private paths>

### Interaction checks
<which model, reasoning, provider, context, customizer, and selector checks passed or failed>

### Screenshots
<attach a redacted initial full-window image and a redacted failure image>

### Safe recovery tried
<full restart, renderer reload, reinstall, or restore-only migration; do not apply a legacy patch>
```

Keep the title specific. For example: `telemetry backend route missing after
Pack reinstall on Hermes 0.20.0`. Do not use patch-era terms for a current
run-time problem.
