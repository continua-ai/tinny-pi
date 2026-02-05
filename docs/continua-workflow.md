# Continua Workflow

This document captures how we keep `continua-ai/tinny-pi` clean and easy to sync with upstream `badlogic/pi-mono`.

## Sync-first policy

- **Always sync upstream first.** Merge/rebase `upstream/main` into the working branch before making local changes.
- If a sync is in progress, **do not touch changelogs** until the sync completes.

## PR policy

- All changes to `main` must go through a pull request.
- Agents may open PRs when asked; prefer PRs even for small changes.
- Do not push directly to `main` or bypass branch protections.
- Push branches to the `tinny` remote; `origin` is upstream (`badlogic/pi-mono`) and must remain fetch-only.

## Testing policy

- Always run `npm run check` after code changes.
- For substantial changes, run the full test suite (`npm run test`) unless explicitly waived.

## Local install (avoid clobbering upstream)

- Build first: `npm install` then `npm run build` (or build the dependent workspaces).
- Install to an isolated prefix: `npm install -g --prefix ~/.tinny-pi ./packages/coding-agent`.
- Run via `~/.tinny-pi/bin/pi` or `alias tinny-pi="$HOME/.tinny-pi/bin/pi"`.
- Do not run `npm install -g ./packages/coding-agent` without `--prefix` (it overwrites upstream `pi`).

## Changelog policy

- Update `packages/*/CHANGELOG.md` only **after** the upstream sync.
- Keep entries minimal, and only under existing `### Added/Changed/Fixed/Removed/Breaking Changes` sections.
- Prefer a **separate, small commit** for changelog edits after code changes are settled.

## Fork-specific changes

- Keep diffs **small, additive, and opt-in** by default.
- Prefer wrappers and new components over core refactors.
- **Extension-first**: if a feature can live in pi-lab, implement it there; only change core for layout/rendering needs, input plumbing, or new extension hooks.
- Document settings/migrations whenever we introduce a fork-only option.

## UI/TUI direction

- Primary approach: extend `packages/tui` with **viewport-aware rendering** to support sticky headers and block-level UI.
- If viewport-aware rendering becomes too complex or unstable, evaluate migrating to **terminal-kit**.
- Avoid forking the TUI package; layer changes as additive APIs where possible.

## Fork toggles and performance options

- Master toggle: `terminal.continuaUi` disables all Continua-specific UI differences (output-only scroll + sticky headers), restoring upstream `pi` behavior.
- Mouse interactions are controlled by `terminal.mouseTracking` (default off to preserve terminal selection).
- Add per-feature toggles for performance-sensitive behaviors (e.g., git polling), **default on**.
- Keep these toggles documented and opt-in to disabling, not opt-in to enabling.

## Docs and assets

- Avoid adding binary assets unless required.
- Prefer linking to upstream docs/assets instead of copying them.
- If a new asset is necessary, keep it **small (PNG/SVG)** and scoped to the relevant package docs.
- Do not add videos/gifs without explicit approval.

## Release hygiene

- Sync upstream, then update changelogs, then release.
- Keep the fork version aligned with upstream unless we intentionally diverge (document why).
