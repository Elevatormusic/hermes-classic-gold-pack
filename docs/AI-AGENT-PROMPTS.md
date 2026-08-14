# Copy a prompt for your AI agent

Use an AI coding agent that can read files and run commands on your computer.
Copy only the prompt for the task that you want. The agent must stop and ask you
to select a profile if it finds more than one Hermes profile.

## Install Classic Gold

```text
Install the latest stable Hermes Classic Gold Pack from
https://github.com/Elevatormusic/hermes-classic-gold-pack.

Use only the supported run-time plug-in installer. Do not patch Hermes source.
First find the exact Hermes profile that contains config.yaml. If more than one
profile exists, stop and ask me which one to use. Read README.md, SECURITY.md,
AGENTS.md, and ai/install.md before you change files. Check for an old Classic
Gold source-patch install. If one exists, follow the documented restore-only
migration before the new install. Do not force a migration or delete user files.

Run the installer dry run against the exact profile and show me the plan. If the
plan is safe, install the renderer and telemetry backend. Keep my current pet
unless I ask you to change it. Fully quit and restart Hermes. Confirm that
Classic Gold is enabled in Settings > Plugins and Classic Hermes is available
in Settings > Appearance. Verify the installed file hashes and receipts. Test
the theme, status-bar controls, RAM, VRAM, cost, token rate, and cache hit rate.
Treat -- as unavailable data, not a failed install. Report the exact profile,
Pack version, files changed, restart result, and checks. Do not merge, delete,
or overwrite unrelated files.
```

## Troubleshoot or fix Classic Gold

```text
Troubleshoot the existing Hermes Classic Gold installation. Work read-only
until you identify the cause. Find the exact Hermes profile that contains
config.yaml. If more than one profile exists, stop and ask me which one to use.
Read README.md, SECURITY.md, AGENTS.md, ai/repair.md, and ai/issuereport.md from
the latest stable Classic Gold Pack.

Run the Pack diagnostics and inspect the active stamps, manifest receipts,
renderer hash, telemetry backend files, plug-in membership, Hermes logs, and
whether a full restart is pending. Do not apply old source patches. Do not
delete a full plugins folder, desktop-plugins folder, profile, session, log, or
user file. Preserve any file that changed after the Pack installed it. Explain
the cause and the smallest safe fix before you write. Then apply only that fix,
fully restart Hermes, and verify the theme, status-bar buttons, model-selector
behavior, RAM, VRAM, actual session cost, token rate, and cache hit rate. Treat
unknown telemetry as unavailable, not zero. Report live, static, skipped, and
unavailable checks separately.
```

## Update Classic Gold

```text
Update Hermes Classic Gold to the latest stable release without changing
Hermes source. Find the exact Hermes profile that contains config.yaml. If more
than one profile exists, stop and ask me which one to use. Read README.md,
SECURITY.md, AGENTS.md, and ai/update.md from the latest Pack.

Determine whether this is a managed installer install, a manual folder install,
or an old source-patch install. For a managed install, update the Pack checkout,
run the dry run against the same exact profile, and rerun the supported
installer. For a manual folder install, use the prepared ZIP from the latest
GitHub release and replace only desktop-plugins/classic-gold and
plugins/classic-gold while Hermes is fully closed. For an old source-patch
install, complete the documented restore-only migration first. Do not mix these
methods, force a migration, or overwrite changed user files.

Fully restart Hermes. Verify the release version, installed hashes, plug-in
membership, Classic Hermes theme, status-bar controls, and available telemetry.
Report every changed path and the validation result.
```

## Remove the old theme or uninstall Classic Gold

```text
Safely remove the old Hermes Classic Gold theme. First identify the exact
Hermes profile and whether the install is a managed run-time plug-in, a manual
folder copy, or a legacy source patch. If more than one profile exists, stop and
ask me which one to use. Read README.md, SECURITY.md, AGENTS.md,
ai/uninstall.md, and ai/update.md before any write.

Select another theme before removal. For a managed run-time install, run the
documented uninstall dry run, review its exact receipt proofs, and then use the
Pack uninstaller. For a manual folder install, fully quit Hermes and remove only
desktop-plugins/classic-gold and plugins/classic-gold. For a legacy source
patch, use the restore-only migration and require exact same-version backup or
Git proof. Never delete the full desktop-plugins, plugins, pets, Hermes profile,
session, or log folders. Never guess at a backup or overwrite a later user edit.

Restart Hermes and confirm that Classic Gold is disabled, its exact managed
files are absent or restored, another theme is active, and unrelated plug-ins
still work. Report what was removed, what was preserved, and any item that could
not be removed safely.
```
