# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A collection of static themes for Fess. Each `themes/<name>/` is a self-contained SPA
(`index.html` + `assets/` + `i18n/` + `help/`) declared by a `theme.yml` manifest
(`apiVersion: fess.codelibs.org/v1`, `kind: StaticTheme`) and talks to the server over
`/api/v2/*`. There is no build step: the files under `themes/<name>/` are the shipped
artifact, served at `/themes/<name>/`.

See `README.md` for the theme list, repository layout, and install instructions.

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

Several themes carry byte-identical copies of shared core modules — most notably
`assets/format.js` (the HTML sanitizer), which also has a counterpart in the `bootstrap`
reference theme in the `fess` repository. Some theme READMEs assert byte-identity with
that reference copy.

**When patching a shared core file, patch every copy in the same PR and bump every
affected theme**, otherwise the identity claims silently become false. Copies are expected
to differ only in a per-theme module comment; verify with a hash over the rest.

## Conventions

- Vanilla JS ES modules, no bundler, no framework, no CDN — a strict CSP blocks external
  hosts, so no Google Fonts and no inline scripts. Self-host fonts; use a classic `<head>`
  script for FOUC-safe theming.
- Asset paths inside a theme are absolute and name-bound (`/themes/<name>/assets/...`), so
  renaming a theme means updating `theme.yml#name`, `#displayName`, and every path.
- i18n lives in `i18n/messages.<locale>.json`; keep key parity across the locales a theme
  declares in `theme.yml#supportedLocales`.
