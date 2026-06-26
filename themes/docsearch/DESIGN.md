# DocSearch Theme — Design Document

## Overview

DocSearch is a Fess static SPA theme derived from the **docuforge** baseline. It inherits the
same SPA architecture (LastaFlute-compatible REST API, ES-module JS, single `index.html`) while
introducing a distinct indigo-on-slate design language, a first-class light/dark toggle with no
flash-of-unstyled-content (FOUC), and a self-hosted font stack that works under strict CSP.

## Design Language

| Property | Value |
|---|---|
| Palette | Indigo accent (`#4F46E5`) on slate neutrals (`#0F172A` text, `#E2E8F0` border) |
| Dark palette | Soft indigo (`#818CF8`) on near-black (`#0B1120` page, `#111827` surface) |
| Body font | Inter (self-hosted, OFL) → system-ui fallback chain |
| Mono font | JetBrains Mono (self-hosted, OFL) → ui-monospace fallback chain |
| Border radius | sm 6px / base 10px / lg 14px / pill 9999px |
| Shadows | sm 1px blur / md 16px blur / lg 48px blur (darkened 60% opacity in dark mode) |

### Why no Google Fonts?

Fess deployments are commonly run in air-gapped or strict-CSP environments. Loading fonts from
`fonts.googleapis.com` / `fonts.gstatic.com` requires adding those origins to `font-src` /
`connect-src`, which many customers cannot do. Self-hosting the two Latin woff2 subsets
(Inter + JetBrains Mono, ~115 KB total) keeps `font-src 'self'` sufficient.

Font license: both families are released under the **SIL Open Font License 1.1 (OFL)**.

## Design Token Reference (`--ds-*`)

### Light mode (`:root`)

| Token | Value | Usage |
|---|---|---|
| `--ds-accent` | `#4F46E5` | Primary interactive colour (links, buttons, focus rings) |
| `--ds-accent-hover` | `#4338CA` | Hover state |
| `--ds-accent-subtle` | `#EEF2FF` | Tinted backgrounds (badges, chips) |
| `--ds-bg` | `#FFFFFF` | Page background |
| `--ds-surface` | `#FFFFFF` | Cards / panels |
| `--ds-surface-2` | `#F8FAFC` | Secondary surfaces (sidebars, inset areas) |
| `--ds-text` | `#0F172A` | Body text |
| `--ds-text-muted` | `#475569` | Secondary text, labels |
| `--ds-text-faint` | `#94A3B8` | Placeholder, disabled |
| `--ds-border` | `#E2E8F0` | Default border |
| `--ds-border-strong` | `#CBD5E1` | Emphasized border |
| `--ds-mark-bg` | `#FEF08A` | Search highlight background |
| `--ds-mark-text` | `#422006` | Search highlight text |
| `--ds-success` | `#16A34A` | Success states |
| `--ds-warning` | `#CA8A04` | Warning states |
| `--ds-error` | `#DC2626` | Error states |
| `--ds-info` | `#4F46E5` | Info states |
| `--ds-font-body` | Inter → system-ui | Body / UI text |
| `--ds-font-mono` | JetBrains Mono → ui-monospace | Code / filenames |
| `--ds-radius-sm` | `6px` | Small elements (chips, tags) |
| `--ds-radius` | `10px` | Cards, inputs, buttons |
| `--ds-radius-lg` | `14px` | Modals, large panels |
| `--ds-radius-pill` | `9999px` | Pills, badges |
| `--ds-shadow-sm` | `0 1px 2px rgba(15,23,42,.06)` | Subtle elevation |
| `--ds-shadow-md` | `0 4px 16px rgba(15,23,42,.08)` | Cards |
| `--ds-shadow-lg` | `0 16px 48px rgba(15,23,42,.18)` | Modals, dropdowns |
| `--ds-header-h` | `56px` | Fixed header height |
| `--ds-sidebar-w` | `280px` | Sidebar width |
| `--ds-content-max` | `68ch` | Max reading width |

### Dark mode (`[data-theme="dark"]`)

