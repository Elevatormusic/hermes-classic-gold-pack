# Broken-update fix — recovery playbook

**Use this when a Hermes-Agent update finished but the Classic Gold pack looks
broken, or re-applying the pack after an update fails to build.** This is the
single place that maps every known symptom to its cause, the exact fix, and
where the fix files live. It's what the install/repair prompts fall back to.

If you'd rather have an assistant do it, paste the [one-line prompt](#one-line-ai-prompt)
at the bottom — it reads this file and self-heals.

---

## Why this happens (read this once)

Hermes-Agent is **not** a normal installed app — it's a **git checkout that
rebuilds itself from source**. An update runs, in order:

1. `git reset --hard origin/main` — moves your checkout to the new version and
   **discards every source-level change** (this is a hard reset, not a merge —
   it fires no git hooks and keeps nothing in the working tree).
2. `hermes desktop --build-only` — `tsc` + `vite` + `pack` (rebuilds the app).
3. relaunch.

So **every update reverts the whole advanced tier** — the status bar *and* the
caduceus extras. What **survives** an update:

- **Theme colours** — stored in the app's localStorage, not in source.
- **Pets** — live in `HERMES_HOME/pets/` + `config.yaml`, outside the checkout.

What **dies** every update and must be re-applied: the **status bar**
(`TelemetryTape` HUD + RAM/VRAM IPC + composer dock-offset + model-pill hide) and
the **caduceus extras** (background watermark, pixel wordmark, loader).

**So 90% of "my update broke the theme" is simply: the advanced tier wasn't
re-applied, or was only half re-applied.** Start here:

## First move — re-apply, idempotently

```bash
# 1) From a clean base for the patched files (prevents a dirty index / half-state):
cd <hermes-agent>/apps/desktop
git status                 # see what's modified

# 2) Re-apply BOTH advanced tiers (order doesn't matter; both are needed):
node <pack>/advanced/statusbar/apply-statusbar.mjs
node <pack>/advanced/extras-caduceus/apply-caduceus.mjs

# 3) Verify BEFORE packing, then pack (Hermes fully quit):
cd <hermes-agent>/apps/desktop
npx tsc -p . --noEmit      # must exit 0
npm run pack               # regenerates the packaged app
# relaunch Hermes
```

If a patch is **rejected** because your Hermes version differs from the pack's
base commit, don't force it — switch to the adaptive path: **[`ai/repair.md`](repair.md)**
(an assistant ports the *intent* of each change into your current files).

The pack's base commit is the `BASE` constant in
[`advanced/apply-common.mjs`](../advanced/apply-common.mjs) — the exact
`NousResearch/hermes-agent` commit the patches and `files/` target. If your
`git rev-parse HEAD` differs from it, expect the repair path.

---

## Symptom → cause → fix

