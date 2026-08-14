# Legacy source patches

The files in this directory are legacy source-patch artifacts. Keep them for
forensic reference and removal of an old install. Do not apply them to a new or
current Classic Gold install.

These patches replace Hermes Desktop source files and require a desktop build.
They target old source baselines. A Hermes update can preserve local checkout
changes and then restore them on a new source version. This can cause a merge
conflict, a failed build, or both.

Use the run-time plug-in against an explicit profile instead:

```bash
node install.mjs --dry-run --home "<HERMES_HOME>"
node install.mjs --home "<HERMES_HOME>"
```

## Remove an existing legacy patch

Migration only restores Pack-owned source files. It does not install the new
renderer or backend. Use this exact order:

```bash
node scripts/migrate-to-plugin.mjs --dry-run --home "<HERMES_HOME>" --repo "<path-to-hermes-agent>"
node scripts/migrate-to-plugin.mjs --home "<HERMES_HOME>" --repo "<path-to-hermes-agent>"
hermes update
node install.mjs --home "<HERMES_HOME>"
```

Then fully quit and start Hermes Desktop. In a non-interactive run, add `--yes`
only after you review the dry run. Migration still refuses an ambiguous
auto-detected profile and any file that lacks exact ownership proof.

The migration uses manifest receipts and git-blob hashes. It restores a current
file only when the `.orig` file matches the same path at current `HEAD` and the
current file matches a known Pack payload. It does not restore a deleted or
user-edited current file. It does not discard unrelated changes.

## Archived contents

- `statusbar/` contains the old TelemetryTape renderer and Electron IPC patch.
- `extras-caduceus/` contains the old backdrop and loader source patch.
- `baselines.json` maps old patches to their source versions. These are not
  run-time compatibility claims.
- `watcher/` contains the old update reminder. Do not register it for a current
  run-time install.

The repository-level `theme/apply-theme.mjs` helper is also a legacy path. The
current renderer contributes its theme through the public plug-in SDK.

If migration stops, follow
[`../ai/brokenupdatefix.md`](../ai/brokenupdatefix.md). Do not force-copy an old
baseline over a current Hermes checkout.
