# fess-themes — theme JavaScript unit tests

Executable unit tests for the shared JavaScript that ships inside every theme
(`themes/<name>/assets/*.js`).

## What this is

Every theme under `themes/<name>/` carries its own copy of the same shared ES
modules (`format.js`, `markdown.js`, `router.js`, ...). These tests **import
and run each theme's real, unmodified copy** and assert on its behaviour — not
on its source text. A source string-match cannot observe what the code
actually *does*: a heading regex can be present in `markdown.js` yet produce
output that the `format.js` sanitizer strips before display.

Most suites parametrize over every theme (`describe.each`), so each theme's
own copy is exercised and a new theme is picked up automatically. A handful of
suites instead exercise only **docuforge's copy** of a module that
`parity.test.js` proves byte-identical across all 10 themes — `router.js`
(`router.test.js`), `auth.js` (`auth.test.js`), `profile.js`
(`profile.test.js`), `api.js`/`i18n.js` (`locale.test.js`), and the login-modal
lock in `login-modal.test.js` (which also has a `describe.each` half for the
new-password form markup, checked in every theme). Running the same behaviour
ten times over provably-identical source would add nothing.

The suites:

- `format.test.js` / `format.nodom.test.js` — `escapeHtml`, `isSafeHref`,
  `sanitizeHtml` (asserts **H1–H6 are all preserved**), `formatFileSize`,
  `formatDate`, `renderHighlightedSnippet`; the `.nodom` file locks that
  `isSafeHref` fails loudly rather than laundering a missing DOM into "unsafe".
- `markdown.test.js` — `parseMarkdown`: headings, lists, blockquotes, tables,
  horizontal rules, inline/fenced code, and safe-vs-unsafe autolinks.
- `pipeline.test.js` — the real chat pipeline `parseMarkdown() -> sanitizeHtml()`,
  asserting every heading level survives to the DOM and that dangerous payloads
  (a `javascript:` link, raw `<script>`, an `onerror` attribute) are neutralized
  end to end.
- `scheme.test.js` — regression lock for the file:/smb: link fix: every
  theme's `search.js` admits the file-system crawl schemes alongside
  http/https/ftp/ftps when gating result links.
- `search.test.js` — theme-specific `search.js` unit cases: the accessible
  copy-URL button, `plainTitle`, facet-chip recoverability / zero-count
  suppression, and the `features.osdd_link` gate on the OpenSearch
  description link.
- `search-flows.test.js` — the full `runSearch()` render pipeline (results,
  facets, pagination, active-filter chips, related content, favorites,
  similar docs) plus the type-ahead suggest (`attachSuggest`), across every
  theme's own `search.js`.
