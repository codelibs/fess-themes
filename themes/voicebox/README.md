# VoiceBox — Fess Magazine-Style Static Theme

VoiceBox is a **self-contained** Fess static theme that ships **no Bootstrap**.
It applies the *VoiceBox design system* (see [`DESIGN.md`](DESIGN.md) in this
theme) to deliver a bold, editorial search experience: a stark black masthead,
a persistent left **facet sidebar**, massive Archivo Black headlines, and a
high-contrast black / white / red palette. It is derived from the bundled
`bootstrap` reference theme and exercises the same `/api/v2/*` surface, so it
remains a drop-in alternative.

Activate it by setting `theme.default=voicebox` in the admin UI
(`/admin/theme/`) or by binding it to a virtual host.

## What makes it "self-contained"

The reference `bootstrap` theme loads `/css/bootstrap.min.css`,
`/js/popper.min.js`, and `/js/bootstrap.min.js` from Fess core. VoiceBox
loads **none** of those:

| Concern | bootstrap theme | VoiceBox |
|---|---|---|
| CSS framework | `/css/bootstrap.min.css` | `assets/styles.css` only — every utility/component class is re-implemented from scratch on top of the VoiceBox tokens |
| JS framework | `/js/popper.min.js` + `/js/bootstrap.min.js` | `assets/compat.js` — a ~9 KB shim exposing the exact `window.bootstrap` API (Modal/Collapse/Dropdown/Offcanvas/Tooltip) the modules call |
| Icons | `/css/font-awesome.min.css` | unchanged — Font Awesome is independent of Bootstrap and still used for the `fa fa-*` glyphs |
| Fonts | system | Archivo Black / Work Sans / Space Mono via Google Fonts (CSP relaxed for `fonts.googleapis.com` + `fonts.gstatic.com`; falls back to system fonts if blocked) |

The SPA JavaScript modules (`app.js`, `search.js`, `chat.js`, `auth.js`, …)
are **byte-for-byte identical** to the reference theme except for the
hard-coded `/themes/<name>/…` asset paths (`index.html`, `help.js`, `i18n.js`)
which point at `/themes/voicebox/`. This keeps full feature parity (search,
facets, suggest, favorites, advanced search, RAG chat, cache viewer, profile,
help, error pages, i18n) with zero functional changes.

## Layout

```
voicebox/
├── theme.yml             # manifest (kind: StaticTheme, name: voicebox)
├── index.html            # SPA shell — semantic HTML5, no Bootstrap
├── DESIGN.md             # VoiceBox design spec (reference; excluded from the ZIP)
├── assets/
│   ├── compat.js         # Bootstrap-JS-API shim (Modal/Collapse/Dropdown/Offcanvas/Tooltip)
│   ├── styles.css        # self-contained VoiceBox stylesheet (tokens + utilities + components)
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
│   ├── logo.svg          # home hero logo
│   └── logo-head.svg     # header brand logo (sits on the stark black masthead)
├── i18n/                 # messages.<locale>.json (16 locales)
├── help/                 # <locale>.json help content (8 locales)
└── README.md
```

> **Thumbnail (optional):** drop a `thumbnail.png` (≤512×512, ≤512 KB) next to
> `theme.yml` and add a `thumbnail: thumbnail.png` line to it to show a preview in
> the `/admin/theme/` picker. Capture it from a running instance of the theme so
> it stays accurate.

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

`assets/styles.css` defines the VoiceBox tokens (`--vb-*`) and maps them onto
the `--bs-*` custom properties the theme CSS references, then implements the
full utility/component layer. Key choices from `DESIGN.md`:

- **Palette:** primary `#0A0A0A` (black), accent `#EF4444` (red), background
  `#FAFAFA` (white). A single aggressive red is used sparingly — one element
  per viewport — while the dominant tone is stark black-on-white.
- **Type:** Archivo Black (headings, massive and unapologetic), Work Sans (body,
  1.7 line height), Space Mono (code/inline code).
- **Radius / elevation:** 0px corners on every component — VoiceBox is
  completely flat. All hierarchy comes from weight, scale, and black/white
  contrast. Borders (2px) do all structural work; shadows are never used.
- **Layout:** persistent 280px facet sidebar on the left (sticky on desktop),
  results to the right; the sidebar collapses to an offcanvas on mobile. The
  header is a stark black editorial masthead.

## API endpoints consumed

All under `/api/v2` — identical to the reference theme. See `api.js` (the
single source of truth) and the Fess static-theme API reference doc.

## Requirements

Fess **15.7** or later.

## CSP

`index.html` keeps the strict `default-src 'self'` policy, relaxed **only** to
allow the Google Fonts stylesheet (`style-src … https://fonts.googleapis.com`)
and font files (`font-src 'self' https://fonts.gstatic.com`). Scripts remain
`script-src 'self'`. To run fully offline / strictly self-hosted, remove the
two `fonts.*` entries and the Google Fonts `<link>` — the CSS falls back to
system fonts automatically.

## Customising

Copy this directory, rename it, edit `theme.yml#name` to match, update the
hard-coded `/themes/voicebox/…` paths in `index.html`, `help.js`, and
`i18n.js`, then upload as a ZIP via `/admin/theme/`. Brand logos are
`assets/logo.svg` (home hero) and `assets/logo-head.svg` (header masthead).

## License

Apache-2.0 — same as Fess.

The design specification (`DESIGN.md`) is a third-party artifact by
Chef ([@chef](https://designmd.ai/chef)), obtained from
[designmd.ai](https://designmd.ai/chef/voicebox) and licensed under the
**MIT License** — the only non-Apache-2.0 file in this theme.