Overrides only the tokens that differ. Everything else inherits from `:root`.

| Token | Dark value |
|---|---|
| `--ds-bg` | `#0B1120` |
| `--ds-surface` | `#111827` |
| `--ds-surface-2` | `#0F172A` |
| `--ds-text` | `#E5E7EB` |
| `--ds-text-muted` | `#9CA3AF` |
| `--ds-text-faint` | `#6B7280` |
| `--ds-border` | `#1F2937` |
| `--ds-border-strong` | `#374151` |
| `--ds-accent` | `#818CF8` |
| `--ds-accent-hover` | `#A5B4FC` |
| `--ds-accent-subtle` | `#1E1B4B` |
| `--ds-mark-bg` | `#854D0E` |
| `--ds-mark-text` | `#FEF9C3` |
| `--ds-shadow-lg` | `0 16px 48px rgba(0,0,0,.6)` |

### Bootstrap bridge (`--bs-*`)

The `--bs-*` variables the SPA JS/CSS uses are aliased onto `--ds-*` tokens in `:root` so that
components that still reference `--bs-*` work without change. Task 6 will rewrite those
component rules to reference `--ds-*` directly.

## FOUC-Safe Light/Dark Toggle

### How it works

1. **`theme-init.js`** — a classic (non-module) synchronous script placed in `<head>` *before*
   `styles.css`. It reads `localStorage["ds-theme"]` and writes `document.documentElement.dataset.theme`
   before the first paint, eliminating the flash for dark-mode users.

2. **`docsearch.js` exports** — `initThemeToggle()`, `applyTheme(t)`, `currentTheme()`.
   These functions use `document` / `window` / `localStorage` only inside their function bodies,
   never at module top-level, so the pure helpers (`contentTypeIcon`, `deriveBreadcrumb`, …) can be
   imported and unit-tested in a Node.js context without a DOM.

3. **`app.js`** calls `initThemeToggle()` as the very first statement in `main()` (before
   `api.init()`). This syncs the `#theme-toggle` button's `aria-pressed` state and wires the
   click handler + system-preference change listener.

4. The `#theme-toggle` button in `index.html` must carry `aria-pressed` (set at runtime) for
   screen-reader accessibility. AA contrast is met in both light and dark palettes.

## Delta from docuforge

This theme shares the **entire SPA core** with docuforge as a verbatim copy. The points of
intentional divergence are:

| Area | Change |
|---|---|
| `styles.css` | Added `--ds-*` token block + `@font-face` + `[data-theme="dark"]` block above the existing `--df-*` block (Task 4). Task 6 will remove `--df-*` and rewrite component rules to use `--ds-*`. |
| `docsearch.js` | Adds `contentTypeKey`, `contentTypeIcon`, `deriveBreadcrumb` helpers + `initThemeToggle` / `applyTheme` / `currentTheme` exports. |
| `search.js` | `buildResultCard` renders DocSearch-specific card layout (content-type icon, breadcrumb chips). |
| `chat.js` | `prefillFromResult` accepts an explicit `prefillArg` for integration with result cards. |
| `app.js` | Imports and calls `initThemeToggle()` from `docsearch.js`; wires theme toggle in `main()`. |
| `assets/fonts/` | Self-hosted Inter + JetBrains Mono woff2 subsets (OFL). Not present in docuforge. |
| `assets/theme-init.js` | Classic synchronous FOUC-prevention script. Not present in docuforge. |
| `DESIGN.md` | This file. |

## Maintenance Note

**Port upstream fixes from docuforge; do not copy wholesale.** When docuforge updates a shared
module (e.g. `api.js`, `i18n.js`, `router.js`, `auth.js`, `format.js`, `markdown.js`,
`error.js`, `profile.js`, `help.js`, `advance.js`, `cache.js`, `compat.js`), apply the same
patch to the docsearch copy of that file. Only `buildResultCard` in `search.js`, the chat
prefill arg in `chat.js`, and the `initThemeToggle` wiring in `app.js` are intentional
divergences — everything else should stay in sync.