| Symptom | Cause | Fix |
|---|---|---|
| App builds but **blank / white window** | `dist/` was hand-copied into `app.asar.unpacked` — Vite content-hashes asset names, so the asar file table points at the old hashes → `ERR_FILE_NOT_FOUND`. (An overwritten `index.html` masks it.) | **Never hand-copy `dist/`.** Only `npm run pack` regenerates the asar file table. Check `errors.log` via `node <pack>/scripts/diagnostics.mjs --logs`. |
| `tsc` fails: **`Property 'zoom' does not exist`** on `window.hermes` (or another bridge API) | A full-file fallback copied the pack's **base** `global.d.ts`, which predates a newer renderer bridge API on your version. | Keep **your** current `global.d.ts`; splice in **only** the pack's added declaration (`getSystemResources`). Same rule for `types/hermes.ts`. **Never full-file-overwrite `.d.ts` / `types`.** |
| `tsc` fails: **`Property 'getSystemResources' does not exist`** referenced by `use-system-resources.ts` | An **old orphan** hook file survived the update (untracked files aren't reverted) and points at an API the current pack moved. | Delete `src/app/shell/hooks/use-system-resources.ts`. The current pack folds system-resources into the Electron IPC (`electron/main.cjs` + `preload.cjs`), not a renderer hook. |
| **Prompt box / composer missing** or hidden behind the status bar | Half-applied dock-offset clamp — the thread viewport was reserved but the composer wasn't lifted (or vice-versa). | Apply **all** `--composer-dock-offset` consumers together: `styles.css` (the var + `--thread-viewport-height` + `--thread-last-message-clearance` + `aui_intro` padding), `app/chat/composer/index.tsx` (both `bottom-` anchors), `components/assistant-ui/thread/index.tsx`, `app/chat/scroll-to-bottom-button.tsx`, `components/assistant-ui/tool/approval.tsx`. |
| **Gold status tape missing**, or **background watermark + pixel wordmark missing** | Only one tier was re-applied. The update reverts **both**. | Re-apply **both**: `apply-statusbar.mjs` **and** `apply-caduceus.mjs`. |
| **Tape shows no RAM/VRAM** (blank where `21.7/24G · 45/63G` should be) — **no** console or build error | On a hand-reconciled/diverged install the renderer reads `window.hermesDesktop.getSystemResources`, but the `hermes:system-resources` handler (`electron/main.cjs`) and/or the `getSystemResources` bridge (`electron/preload.cjs`) are missing → it reads `undefined` and silently returns `null`, so it looks like a styling bug. | Port the handler (RAM via `os`, VRAM via `nvidia-smi`) into `main.cjs` and the `getSystemResources: () => ipcRenderer.invoke('hermes:system-resources')` bridge into `preload.cjs`. Re-applying the statusbar tier includes both. |
| **Model-select pill reappeared** in the prompt box | The composer model-pill hide wasn't re-applied. | Re-apply the statusbar tier — it adds `data-slot="composer-model-pill"` in `app/chat/composer/controls.tsx` + the `@media (min-width:880px){ … display:none }` rule in `styles.css`. |
| **Status bar spills under the left sidebar / tape off-center** | The stock footer is meant to follow the chat pane by reading the sidebar width from the layout store (`$sidebarWidth`/`$sidebarOpen`/`$panesFlipped` → `leftInset` in `statusbar-controls.tsx`); the tape rides along via `left:50%` of the confined footer. `--pane-chat-sidebar-width` does **not** reach the footer (it only exists inside `PaneShell`; the footer is a sibling). | Re-apply the statusbar tier, or check the `leftInset` computation + the footer's `left` inline style in `statusbar-controls.tsx` — not a `--pane-chat-sidebar-width` var. |
| **Patch rejected**: `git apply` → `does not match index` / `patch does not apply` | Version divergence from the base commit, **or** a prior install left files staged in the git index. | `git checkout -- <target paths>` (or `git restore`) to reset to clean base, then re-apply. If it still rejects, the version genuinely diverged → **[`ai/repair.md`](repair.md)**. |
| **Theme colours reverted** (layout is fine) | Theme is localStorage — usually survives, but a profile/localStorage reset clears it. | Re-paste `theme/install-theme.js` in DevTools console (see main README). |
| **Pets gone** | `HERMES_HOME/pets/` cleared or `config.yaml` `display.pet` reverted. | `node <pack>/install.mjs --activate <slug>`. |

---

## Where the fix files live

- **Base commit** → `advanced/apply-common.mjs` (`BASE` constant). Compare with `git rev-parse HEAD`.
- **Status bar tier** → `advanced/statusbar/`
  - `hermes-statusbar.patch` — the exact intended diff
  - `files/apps/desktop/src/…` — the full **post-edit** files (the source of truth to merge from)
  - `apply-statusbar.mjs` — the installer (backup → `git apply --3way` → copy-fallback → pack)
- **Caduceus extras** → `advanced/extras-caduceus/` — `hermes-caduceus.patch`, `files/…`, `apply-caduceus.mjs`
- **Core (theme / pets)** → `install.mjs`, `theme/install-theme.js`, `pets/`
- **Diagnostics** → `node scripts/diagnostics.mjs --logs` (dumps env + tails `errors.log` / `desktop.log`)

## Golden rules (that prevent every failure above)

1. **Deploy only with `npm run pack`**, Hermes fully quit. Never hand-copy `dist/`.
2. **`.d.ts` / `types` are additive-only** — splice in the pack's declarations; never overwrite the whole file.
3. **Reset target paths to a clean base before patching**, and **delete stray orphan files** the update left behind.
4. **`npx tsc -p . --noEmit` must pass before you pack.** Read the pack output for errors.
5. After an update, **re-apply both tiers** — statusbar *and* caduceus.

## Still stuck?

File an issue with your diagnostics output — see **[`ai/issuereport.md`](issuereport.md)**.
Include: your `git rev-parse HEAD`, the failing `tsc`/`pack` output, and a
screenshot of the broken area.

---

## One-line AI prompt

Paste this into your coding assistant (it's what "gets called" when an install
fails after an update):

```
My Hermes-Agent updated and the Classic Gold pack (github.com/Elevatormusic/hermes-classic-gold-pack)
is broken. Read ai/brokenupdatefix.md in the pack. Diagnose which failure mode I
hit from my `npx tsc -p . --noEmit` output, my `npm run pack` output, and a
screenshot of the broken area. Apply the matching fix (re-applying BOTH advanced
tiers if the theme is missing; never full-file-overwrite .d.ts; delete orphan
files; reset target paths to clean base before patching). Rebuild with
`npm run pack` and verify. Self-heal up to 3 times before asking me anything —
and if you must ask, do it in ONE message.
```
