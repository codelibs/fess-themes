# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A collection of static themes for Fess. Each `themes/<name>/` is a self-contained SPA
(`index.html` + `assets/` + `i18n/` + `help/`) declared by a `theme.yml` manifest
(`apiVersion: fess.codelibs.org/v1`, `kind: StaticTheme`) and talks to the server over
`/api/v2/*`. There is no build step: the files under `themes/<name>/` are the shipped
artifact, served at `/themes/<name>/`.

See `README.md` for the theme list, repository layout, and install instructions.

## Commands

```bash
./scripts/package.sh <name> [<name> ...]   # → dist/<name>-<version>.zip
./scripts/package.sh --all                 # every theme under themes/
```

`zip` is required; `yq` is used if present, else the `^version:` grep fallback (below).
The script checks only that the theme dir, `theme.yml`, and a non-empty version exist — it
does **not** validate the version against the server's SemVer pattern, so a malformed
version packages fine and only fails at install with `INVALID_VERSION`.

**There is no build, no CI, no test runner, and no dev server.** A theme cannot be
previewed from `file://`: it is an SPA on absolute `/themes/<name>/` paths calling
`/api/v2/*`, so it only runs when served by Fess. The loop is package → upload at
**Admin → Theme** (`/admin/theme/`) → activate, or set `theme.default=<name>` in
`fess_config.properties` against a running Fess 15.7+.

## Theme versioning

**Every theme carries its own `version` in `themes/<name>/theme.yml`. Bump it in the same
commit as the change — a change to a theme's shipped files without a version bump is
incomplete.** Versions are per-theme and independent; only bump the themes you actually
touched, and leave the rest alone.

### Which part to bump

`version` is `MAJOR.MINOR.PATCH`:

- **PATCH** (`1.0.0` → `1.0.1`) — bug fixes and hardening with no new user-facing
  capability: sanitizer/security fixes, CSS or copy tweaks, a11y corrections, refactors.
- **MINOR** (`1.0.1` → `1.1.0`) — backwards-compatible additions: a new user-facing
  feature or panel, new i18n keys or locales, new optional `theme.yml` fields.
- **MAJOR** (`1.1.0` → `2.0.0`) — breaking changes: raising `minFessVersion`, dropping
  locales or features, renaming the theme, or depending on a new/incompatible server API.

### When a bump is *not* needed

`scripts/package.sh` excludes `README.md` and `DESIGN.md` from the ZIP, so edits confined
to those files change nothing that ships and need no bump. Everything else under
`themes/<name>/` ships — bump it.

### Format constraint (enforced by the server)

Fess validates the field against `ThemeManifest.SEMVER_PATTERN` in the `fess` repo
(`src/main/java/org/codelibs/fess/theme/ThemeManifest.java`), a subset of SemVer 2.0:

```
^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$
```

Three numeric parts are required; a pre-release suffix (`1.1.0-rc.1`) is allowed; SemVer
build metadata (`1.0.0+build.5`) is **not**. The field is mandatory, and a value outside
this pattern fails theme install with `INVALID_VERSION`.

Keep it as a quoted single-line scalar at column 0 (`version: "1.0.1"`): `package.sh`'s
fallback path, used when `yq` is absent, greps for `^version:` and cannot see it in any
other position or style.

### Where the version actually surfaces

- `scripts/package.sh` names the artifact `dist/<name>-<version>.zip`.
- Fess echoes it in the `/api/v2/ui/config` theme payload (`UiConfigHandler`).
- The admin UI lists it under **Admin → Theme** (`AdminThemeAction`, `admin_theme.jsp`).

Fess does **not** compare theme versions — there is no upgrade detection, and reinstalling
a same-named theme replaces it unconditionally, whatever the versions are. The version is
for humans and for identifying artifacts, which is exactly why it has to be truthful.

When bumping, grep for stale `dist/<name>-<version>.zip` examples in the root `README.md`
and in `themes/<name>/README.md` and update them to match.

