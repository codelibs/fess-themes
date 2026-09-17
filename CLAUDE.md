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

node scripts/verify-bundles.mjs            # locale-bundle contract, every theme
node scripts/verify-bundles.mjs <name>     # one theme

./scripts/verify-versions.sh [<base-ref>]  # fail if shipped files changed without a
                                            # version bump (default base: origin/main)

BASE_URL=<repository tree URL> ./scripts/stage-maven.sh [<theme> ...]
                                            # the deploy job's staging step: stages
                                            # unpublished theme versions under
                                            # dist/upload for the job to copy into
                                            # place; the upload target lives only in
                                            # the job, never in this repository
```

`zip` is required; `yq` is used if present, else the `^version:` grep fallback (below).
`scripts/lib/version.sh#read_theme_version` (shared by `package.sh`, `stage-maven.sh` and
`verify-versions.sh`) validates the extracted value against the same SemVer-subset
pattern the server enforces (see below) and prints nothing when it doesn't match, so a
malformed `version` fails `package.sh` with "could not read version" rather than
packaging — it never reaches the server to fail there with `INVALID_VERSION`.

`verify-bundles.mjs` is plain node with no dependencies — no install, no package.json.
Three GitHub Actions workflows run in this repository, each enforcing something
different:

- `.github/workflows/verify-bundles.yml` runs `verify-bundles.mjs` over every theme, on
  push and PR: checks only the locale-bundle contract — a bundle for every locale
  `i18n.js` serves, i18n key parity across them, and help section-id parity.
- `.github/workflows/verify-versions.yml` runs `scripts/verify-versions.sh` on PR: fails
  when a theme's shipped files changed but `theme.yml#version` still matches the base
  branch (see "Theme versioning" below).
- `.github/workflows/theme-js.yml` runs the `test/` npm suite, on push, PR and manual
  dispatch: unit tests for the shared core JS modules.

Nothing outside these three is enforced anywhere.

**There is no build, no test runner, and no dev server.** A theme cannot be
previewed from `file://`: it is an SPA on absolute `/themes/<name>/` paths calling
`/api/v2/*`, so it only runs when served by Fess. The loop is package → upload at
**Admin → Theme** (`/admin/theme/`) → activate, or set `theme.default=<name>` in
`fess_config.properties` against a running Fess 15.9+.

## Theme versioning

**Every theme carries its own `version` in `themes/<name>/theme.yml`. Bump it in the same
commit as the change — a change to a theme's shipped files without a version bump is
incomplete.** Versions are per-theme — only bump the themes you actually touched — though
every theme's `major.minor` is the same Fess line.

### The version scheme

`version` is `<Fess major.minor>.<patch>`: `15.8.0`, `15.8.1`, … When the Fess line
moves, the patch resets to `0` and renumbering starts over on the new line (e.g.
`15.9.0`).

`theme.yml#version`'s `major.minor` and `theme.yml#minFessVersion` **must always
agree**. A change that raises `minFessVersion` bumps the version onto the new line in
the same commit.

### When to bump

Bump the patch whenever a shipped file changes — anything under `themes/<name>/`
except `README.md` and `DESIGN.md`, which `scripts/package.sh` excludes from the ZIP
and which therefore ship nothing.

**A change without a version bump is never distributed.** Deployment only adds a
version that doesn't already exist there; it never overwrites one that's already out.
`scripts/verify-versions.sh`, wired into every pull request by
`.github/workflows/verify-versions.yml`, fails the PR when a theme's shipped files
changed but its `theme.yml#version` still matches the tip of the base branch.

### No `maxFessVersion`

There is no `maxFessVersion` field. A theme that stops working on a newer Fess line
is expressed by not publishing a version on that line, not by declaring a ceiling.

### Format constraint (enforced by the server)

Fess validates the field against `ThemeManifest.SEMVER_PATTERN` in the `fess` repo
(`src/main/java/org/codelibs/fess/theme/ThemeManifest.java`), a subset of SemVer 2.0:

```
^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$
```

Three numeric parts are required; a pre-release suffix (`1.1.0-rc.1`) is allowed; SemVer
build metadata (`1.0.0+build.5`) is **not**. The field is mandatory, and a value outside
this pattern fails theme install with `INVALID_VERSION`.

Keep it as a quoted single-line scalar at column 0 (`version: "15.8.0"`): `package.sh`'s
fallback path, used when `yq` is absent, greps for `^version:` and cannot see it in any
other position or style.

### Where the version actually surfaces

- `scripts/package.sh` names the artifact `dist/<name>-<version>.zip`.
- Fess echoes it in the `/api/v2/ui/config` theme payload (`UiConfigHandler`).
- The admin UI lists it under **Admin → Theme** (`AdminThemeAction`, `admin_theme.jsp`).

Fess validates the version's format against `ThemeManifest.SEMVER_PATTERN` (above); a
value outside it fails install with `INVALID_VERSION`. It does **not** compare theme
versions to each other — there is no upgrade detection, and reinstalling a same-named
theme replaces it unconditionally, whatever the versions are. `minFessVersion` is
currently informational: the server reads it and checks its length, but never compares
it against the running Fess version, so the version's own line is the operative
compatibility signal — which is exactly why it has to be truthful.

When bumping, grep for stale `dist/<name>-<version>.zip` examples in the root `README.md`
and in `themes/<name>/README.md` and update them to match.

