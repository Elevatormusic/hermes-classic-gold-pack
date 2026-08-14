# Install instructions for an AI assistant

Install Classic Gold through the supported Hermes Desktop plug-in boundary. Do
not patch or rebuild the Hermes checkout.

For a user who explicitly wants a no-terminal folder copy, use the prepared
release ZIP and follow [`../docs/EASY-INSTALL.md`](../docs/EASY-INSTALL.md).
Copy-ready agent prompts are in
[`../docs/AI-AGENT-PROMPTS.md`](../docs/AI-AGENT-PROMPTS.md). Do not copy the
renderer source file directly.

## Procedure

1. Clone this repository. Read `README.md` and `SECURITY.md`.
2. Find the intended `HERMES_HOME`. It is the directory that contains the
   target `config.yaml`. If more than one profile exists, ask the user to select
   one. Do not guess.
3. Preview the exact target:

   ```bash
   node install.mjs --dry-run --home "<HERMES_HOME>" --activate noir-neko-ascii-fine
   ```

4. Report the planned renderer, backend, pet, config, stamp, and manifest
   writes. Explain that backend config edits affect only the `classic-gold`
   plug-in membership. Pet activation affects only `display.pet`.
5. Run the install against the same target:

   ```bash
   node install.mjs --home "<HERMES_HOME>" --activate noir-neko-ascii-fine
   ```

   Omit `--activate` when the user wants to keep the current pet. With one
   auto-detected profile, `--yes` can skip interactive confirmation. It cannot
   select between profiles. Keep `--home` explicit for an automated install.
6. Fully quit and start Hermes Desktop. A renderer-only reload cannot mount a
   new Python backend route.
7. Confirm that **Classic Gold** is enabled in **Settings > Plugins**. Select
   **Classic Hermes** in **Settings > Appearance** if another theme is active.
   If the renderer is still absent, run **Reload desktop plugins** from the
   Command Palette.
8. Use the screenshot in `README.md` as the visual reference. Capture a full
   window screenshot. Confirm the gold palette, caduceus, pixel wordmark, pet,
   and tape.
9. Click **HERMES-AGENT**, change one customizer value, close the popover, and
   open **Customize Classic Gold** from the Command Palette. Confirm that the
   value persisted.
10. In an active session, test the model, reasoning, provider, and context
    controls. Confirm that the duplicate composer selector is hidden. Open a
    new draft and confirm that the selector returns.
11. Complete one turn. Confirm the token display, prompt-cache hit rate, and
    final-turn average. Check cost, RAM, and VRAM without treating `--` as a
    false value. Cache hit rate stays unavailable until Hermes records a
    prompt-cache read. Cost stays unknown unless Hermes records an actual or
    included cost. RAM and VRAM are host-wide backend readings, not per-process
    or per-session readings.
12. Report the exact `HERMES_HOME`, renderer path, backend path, restart method,
    and results. Keep the initial screenshot and one screenshot with an open
    control for issue evidence.

## Remote backend

If Hermes Desktop uses a backend on another host, install twice:

- Install the renderer and pets, but not the unused backend, in the local
  desktop profile:

  ```bash
  node install.mjs --home "<LOCAL_HERMES_HOME>" --desktop-plugin --no-plugin-backend
  ```

- Put this repository on the remote host. Preview and install only the backend:

  ```bash
  node install.mjs --dry-run --home "<REMOTE_HERMES_HOME>" --no-desktop-plugin --plugin-backend --no-pets
  node install.mjs --home "<REMOTE_HERMES_HOME>" --no-desktop-plugin --plugin-backend --no-pets --yes
  ```

Do not copy only the Python file. The dashboard manifest, built route, config
entry, and receipts are required. Restart the remote Hermes backend or gateway,
and then fully restart Hermes Desktop. RAM, VRAM, session metadata, and cost
then come from the remote host.

## Legacy detection

Do not use `--advanced`. The files under `advanced/` and the
`theme/apply-theme.mjs` helper are legacy forensic artifacts. They change source
or use an old theme path and are not a recovery method for a current install.

If an old Classic Gold source patch is present, stop the normal install. Follow
[`update.md`](update.md) for the restore-only migration, Hermes update, new
install, and full restart.