- `helpdesk.plaintitle.test.js` — characterization test for helpdesk's own
  DOM-free `plainTitle()` entity decode (it does not route through
  `format.js` like the other themes' `search.js`).
- `mosaic.searcher.test.js` / `semanticlens.searcher.test.js` — searcher-
  provenance and query-verbatim behaviour for the two vector-search themes
  against Fess's core semantic search.
- `notification-banners.test.js` — the five notification/error banners whose
  visibility the shared JS owns through the `d-none` class alone
  (`#home-notification`, `#results-notification`, `#home-flash`,
  `#login-notification`, `#login-error`). It boots each theme's real `app.js`
  and `auth.js` against that theme's **shipped `index.html` body** and asserts
  the banner ends up renderable, then re-states the invariant as a markup
  contract: none of those five may ship the `hidden` attribute, because
  `[hidden] { display: none !important; }` outlives every `d-none` removal. A
  final suite pins the opposite case — the codesearch elements that are driven
  through the `hidden` DOM *property* (`#search-error`, `#empty-state`,
  `#chat-nav-item`, `#drawer-scrim`) must keep the attribute.
- `parity.test.js` — locks the cross-theme invariant that all 10 copies of
  `format.js` and `markdown.js` are byte-identical (line 2 included), and that
  all 10 copies of `router.js`, `api.js`, `i18n.js`, `help.js`, `cache.js`,
  `error.js`, `auth.js` and `profile.js` — copied unchanged from the fess
  bootstrap theme — are byte-identical too. Nothing else in the repo enforces
  either invariant.
- `wire-error-codes.test.js` / `wire-error-codes.contract.test.js` — the
  shared JS branches on the lowercase snake_case v2 API error codes the
  server actually sends, compared on the same case the server writes them in.
- `relative-urls.test.js` — every URL in a theme's shipped `index.html` and
  `assets/*.js`, and every `url()` in its CSS, is relative to the `<base
  href>` Fess 15.9 inserts (or to the stylesheet), never root-absolute.
- `compat-modal.test.js` — `compat.js`'s `Modal` fires a cancelable
  `hide.bs.modal` before closing and `hidden.bs.modal` after, from Escape,
  the backdrop, `data-bs-dismiss` and a direct `hide()` call, in every theme
  (`compat.js` itself is not byte-identical across themes, so all 10 copies
  run here, unlike the docuforge-only suites above).
- `i18n-keys.test.js` — the JSP wording shared with the fess bootstrap theme
  (the permission notice, the forced password change, the view count) is
  present with the same keys in every theme's locale bundles.
- `search-parity.test.js` — view counts, the permission notice, and the
  `fess:auth:required` signal that lets `app.js` ask for login again — JSP
  parity for the themes that carry them (storefront and codesearch opt out
  of view counts by design).
- `search-defaults.test.js` — the user's default labels and sort, and the
  page size remembered per tab (`initialNum`/`forgetNum`), for the nine
  themes with the bootstrap search contract, plus codesearch's own
  default-sort-only case.
- `search-conditions.test.js` — `sdh` and `as.*` carried by JSP-made
  `/search` URLs, a facet click narrowing the search with an `ex_q` clause,
  and the header search form dropping both while carrying the drawer's
  labels — for the same nine themes.
- `app-boot.test.js` — the UI language `app.js` requests at boot
  (`?browser_lang=`, session, `Accept-Language`), in every theme.
- `app-auth.test.js` — the `login.required` gate at boot, and what a login, a
  logout and a lost session do to the page, in every theme; each case's
  `detach()` removes the listeners its boot added so an earlier theme never
  answers a later case's events.
- `router.test.js` — behavioural coverage of the predicate-driven SPA router
  (register / navigate / dispatch / attach). `router.js` is byte-identical in
  every theme (`parity.test.js`), so only docuforge's copy is exercised.
- `locale.test.js` — `api.init()`'s `?browser_lang=` forwarding and `i18n.js`
  preferring the server's `ui_locale` over `navigator.language`. `api.js` and
  `i18n.js` are byte-identical, so only docuforge's copies are exercised.
- `auth.test.js` — ported from the fess repository's bootstrap theme test:
  `getCurrentUser`, `promptLogin`, `endSession`, `isSessionGone`,
  `localizePasswordError`, `probeMe`, `attach()`. `auth.js` is byte-identical,
  so only docuforge's copy is exercised.
- `profile.test.js` — ported the same way, for the profile / password-change
  view. `profile.js` is byte-identical, so only docuforge's copy is exercised.
- `login-modal.test.js` — every theme ships the new-password form `auth.js`
  switches the login modal to (checked in all 10); the modal *lock* itself
  (Escape, the backdrop and `hide()` all refused while login is required) is
  exercised once, against docuforge's `compat.js` + `auth.js`, since both are
  proven identical or behaviourally locked elsewhere (`parity.test.js`,
  `compat-modal.test.js`).

## Not shipped

This `test/` directory is **not** part of any theme ZIP. `scripts/package.sh`
zips only `themes/<name>/`, so nothing here (its `package.json`, `node_modules/`,
or coverage output) is ever distributed or served. The modules are authored as
native ES modules that call browser APIs (`document`, `window`, `URL`,
`<template>`); a JVM JS engine cannot run them, so the tests run on Node with
[vitest](https://vitest.dev) and a [jsdom](https://github.com/jsdom/jsdom) DOM.

## Running

```bash
cd test
npm install   # or: npm ci   (needs network; generates/uses package-lock.json)
npm test
```

`npm test` runs the suite under V8 coverage and enforces the thresholds declared
in `vitest.config.js` (it fails if coverage of `format.js` / `markdown.js`, or of
`search.js`, drops below them — each glob has its own gate). CI runs the same
command via `.github/workflows/theme-js.yml` (Node 22, `npm ci` against the
committed `package-lock.json`). These tests are independent of
`scripts/verify-bundles.mjs` (the locale-bundle contract) and of the
Maven-less packaging flow.

## Layout

```
test/
├── package.json / package-lock.json / vitest.config.js
├── helpers/
│   ├── themes.js         # enumerate themes; load a theme's own asset module (no cache-bust query);
│   │                     # read/parse/mount a theme's shipped index.html
│   ├── loadSearch.js     # import a theme's search.js with api/router doubles injected
│   ├── loadShell.js      # import a theme's auth.js / profile.js / boot its app.js against the real index.html
│   ├── searchFlow.js     # DOM scaffold + /search fixtures for the runSearch() flows
│   ├── net.js            # Response-like fetch stubs used by auth.test.js
│   └── dom.js            # serialise a sanitized DocumentFragment for assertions; reset/mount helpers
├── format.test.js  format.nodom.test.js  markdown.test.js  pipeline.test.js
├── scheme.test.js  search.test.js  search-flows.test.js  helpdesk.plaintitle.test.js
├── mosaic.searcher.test.js  semanticlens.searcher.test.js
├── notification-banners.test.js  parity.test.js
├── wire-error-codes.test.js  wire-error-codes.contract.test.js
├── relative-urls.test.js  compat-modal.test.js  i18n-keys.test.js
├── search-parity.test.js  search-defaults.test.js  search-conditions.test.js
├── app-boot.test.js  app-auth.test.js
└── router.test.js  locale.test.js  auth.test.js  profile.test.js  login-modal.test.js
```

Tests import the shipped files by absolute file URL; they are never copied.
`error.js` is byte-identical across every theme (`parity.test.js`) but exposes
only a DOM-mutating `attach()` (its path→code mapping is module-private), so
there is no clean pure function to assert on and no suite covers its
behaviour beyond that byte-identity check. `i18n.js` is byte-identical too;
unlike `error.js` its behaviour is exercised, in `locale.test.js` and
`auth.test.js`, on docuforge's copy.