## Shared core files

Every theme carries its own copy of the same core modules. For most of them the copies are
identical **except for the per-theme module comment on line 2** — they are not byte-identical,
so a plain `md5` reports a difference for every theme and tells you nothing. The exception is
`format.js` and `markdown.js`: their line-2 comment was neutralized to a theme-agnostic string
(`// ... for the Fess static theme SPA.`), so those two are now **fully byte-identical** across
all 10 themes (and the `bootstrap` 11th copy) — a plain `md5` confirms them.

Identical across all 10 themes:

```
format.js  markdown.js                                    (byte-identical, line 2 included)
router.js  api.js  i18n.js  help.js  cache.js  error.js   (byte-identical copies of the fess bootstrap theme)
profile.js                                                (identical, per-theme line-2 comment aside)
```

`router.js`, `api.js`, `i18n.js`, `help.js`, `cache.js` and `error.js` are copied unchanged
from `src/main/webapp/themes/bootstrap/assets/` in the fess repository, at the Fess release
the themes target (`test/parity.test.js` checks that the ten copies stay identical). Update
them by copying the new fess version into every theme, not by editing one copy.

`advance.js` is identical across every theme **except `storefront`**, which imports
`sortOptionsFor()` from its own `storefront.js` so the advanced-search sort select offers
the price/rating sorts the server has no way to advertise. Without them the select omits an
incoming `sort=price.asc`, and submit silently drops it back to relevance order. The
divergence is deliberate — a theme contributing its own sort fields has nowhere else to put
them — so do **not** "restore" it by copying another theme's copy over it.

Identical across 9, with `codesearch` diverged: `auth.js`.
`chat.js` splits 8 / `codesearch` / `docsearch`.
`compat.js` carries no `/themes/` path at all — it differs by header brand plus a
CSS-class prefix (`df-` in eight, `vb-` in `voicebox`, `bs-` in `codesearch`).
`assets/logo.png` and `assets/logo-head.png` are byte-identical across all 10.

`codesearch` is the usual outlier — it is the oldest lineage and its `theme.yml` also omits
the `author` / `description` / `license` / `homepage` the other 9 carry.

`assets/format.js` (the HTML sanitizer) has an 11th copy in the `bootstrap` reference theme
of the `fess` repo (`src/main/webapp/themes/bootstrap/assets/format.js`), and some theme
READMEs assert identity with it.

**When patching a shared core file, patch every copy in the same PR and bump every
affected theme**, otherwise the identity claims silently become false. Nothing enforces
this: CI checks locale bundles only, and never compares these copies. Verify by hand.

`format.js` and `markdown.js` are byte-identical including line 2, so a plain `md5`
(no `sed`) confirms all 11 copies:

```bash
for f in themes/*/assets/format.js ../fess/src/main/webapp/themes/bootstrap/assets/format.js; do
  md5 -q "$f"
done | sort -u   # a single hash = all copies in sync
```

For the other shared modules, whose per-theme line-2 comment still varies, hash with the
comment line stripped:

```bash
for f in themes/*/assets/router.js; do
  printf '%s  %s\n' "$(sed '2d' "$f" | md5 -q)" "$f"
done | sort   # a single distinct hash = all copies in sync
```

`sed '2d'` assumes line 1 is the SPDX header and line 2 the per-theme comment. That holds
for `cache.js` / `error.js` / `profile.js` / `router.js` in every copy, so the recipe above
is sound — but eight files put the brand comment on line 1 and carry no SPDX line at all
(`codesearch`'s `api.js` / `app.js` / `auth.js` / `i18n.js` / `query.js`, `docsearch`'s
`docsearch.js` / `palette.js` / `theme-init.js`). There the recipe deletes a real line and
reports a difference that is not there: it is why `api.js` reads as diverged when its code
matches all 10. Diff before believing the hash.

## Conventions

- Vanilla JS ES modules, no bundler, no framework, no CDN — a strict CSP blocks external
  hosts, so no Google Fonts and no inline scripts. Self-host fonts; use a classic `<head>`
  script for FOUC-safe theming.
- Asset paths inside a theme are absolute and name-bound (`/themes/<name>/assets/...`), so
  renaming a theme means updating `theme.yml#name`, `#displayName`, and every path.
- i18n lives in `i18n/messages.<locale>.json`. Every theme ships **16** message bundles and
  **8** `help/<locale>.json` bundles, but 9 of the 10 themes declare only 8 locales in
  `theme.yml#supportedLocales` (`codesearch` declares all 16) — the undeclared bundles ship
  but the server never lists them. Keep key parity across *every shipped bundle*, not just
  the declared ones. `help.js` falls back to `help/en.json` for locales with no help bundle.
- **A missing i18n key renders as the raw key, not as English.** `i18n.js` loads exactly one
  bundle and `t()` returns `messages[key] || key`; the English fallback only fires when the
  whole bundle fails to fetch, never per key. So a key present in `messages.en.json` but
  absent from `messages.de.json` puts the literal text `facets.empty` on the page for German
  users. This is why parity is load-bearing rather than cosmetic, and why it is the one
  thing CI enforces (`scripts/verify-bundles.mjs`). It has drifted before: `codesearch`
  shipped with keys missing from 14 of its 16 bundles, repaired by hand in #27.

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
