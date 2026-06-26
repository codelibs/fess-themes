# DocSearch — Fess Documentation-Search Static Theme

DocSearch is a **self-contained** Fess static theme built for documentation-search
use cases. It ships **no Bootstrap** and applies the *DocSearch design language*
(indigo/slate palette, self-hosted Inter + JetBrains Mono, FOUC-safe light/dark
mode) to deliver a developer-grade search experience: a ⌘K / Ctrl+K command
palette with instant grouped results, breadcrumb result cards, persistent faceted
navigation, and an optional cited Ask-AI (RAG) mode.

Activate it by setting `theme.default=docsearch` in the admin UI
(`/admin/theme/`) or by binding it to a virtual host.

## Features

| Feature | Notes |
|---|---|
| **⌘K / Ctrl+K palette** | Opens from anywhere on the page; `/` also opens it when focus is not in a text field |
| **Instant grouped results** | The palette fetches suggestions and top document hits in parallel; results appear in labelled groups within ~200 ms |
| **Recent + favourite searches** | Persisted in `localStorage`; recents shown in the empty palette; starred queries surface as Favourites |
| **Content-type icons** | SVG inline icons for page, PDF, Word, Excel, PowerPoint, image, code, archive |
| **Breadcrumb result cards** | Each hit shows a derived path breadcrumb (`site › folder › page`) |
| **Faceted navigation** | Persistent left sidebar on desktop; offcanvas panel on mobile |
| **Light/dark mode** | FOUC-safe: `theme-init.js` runs synchronously in `<head>` before any paint, reading `localStorage` or `prefers-color-scheme` |
| **Self-hosted fonts** | Inter (body, 400/500/600) + JetBrains Mono (code, 400/500) served as same-origin `woff2` files; CSP `font-src 'self'` — no external CDN fonts |
| **Optional Ask-AI (RAG)** | Gated by the `rag_chat_enabled` feature flag; shows a ✨ card below the results status line and an Ask-AI group in the palette |

## Layout

```
docsearch/
├── theme.yml             # manifest (kind: StaticTheme, name: docsearch)
├── index.html            # SPA shell — semantic HTML5, no Bootstrap
├── thumbnail.png         # shown in /admin/theme/ (provisional screenshot — see note below)
├── assets/
│   ├── theme-init.js     # FOUC-safe dark-mode init (synchronous, runs in <head>)
│   ├── styles.css        # self-contained DocSearch stylesheet (tokens + utilities + components)
│   ├── compat.js         # Bootstrap-JS-API shim (Modal/Collapse/Dropdown/Offcanvas/Tooltip)
│   ├── app.js            # entry point; loads modules in order
│   ├── api.js            # centralised fetch wrapper (CSRF, envelope)
│   ├── auth.js           # login, logout, /auth/me probe
│   ├── search.js         # search, suggest, facets, pagination, sort, favourite (breadcrumb cards)
│   ├── palette.js        # ⌘K command palette (suggestions + hits + Ask-AI)
│   ├── docsearch.js      # content-type icons, breadcrumb derivation, light/dark toggle
│   ├── advance.js        # advanced-search form
│   ├── chat.js           # optional RAG chat with query prefill + disclaimer banner
│   ├── cache.js          # document cache viewer (sandboxed iframe)
│   ├── profile.js        # password change form
│   ├── error.js          # error pages (400/404/429/500/503)
│   ├── help.js           # help page renderer
│   ├── format.js         # date/size/HTML-sanitiser helpers
│   ├── markdown.js       # minimal markdown renderer (chat)
│   ├── i18n.js           # JSON bundle loader; navigator.language → en/ja/…
│   ├── router.js         # client-side SPA router
│   ├── logo.png          # home hero logo (generic Fess wordmark)
│   ├── logo-head.png     # header brand logo (sits on the dark top-bar)
│   └── fonts/
│       ├── inter-400.woff2
│       ├── inter-500.woff2
│       ├── inter-600.woff2
│       ├── jetbrains-mono-400.woff2
│       └── jetbrains-mono-500.woff2
├── i18n/                 # messages.<locale>.json (16 locales)
├── help/                 # <locale>.json help content (8 locales)
└── README.md
```

> **`thumbnail.png`:** provisional generic Fess search screenshot. A real
> DocSearch screenshot will be substituted after the theme is deployed and
> verified. (≤512×512, ≤512 KB; declared as `thumbnail: thumbnail.png` in
> `theme.yml`.)

## Derivation from DocuForge

DocSearch is built on the `docuforge` baseline. The shared SPA core is kept
byte-for-byte identical (except for `themes/docsearch/` asset paths):

