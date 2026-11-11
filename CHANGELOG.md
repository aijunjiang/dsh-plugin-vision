# Changelog

Notable changes to this plugin. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-11-11

Supports **DSH 0.2.x** (verified on `0.2.2-rc.1`).

### Fixed

- **The configuration page appears again.** DSH 0.2.x renamed and relocated the
  plugin settings API; the old calls registered into a surface that no longer
  existed, so the card silently never rendered — the plugin loaded, the tools
  worked, and there was nothing to configure.

### Changed

- `ctx.settingsScope.bind({ namespace })` → `ctx.configForms.get(entryId)`.
  The returned form keeps the same `getSnapshot` / `subscribe` / `mutate` /
  `set` / `unset` contract, so the card's data plumbing is unchanged.
- `settings.plugin.item` → `plugins.bundle.config`. A bundle's configuration now
  lives on its own page in the Plugins view. The slot is keyed by **package
  name** while the form it writes stays the **entry id** (`vision`) — the two
  spellings differ on purpose and either one wrong is silent.
- Every `Config` field is marked `.volatile()`. The host derives a form only
  from fields whose nearest volatile ancestor makes them editable; an unmarked
  schema yields no form at all, with no error.
- Adds the `@deepseek-ai/dsh-client-ui-plugin-manager` client dependency:
  `plugins.bundle.config` is declared by that package, so the row does not
  render without it.
- The README points at the Plugins view rather than the Settings page, which now
  only lists plugins read-only.

## [0.1.0] — previous

See the repository history.