## Shared core files

Every theme carries its own copy of the same core modules. The copies are identical
**except for the per-theme module comment on line 2** — they are not byte-identical, so a
plain `md5` reports a difference for every theme and tells you nothing.

Identical across all 8 themes (line 2 aside):

```
advance.js  cache.js  error.js  format.js  markdown.js  profile.js  router.js
```

Identical across 7, with `codesearch` diverged: `api.js`, `auth.js`.
`chat.js` splits 6 / `codesearch` / `docsearch`.
`compat.js` / `help.js` / `i18n.js` differ only by name-bound `/themes/<name>/` paths.
`assets/logo.png` and `assets/logo-head.png` are byte-identical across all 8.

`codesearch` is the usual outlier — it is the oldest lineage and its `theme.yml` also omits
the `author` / `description` / `license` / `homepage` the other 7 carry.

`assets/format.js` (the HTML sanitizer) has a 9th copy in the `bootstrap` reference theme
of the `fess` repo (`src/main/webapp/themes/bootstrap/assets/format.js`), and some theme
READMEs assert identity with it.

**When patching a shared core file, patch every copy in the same PR and bump every
affected theme**, otherwise the identity claims silently become false. Nothing enforces
this — there is no CI. Verify with a hash that ignores the comment line:

```bash
for f in themes/*/assets/format.js ../fess/src/main/webapp/themes/bootstrap/assets/format.js; do
  printf '%s  %s\n' "$(sed '2d' "$f" | md5 -q)" "$f"
done | sort   # a single distinct hash = all copies in sync
```

## Conventions

- Vanilla JS ES modules, no bundler, no framework, no CDN — a strict CSP blocks external
  hosts, so no Google Fonts and no inline scripts. Self-host fonts; use a classic `<head>`
  script for FOUC-safe theming.
- Asset paths inside a theme are absolute and name-bound (`/themes/<name>/assets/...`), so
  renaming a theme means updating `theme.yml#name`, `#displayName`, and every path.
- i18n lives in `i18n/messages.<locale>.json`. Every theme ships **16** message bundles and
  **8** `help/<locale>.json` bundles, but 7 of the 8 themes declare only 8 locales in
  `theme.yml#supportedLocales` (`codesearch` declares all 16) — the undeclared bundles ship
  but the server never lists them. Keep key parity across *every shipped bundle*, not just
  the declared ones. `help.js` falls back to `help/en.json` for locales with no help bundle.
- **A missing i18n key renders as the raw key, not as English.** `i18n.js` loads exactly one
  bundle and `t()` returns `messages[key] || key`; the English fallback only fires when the
  whole bundle fails to fetch, never per key. So a key present in `messages.en.json` but
  absent from `messages.de.json` puts the literal text `facets.empty` on the page for German
  users. This is why parity is load-bearing rather than cosmetic — check it before shipping.

## Gotchas

- **"No Bootstrap" means a shim, not an absence.** `assets/compat.js` re-implements the
  Bootstrap 5 JS API (Modal / Collapse / Dropdown / Offcanvas / Tooltip) onto
  `window.bootstrap`, because the SPA modules still use `data-bs-*` attributes and
  `getOrCreateInstance()`. It is a classic `defer` script and **must** run before `app.js`
  (`type="module"`) — see the load-order comment in any `index.html`. Break it and the
  login modal, facet offcanvas, and search-options drawer break in every theme.
- **`thumbnail.png` ships.** Only `README.md` and `DESIGN.md` are excluded from the ZIP, so
  a thumbnail change needs a version bump like any other shipped file. Constraints:
  ≤512KB, ≤512×512, declared as `theme.yml#thumbnail`.
- **New themes are copied from `docuforge`**, the de-facto baseline. The most common
  copy-paste defect is a leftover `/themes/<baseline>/` path or baseline brand string in
  the copy — grep for both (case-insensitively) before opening the PR.
