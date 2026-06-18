# RawBlock — Fess Brutalist Static Theme

RawBlock is a **self-contained** Fess static theme that ships **no Bootstrap**.
It applies the *RawBlock design system* (see [`DESIGN.md`](DESIGN.md) in this
theme) to deliver a raw, brutalist search experience: an unapologetic
black-on-white interface with thick borders, sharp corners, no shadows, and
full-inversion hover/active states. It is derived from the bundled `bootstrap`
reference theme and exercises the same `/api/v2/*` surface, so it remains a
drop-in alternative.

Activate it by setting `theme.default=rawblock` in the admin UI
(`/admin/theme/`) or by binding it to a virtual host.

## What makes it "self-contained"

The reference `bootstrap` theme loads `/css/bootstrap.min.css`,
`/js/popper.min.js`, and `/js/bootstrap.min.js` from Fess core. RawBlock
loads **none** of those:

| Concern | bootstrap theme | RawBlock |
|---|---|---|
| CSS framework | `/css/bootstrap.min.css` | `assets/styles.css` only — every utility/component class is re-implemented from scratch on top of the RawBlock tokens |
| JS framework | `/js/popper.min.js` + `/js/bootstrap.min.js` | `assets/compat.js` — a ~9 KB shim exposing the exact `window.bootstrap` API (Modal/Collapse/Dropdown/Offcanvas/Tooltip) the modules call |
| Icons | `/css/font-awesome.min.css` | unchanged — Font Awesome is independent of Bootstrap and still used for the `fa fa-*` glyphs |
| Fonts | system | Archivo Black / Work Sans / Space Mono via Google Fonts (CSP relaxed for `fonts.googleapis.com` + `fonts.gstatic.com`; falls back to system fonts if blocked) |

The SPA JavaScript modules (`app.js`, `search.js`, `chat.js`, `auth.js`, …)
are **byte-for-byte identical** to the reference theme except for the
hard-coded `/themes/<name>/…` asset paths (`help.js`, `i18n.js`) which point
at `/themes/rawblock/`. This keeps full feature parity (search, facets,
suggest, favorites, advanced search, RAG chat, cache viewer, profile, help,
error pages, i18n) with zero functional changes.

## Layout

```
rawblock/
├── theme.yml             # manifest (kind: StaticTheme, name: rawblock)
├── index.html            # SPA shell — semantic HTML5, no Bootstrap
├── thumbnail.png         # shown in /admin/theme/ (≤512KB, ≤512x512)
├── assets/
│   ├── compat.js         # Bootstrap-JS-API shim (Modal/Collapse/Dropdown/Offcanvas/Tooltip)
│   ├── styles.css        # self-contained RawBlock stylesheet (tokens + utilities + components)
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
> (≤512×512, ≤512 KB). The shipped image is a placeholder — capture an updated
> screenshot from a running instance of this theme to replace it.

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

`assets/styles.css` defines the RawBlock tokens (`--df-*`) and maps them onto
the `--bs-*` custom properties the theme CSS references, then implements the
full utility/component layer. Key choices from `DESIGN.md`:

- **Palette:** black `#000000` and white `#FFFFFF` carry text, borders, and
  fills; blue `#0000FF` is reserved exclusively for hyperlinks; pure
  green/orange/red drive success/warning/error accents.
- **Type:** Archivo Black (headings, 48–64px for impact), Work Sans (body,
  1.6 line height), Space Mono (code/inline code, inputs).
- **Radius / elevation:** 0px radius on every element — sharp corners, no
  exceptions — and **no shadows**. Hierarchy comes from border weight
  (thin 1px, thick 3px, heavy 5px) and scale contrast alone.
- **Layout:** intentionally irregular spacing and asymmetry; full color
  inversion (black↔white) on hover and active states; uppercase + letter
  tracking on buttons and labels.

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

## Packaging

Build a distributable ZIP for `/admin/theme/` with:

```
./scripts/package.sh rawblock
```

## Customising

Copy this directory, rename it, edit `theme.yml#name` to match, update the
hard-coded `/themes/rawblock/…` paths in `index.html`, `help.js`, and
`i18n.js`, then upload as a ZIP via `/admin/theme/`.

## License

Apache-2.0 — same as Fess.

The design specification (`DESIGN.md`) is a third-party artifact by
Chef ([@chef](https://designmd.ai/chef)), obtained from
[designmd.ai](https://designmd.ai/chef/rawblock) and licensed under the
**MIT License** — the only non-Apache-2.0 file in this theme.
