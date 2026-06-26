# DocuForge — Fess Documentation-Style Static Theme

DocuForge is a **self-contained** Fess static theme that ships **no Bootstrap**.
It applies the *DocuForge design system* (see [`DESIGN.md`](DESIGN.md) in this
theme) to deliver a docs-grade search experience: a slim dark top-bar, a
persistent left **facet sidebar**, generous typography, and the
blue / purple / gray palette. It is derived from the bundled `bootstrap`
reference theme and exercises the same `/api/v2/*` surface, so it remains a
drop-in alternative.

Activate it by setting `theme.default=docuforge` in the admin UI
(`/admin/theme/`) or by binding it to a virtual host.

## What makes it "self-contained"

The reference `bootstrap` theme loads `/css/bootstrap.min.css`,
`/js/popper.min.js`, and `/js/bootstrap.min.js` from Fess core. DocuForge
loads **none** of those:

| Concern | bootstrap theme | DocuForge |
|---|---|---|
| CSS framework | `/css/bootstrap.min.css` | `assets/styles.css` only — every utility/component class is re-implemented from scratch on top of the DocuForge tokens |
| JS framework | `/js/popper.min.js` + `/js/bootstrap.min.js` | `assets/compat.js` — a ~9 KB shim exposing the exact `window.bootstrap` API (Modal/Collapse/Dropdown/Offcanvas/Tooltip) the modules call |
| Icons | `/css/font-awesome.min.css` | unchanged — Font Awesome is independent of Bootstrap and still used for the `fa fa-*` glyphs |
| Fonts | system | Plus Jakarta Sans / Inter / Fira Code via Google Fonts (CSP relaxed for `fonts.googleapis.com` + `fonts.gstatic.com`; falls back to system fonts if blocked) |

The SPA JavaScript modules (`app.js`, `search.js`, `chat.js`, `auth.js`, …)
are **byte-for-byte identical** to the reference theme except for the
hard-coded `/themes/<name>/…` asset paths (`help.js`, `i18n.js`) which point
at `/themes/docsearch/`. This keeps full feature parity (search, facets,
suggest, favorites, advanced search, RAG chat, cache viewer, profile, help,
error pages, i18n) with zero functional changes.

## Layout

```
docuforge/
├── theme.yml             # manifest (kind: StaticTheme, name: docuforge)
├── index.html            # SPA shell — semantic HTML5, no Bootstrap
├── thumbnail.png         # shown in /admin/theme/ (≤512KB, ≤512x512)
├── assets/
│   ├── compat.js         # Bootstrap-JS-API shim (Modal/Collapse/Dropdown/Offcanvas/Tooltip)
│   ├── styles.css        # self-contained DocuForge stylesheet (tokens + utilities + components)
│   ├── app.js            # entry point; loads modules in order
│   ├── api.js            # centralised fetch wrapper (CSRF, envelope)
│   ├── auth.js           # login, logout, /auth/me probe
│   ├── search.js         # search, suggest, facets, pagination, sort, favorite
│   ├── advance.js        # advanced-search form
│   ├── chat.js           # optional RAG chat (rag_chat_enabled feature flag)
│   ├── cache.js          # document cache viewer (sandboxed iframe)
│   ├── profile.js        # password change form
│   ├── error.js          # error pages (400/404/429/500/503)
│   ├── help.js           # help page renderer
│   ├── format.js         # date/size/HTML-sanitiser helpers
│   ├── markdown.js       # minimal markdown renderer (chat)
│   ├── i18n.js           # JSON bundle loader; navigator.language → en/ja
│   ├── router.js         # client-side SPA router
│   ├── logo.png          # home hero logo
│   └── logo-head.png     # header brand logo (white, sits on the dark top-bar)
├── i18n/                 # messages.<locale>.json (16 locales)
├── help/                 # <locale>.json help content (8 locales)
└── README.md
```

> **`thumbnail.png`:** the preview shown in the `/admin/theme/` picker
> (≤512×512, ≤512 KB). Swap in an updated screenshot if the UI changes.

## Bootstrap compatibility shim (`assets/compat.js`)

The unmodified SPA still drives a few widgets through the Bootstrap 5 JS API
and declarative `data-bs-*` attributes. `compat.js` re-implements exactly that
surface and assigns it to `window.bootstrap` **before** `app.js` runs:

| Widget | API used by the modules | Trigger |
|---|---|---|
| Modal | `bootstrap.Modal.getOrCreateInstance(el).show()/.hide()` + `data-bs-toggle="modal"` / `data-bs-dismiss="modal"` | login dialog |
| Collapse | `bootstrap.Collapse.getOrCreateInstance(el,{toggle:false}).hide()` + `data-bs-toggle="collapse"` | search-options drawer, chat filter/collapse panels |
| Dropdown | `data-bs-toggle="dropdown"` (auto-init) | header user menu |
| Offcanvas | `data-bs-toggle="offcanvas"` / `data-bs-dismiss="offcanvas"` | mobile facet panel |
| Tooltip | `new bootstrap.Tooltip(el)` + `data-bs-toggle="tooltip"` | header EOL / dev-mode warnings |

The shim is XSS-safe (no `innerHTML` with dynamic data) and honours
`prefers-reduced-motion`.

## Design system

`assets/styles.css` defines the DocuForge tokens (`--df-*`) and maps them onto
the `--bs-*` custom properties the theme CSS references, then implements the
full utility/component layer. Key choices from `DESIGN.md`:

- **Palette:** primary `#2563EB`, secondary (purple) `#7C3AED`, neutrals (zinc),
  success/warning/error method-style accents.
- **Type:** Plus Jakarta Sans (headings), Inter (body, 1.7 line height),
  Fira Code (code/inline code).
- **Radius / elevation:** 8px default radius, subtle/medium/large shadow scale;
  code blocks use an inset border, never a shadow.
- **Layout:** persistent 280px facet sidebar on the left (sticky on desktop),
  results to the right; the sidebar collapses to an offcanvas on mobile.

## API endpoints consumed

All under `/api/v2` — identical to the reference theme. See `api.js` (the
single source of truth) and the Fess static-theme API reference doc.

## CSP

`index.html` keeps the strict `default-src 'self'` policy, relaxed **only** to
allow the Google Fonts stylesheet (`style-src … https://fonts.googleapis.com`)
and font files (`font-src 'self' https://fonts.gstatic.com`). Scripts remain
`script-src 'self'`. To run fully offline / strictly self-hosted, remove the
two `fonts.*` entries and the Google Fonts `<link>` — the CSS falls back to
system fonts automatically.

## Customising

Copy this directory, rename it, edit `theme.yml#name` to match, update the
hard-coded `/themes/docsearch/…` paths in `index.html`, `help.js`, and
`i18n.js`, then upload as a ZIP via `/admin/theme/`.

## License

Apache-2.0 — same as Fess.

The design specification (`DESIGN.md`) is a third-party artifact by
Chef ([@chef](https://designmd.ai/chef)), obtained from
[designmd.ai](https://designmd.ai/chef/docuforge) and licensed under the
**MIT License** — the only non-Apache-2.0 file in this theme.
