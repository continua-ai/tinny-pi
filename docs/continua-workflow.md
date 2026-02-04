# Continua Workflow

This document captures how we keep `continua-ai/tinny-pi` clean and easy to sync with upstream `badlogic/pi-mono`.

## Sync-first policy

- **Always sync upstream first.** Merge/rebase `upstream/main` into the working branch before making local changes.
- If a sync is in progress, **do not touch changelogs** until the sync completes.

## PR policy

- All changes to `main` must go through a pull request.
- Agents may open PRs when asked; prefer PRs even for small changes.
- Do not push directly to `main` or bypass branch protections.

## Changelog policy

- Update `packages/*/CHANGELOG.md` only **after** the upstream sync.
- Keep entries minimal, and only under existing `### Added/Changed/Fixed/Removed/Breaking Changes` sections.
- Prefer a **separate, small commit** for changelog edits after code changes are settled.

## Fork-specific changes

- Keep diffs **small, additive, and opt-in** by default.
- Prefer wrappers and new components over core refactors.
- Document settings/migrations whenever we introduce a fork-only option.

## Docs and assets

- Avoid adding binary assets unless required.
- Prefer linking to upstream docs/assets instead of copying them.
- If a new asset is necessary, keep it **small (PNG/SVG)** and scoped to the relevant package docs.
- Do not add videos/gifs without explicit approval.

## Release hygiene

- Sync upstream, then update changelogs, then release.
- Keep the fork version aligned with upstream unless we intentionally diverge (document why).
