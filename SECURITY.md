# Security and local writes

Classic Gold installs local files. Its install, migration, diagnostics, and
removal scripts do not send telemetry or download executable code.

## Target selection

Use `--home "<HERMES_HOME>"` to name the profile that contains `config.yaml`.
Use `--repo "<path-to-hermes-agent>"` when a command must inspect a Hermes git
checkout. An explicit path is authoritative. A bad explicit path must fail; the
script must not fall back to another profile or checkout.

The installer refuses more than one detected profile even with `--yes`. With
one detected profile, `--yes` skips only the interactive confirmation. Migration
and removal also require it for a non-interactive write. It does not select a
profile or bypass ownership and hash checks.

## Recommended install writes

`node install.mjs` can write:

- `HERMES_HOME/desktop-plugins/classic-gold/plugin.js`;
- `HERMES_HOME/plugins/classic-gold/dashboard/manifest.json`;
- `HERMES_HOME/plugins/classic-gold/dashboard/plugin_api.py`;
- `HERMES_HOME/plugins/classic-gold/dashboard/dist/index.js`;
- `HERMES_HOME/pets/noir-neko/`;
- `HERMES_HOME/pets/noir-neko-ascii-fine/`;
- `HERMES_HOME/config.yaml` to enable the backend;
- the `display.pet` block in `config.yaml` when `--activate` is present;
- the Classic Gold stamp and append-only manifest in `HERMES_HOME`.

The renderer and backend installers record planned and completed writes. They
use a temporary file, record hashes, and keep the user's first pre-install file
when a managed path already exists. A failed transaction uses a unique rollback
copy. Reinstall refuses to overwrite a managed file when its current hash does
not match the last Pack receipt.

The backend config editor changes only the `classic-gold` entries in
`plugins.enabled` and `plugins.disabled`. It fails closed when it cannot parse
the needed YAML structure safely. Pet activation records only the old and new
`display.pet` blocks. The installer does not keep a broad `config.yaml.bak` for
normal removal.

Current installs record and hash each bundled pet file. They back up an
existing file at the same path and refuse to replace a later user edit. Old
manifests can have directory-only pet receipts. The uninstaller does not remove
those directories because the receipts cannot prove ownership of each file.
Remove exact files by hand only after you prove their ownership.

## Renderer authority and settings

The desktop plug-in runs in the Hermes renderer with the authority that the
Hermes Desktop plug-in SDK provides. This is not a sandbox. Review `plugin.js`
and install it only from a source that you trust.

The renderer keeps an owned Classic Gold theme mirror and its ownership
snapshot in Hermes local storage. It does not replace a same-name theme after a
user changes that theme. The safe theme-revert command removes the mirror only
when its current value still matches the ownership snapshot.

Status-bar and visual preferences use the plug-in SDK's namespaced storage. The
renderer validates field names, preset names, Boolean values, and numeric
ranges. It does not accept custom CSS or a shell command. The file uninstaller
does not have SDK storage access, so it does not delete this private preference
record. Use **Reset to original** before removal when you do not want custom
values to return after a reinstall.

## Backend data and privacy

The backend route accepts one optional session identifier, limited to 256
characters. It opens the Hermes session database in read-only mode. It returns:

- provider-reported cost status and actual cost, when present;
- working directory and git branch;
- model and provider;
- reasoning effort and priority mode;
- system RAM and NVIDIA VRAM readings.

It does not return prompt text or message text. Working directories, branch
names, model routes, and provider names are still session metadata. Treat them
as private when you share screenshots or logs.

RAM comes from `psutil` and covers the complete backend host. VRAM comes from a
fixed, no-shell `nvidia-smi` query with a two-second timeout. It sums all
reported NVIDIA devices. These readings are not limited to the Hermes process,
the active model, or the selected session.

Cost is shown only when Hermes records `actual` or `included`. Missing,
estimated, unknown, and unreadable values stay unknown. The renderer computes a
completed-turn token average from public events. It does not claim live decoder
throughput.

For a remote Hermes profile, install the backend files and config entry under
the remote backend host's `HERMES_HOME` with
`--no-desktop-plugin --plugin-backend --no-pets`. The readings and session
metadata then describe that remote host. The renderer calls only its
profile-aware Hermes backend route. The Pack does not send this data to an
external service.

## Restore-only migration

`scripts/migrate-to-plugin.mjs` removes an old Pack source patch before a Hermes
update. It does not install the renderer or backend. It restores a file only
when exact git-blob checks prove both conditions:

- the `.orig` file is the current `HEAD` version of that path;
- the current file is the recorded or bundled Pack post-edit file.

Migration stops before any write for an unproved, user-edited, or deleted
current file. It does not run `git reset`, remove a stash, rebuild Hermes, or
discard unrelated changes. The safe order is migration, `hermes update`, Pack
install, and a full Hermes restart.

## Legacy paths

The following paths are not part of the recommended architecture:

- `advanced/statusbar/` is the old renderer and Electron source patch;
- `advanced/extras-caduceus/` is the old backdrop and loader source patch;
- `advanced/watcher/` is an old update reminder;
- `theme/apply-theme.mjs` is an old DevTools and local-storage helper.

Keep these files for forensic reference and removal of an old install. Do not
apply them to a current Hermes checkout.

## Network

The installer and migration make no external network request. `git clone`,
`git pull`, and `hermes update` use the network because the user starts those
separate commands.

## Removal

Use an explicit target and preview it:

```bash
node scripts/uninstall.mjs --dry-run --home "<HERMES_HOME>"
node scripts/uninstall.mjs --home "<HERMES_HOME>"
node scripts/uninstall.mjs --home "<HERMES_HOME>" --theme-cleaned
```

The uninstaller reverses a managed renderer, backend, or current-format pet file
only when its live hash still matches the installed receipt. It restores a
prior file only after it verifies the backup hash. It restores the backend
config membership and pet block only when later user changes are not present.
It leaves protected or changed items in place and keeps their stamps for a safe
retry.

For a legacy source file, the uninstaller requires an installed git blob in the
receipt. The current file must match that blob, and `.orig` must match the same
path at current `HEAD`. The theme-revert command removes only a mirror that
matches its ownership snapshot. It changes the active theme and mode only when
it removed that mirror and Classic Gold is still selected. The first run keeps
the renderer ownership stamp. Use `--theme-cleaned` only after the renderer
command reloads Hermes.

Never delete the full `HERMES_HOME`, `desktop-plugins`, `plugins`, or `pets`
directory. Fully restart Hermes Desktop after install or removal so the managed
Python route can load or unload.
