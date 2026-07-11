# hermes-classic-gold-pack — Agent Guide

Guidance for AI agents (Codex, Claude Code, etc.) working in this repo. This is
an installer/patcher: it applies the Classic Hermes gold theme, Noir Neko pets,
and a custom status bar into a user's real Hermes desktop install. Because it
writes into a live install and into the user's `hermes-agent` checkout, the
overriding value is **do no harm to the user's existing setup**.

## What this pack is

- A Node ESM CLI (`install.mjs`, `update-hermes.mjs`, `scripts/*.mjs`), `type: module`, Node `>=18`.
- It patches/copies files into `HERMES_HOME` and an `apps/desktop` checkout, then records what it did so the change can be updated or undone.
- Three optional tiers live under `advanced/`: `statusbar`, `caduceus`, `watcher`.

## Build, test, lint

- `npm test` → `node --test` (the repo's built-in test runner; test files are `test/*.test.mjs`).
- No build step for the pack itself; `install.mjs` may drive `npm run pack` inside the target `hermes-agent` checkout.
- CI runs `github/super-linter`: **gitleaks** (secrets), **eslint** (JS), YAML/actionlint, bash, and JSON are enforced on changed files. `markdownlint` uses `.github/linters/.markdown-lint.yml` (MD013/MD040/MD022/031/032/033 relaxed). Natural-language and jscpd linters are intentionally off.

## Conventions

- **ESM only** (`.mjs`, `import`/`export`). No CommonJS in pack code (the `advanced/statusbar/files/**` Electron `.cjs` files are payloads copied into Hermes, not pack logic).
- **Dependency injection for testability.** Core functions in `lib/` accept injectable `env`, `platform`, `exists`, and `nowIso` params defaulting to the real ones (see `lib/preflight.mjs`, `lib/hermes-home.mjs`, `lib/pack-stamp.mjs`). New logic should follow this so tests need no real filesystem or clock.
- **JSDoc typedefs** on exported functions (params and return shape), matching the existing modules.
- **Corrupt state files are treated as absent**, never fatal — JSON reads are wrapped and fall back (see `readJson` in `lib/pack-stamp.mjs`).

## Invariants — do not break these

1. **Every apply path writes the stamp and manifest.** `lib/pack-stamp.mjs` is the single source of truth for "what's installed" (`hermes-classic-gold-pack.json`) and "how to undo it" (`.manifest.json`). Patch, copy, reconcile, and `--no-build` staging must all stamp, or update/uninstall/watch go blind.
2. **Never silently target an ambiguous install for a write.** An explicit `--home`/`--repo` is authoritative — use it or fail; never fall back to auto-detection (a typo must not hit the user's real install). When auto-resolution is ambiguous (`findHermesHomes` returns more than one), index 0 is a *guess* — confirm before writing.
3. **Uninstall must reverse via the manifest**, not by guessing — the manifest's undo receipts are the contract.
4. **Idempotency.** Re-running an apply must not double-patch or corrupt a partially-applied tier; tier sentinels (`TIER_SENTINELS`) detect an already-applied or reverted state.
5. **Cross-platform paths.** This pack is Windows-first but must not hardcode separators or assume `win32`; use `node:path` and the `platform` param. Compare paths structurally, not as raw strings.

## Review guidelines

When reviewing a PR in this repo, flag (roughly in priority order):

- **P0 — data loss risk:** any apply/patch/copy path that can write into `HERMES_HOME` or the `hermes-agent` checkout **without** recording a stamp + manifest entry, or any uninstall/revert that deletes user files not tracked by the manifest.
- **P0 — wrong-target writes:** auto-resolving an ambiguous `HERMES_HOME`/repo and writing to it without confirmation; treating an explicit `--home`/`--repo` as a hint instead of authoritative.
- **P0 — secrets:** any hardcoded token, key, or path containing a real username committed to the tree (gitleaks will also catch this; call it out anyway).
- **P1 — non-idempotent apply:** a change that double-patches on re-run, or that doesn't update `TIER_SENTINELS` when it adds/renames a tier marker.
- **P1 — untestable logic:** new `lib/` code that reaches for the real `fs`/`env`/`Date`/`process.platform` directly instead of injectable params, so it can't be unit-tested the way the rest of the module is.
- **P1 — cross-platform breakage:** hardcoded `\\` or `/`, `win32`-only assumptions in shared code, or string path comparisons that fail across separators.
- **P1 — missing test:** a bug fix without a `test/*.test.mjs` case reproducing it, or a new `lib/` export with no coverage.
- **P2 — style:** CommonJS creeping into pack logic, missing JSDoc on new exports, or JSON reads that don't fall back on corruption.

Keep reviews focused on P0/P1. This is a small, careful codebase — prefer a few high-signal findings over a long list of nits the linters already cover.