| Module | Status |
|---|---|
| `api.js`, `auth.js`, `router.js` | unchanged (shared core) |
| `format.js`, `markdown.js`, `cache.js` | unchanged (shared core) |
| `profile.js`, `error.js`, `advance.js` | unchanged (shared core) |
| `compat.js` | unchanged Bootstrap-JS-API shim |
| `i18n.js` | unchanged (shared core) |
| `styles.css` | **DocSearch delta** — full indigo/slate design-token rewrite; self-hosted `@font-face`; palette + theme-toggle CSS |
| `index.html` | **DocSearch delta** — `#palette` dialog, palette-trigger button, `theme-toggle` button; `theme-init.js` added in `<head>` |
| `palette.js` | **DocSearch addition** — ⌘K command palette |
| `docsearch.js` | **DocSearch addition** — content-type icons, breadcrumb helper, light/dark toggle logic |
| `theme-init.js` | **DocSearch addition** — FOUC-safe synchronous theme init |
| `search.js` | **DocSearch delta** — result-card render produces breadcrumb cards with content-type icons |
| `chat.js` | **DocSearch delta** — query prefill from `?q=` + Ask-AI disclaimer banner |

## Bootstrap compatibility shim (`assets/compat.js`)

The unmodified SPA still drives a few widgets through the Bootstrap 5 JS API
and declarative `data-bs-*` attributes. `compat.js` re-implements exactly that
surface and assigns it to `window.bootstrap` **before** `app.js` runs:

| Widget | API used by the modules | Trigger |
|---|---|---|
| Modal | `bootstrap.Modal.getOrCreateInstance(el).show()/.hide()` + `data-bs-toggle="modal"` / `data-bs-dismiss="modal"` | login dialog |
| Collapse | `bootstrap.Collapse.getOrCreateInstance(el,{toggle:false}).hide()` + `data-bs-toggle="collapse"` | search-options drawer |
| Dropdown | `data-bs-toggle="dropdown"` (auto-init) | header user menu |
| Offcanvas | `data-bs-toggle="offcanvas"` / `data-bs-dismiss="offcanvas"` | mobile facet panel |
| Tooltip | `new bootstrap.Tooltip(el)` + `data-bs-toggle="tooltip"` | header EOL / dev-mode warnings |

The shim is XSS-safe (no `innerHTML` with dynamic data) and honours
`prefers-reduced-motion`.

## Design system

`assets/styles.css` defines the DocSearch tokens (`--ds-*`) and maps them onto
the `--bs-*` custom properties the SPA modules already reference. Key choices:

- **Palette:** primary `#4F46E5` (indigo), accent-hover `#4338CA`,
  surface `#FFFFFF` / `#F8FAFC`, text `#0F172A`, muted `#475569`.
- **Type:** Inter (body, 400/500/600), JetBrains Mono (code), both self-hosted.
- **Layout:** persistent 280px facet sidebar on the left (sticky on desktop),
  results to the right; the sidebar collapses to an offcanvas on mobile.

## Building and Installing

```bash
# 1. Package
cd /path/to/fess-themes
./scripts/package.sh docsearch
# → dist/docsearch-1.0.0.zip

# 2. Upload
# In Fess admin UI: /admin/theme/ → Upload ZIP → Activate
#   Set as default:   Admin → General → theme.default = docsearch
#   Per virtual host: bind theme name to the virtual host entry
```

## Supported Locales

Declared in `theme.yml#supportedLocales`; 16 message bundle files ship.
DocSearch-specific strings (palette labels, content-type names, Ask-AI banner)
are translated for the eight primary locales; all other locales fall back to
English for those strings.

| Locale | Coverage |
|---|---|
| `en`, `ja`, `de`, `es`, `fr`, `ko`, `pt-BR`, `zh-CN` | Full (including DocSearch-specific keys) |
| Remaining 8 bundles | Shared SPA strings; DocSearch-specific keys fall back to `en` |

## API endpoints consumed

All under `/api/v2` — identical to the reference theme. See `api.js` (the
single source of truth) and the Fess static-theme API reference doc.

## CSP

`index.html` enforces a strict `Content-Security-Policy`:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; connect-src 'self'; frame-src blob:; child-src blob:; base-uri 'self'
```

Fonts are self-hosted (`font-src 'self'`), so **no** external font CDN entries
are required. The theme runs fully offline and under strict CSP without
modification.

## Customising

Copy this directory, rename it, edit `theme.yml#name` to match, update every
`/themes/docsearch/…` path in `index.html`, `help.js`, `i18n.js`, and
`styles.css`, then upload as a ZIP via `/admin/theme/`.

## License

Apache-2.0 — same as Fess.

Fonts are self-hosted under `assets/fonts/` and licensed under the
**SIL Open Font License 1.1** (Inter and JetBrains Mono), which is compatible
with self-hosting under the Apache-2.0 theme.
