# NomadKit — Fess Static Theme (Digital-Nomad Design System)

NomadKit is a **self-contained** Fess static theme that ships **no Bootstrap**.
It applies the *NomadKit design system* (see [`DESIGN.md`](DESIGN.md) in this
theme) — a free-spirited, light-packed look built on warm **sand** tones
balanced by **ocean** and **forest** accents — to deliver a clean search
experience: a slim warm-dark top-bar, a persistent left **facet sidebar**, and
generous, readable typography. It is derived from the `docuforge` theme (itself
based on the bundled `bootstrap` reference theme) and exercises the same
`/api/v2/*` surface, so it remains a drop-in alternative.

Activate it by setting `theme.default=nomadkit` in the admin UI
(`/admin/theme/`) or by binding it to a virtual host.

## What makes it "self-contained"

The reference `bootstrap` theme loads `/css/bootstrap.min.css`,
`/js/popper.min.js`, and `/js/bootstrap.min.js` from Fess core. NomadKit
loads **none** of those:

| Concern | bootstrap theme | NomadKit |
|---|---|---|
| CSS framework | `/css/bootstrap.min.css` | `assets/styles.css` only — every utility/component class is re-implemented from scratch on top of the NomadKit tokens |
| JS framework | `/js/popper.min.js` + `/js/bootstrap.min.js` | `assets/compat.js` — a ~9 KB shim exposing the exact `window.bootstrap` API (Modal/Collapse/Dropdown/Offcanvas/Tooltip) the modules call |
| Icons | `/css/font-awesome.min.css` | unchanged — Font Awesome is independent of Bootstrap and still used for the `fa fa-*` glyphs |
| Fonts | system | Plus Jakarta Sans / Inter / Fira Code via Google Fonts (CSP relaxed for `fonts.googleapis.com` + `fonts.gstatic.com`; falls back to system fonts if blocked) |

The SPA JavaScript modules (`app.js`, `search.js`, `chat.js`, `auth.js`, …)
are **byte-for-byte identical** to the reference theme except for the
hard-coded `/themes/<name>/…` asset paths (`help.js`, `i18n.js`) which point
at `/themes/nomadkit/`. This keeps full feature parity (search, facets,
suggest, favorites, advanced search, RAG chat, cache viewer, profile, help,
error pages, i18n) with zero functional changes.

## Layout

```
nomadkit/
├── theme.yml             # manifest (kind: StaticTheme, name: nomadkit)
├── index.html            # SPA shell — semantic HTML5, no Bootstrap
├── assets/
│   ├── compat.js         # Bootstrap-JS-API shim (Modal/Collapse/Dropdown/Offcanvas/Tooltip)
│   ├── styles.css        # self-contained NomadKit stylesheet (tokens + utilities + components)
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
│   └── logo-head.png     # header brand logo (light, sits on the warm-dark top-bar)
├── i18n/                 # messages.<locale>.json (16 locales)
├── help/                 # <locale>.json help content (8 locales)
└── README.md
```

> **`thumbnail.png`** (optional): a preview shown in the `/admin/theme/` picker
> (≤512×512, ≤512 KB). NomadKit does not ship one yet; capture a screenshot
> from a running instance and add a `thumbnail: thumbnail.png` line to
> `theme.yml` to enable it.

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

`assets/styles.css` defines the NomadKit tokens (`--df-*`) and maps them onto
the `--bs-*` custom properties the theme CSS references, then implements the
full utility/component layer. Key choices from `DESIGN.md`:

- **Palette:** primary **Sand** `#D4A373`, secondary **Ocean** `#0891B2`,
  tertiary/success **Forest** `#166534`, warm-white background `#FFFDF7`,
  warm-stone neutrals, plus warning/error accents.
- **Accessibility:** because Sand is a light tone, it is used for *fills* with
  dark text (`--df-on-primary`), while links, focus rings and secondary actions
  use Ocean (`--df-secondary-strong`) so text/UI contrast clears WCAG AA / 3:1.
  Meaning is never carried by colour alone (icons + text labels throughout).
- **Type:** Plus Jakarta Sans (headings), Inter (body, 1.7 line height),
  Fira Code (code/inline code).
- **Radius / elevation:** 8px default radius, subtle/medium/large shadow scale.
- **Offline-first:** `.skeleton*` shimmer placeholder components are provided
  for loading states (motion-safe; respects `prefers-reduced-motion`), per the
  DESIGN.md guideline. The SPA JavaScript is kept byte-identical to the
  reference theme (see below), so these are available at the design-system /
  CSS layer rather than wired into the parity-locked search flow.
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
hard-coded `/themes/nomadkit/…` paths in `index.html`, `help.js`, and
`i18n.js`, then upload as a ZIP via `/admin/theme/`.

## License

Apache-2.0 — same as Fess.

The design specification (`DESIGN.md`) is the spec this theme was built from.
Confirm its authorship and license before publishing if it originates from a
third party.
