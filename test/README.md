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
- `helpdesk.shell.test.js` — helpdesk's page shell for keyboard and screen-reader users: the
  closed options drawer being `visibility: hidden` (out of the tab order), Escape closing it
  with the focus returning to its opener and opening moving the focus in, the `/` shortcut
  (not while typing, with a modifier, composing, or over the drawer), the tab title of every
  route, and the accessible name of the header search button (the theme's real `index.html`,
  `styles.css`, `compat.js`, `app.js` and English bundle).
- `helpdesk.results.test.js` — helpdesk's pager (real hrefs, `aria-current`, page names, a
  disabled end that is not a link, modified clicks left to the browser), the label name in the
  active-filter chip, and the stylesheet contract of the layout fixes (read back from the
  parsed `styles.css`; jsdom has no layout).
- `helpdesk.searchstate.test.js` — helpdesk's header search box carrying only the
  categories the user picked in the drawer (not the one a home tile put in the URL),
  a related-searches chip being a link to its own `/search?q=` URL that the router
  follows, and a search the server rejects with HTTP 400 clearing the previous
  query's cards, status line, featured answer, pager, facets and related searches.
- `mosaic.searcher.test.js` / `semanticlens.searcher.test.js` — searcher-
  provenance and query-verbatim behaviour for the two vector-search themes
  against Fess's core semantic search.
- `semanticlens.results.test.js` — what semanticlens' `runSearch()` leaves on the
  page: a search the server rejects with HTTP 400 clears the previous results,
  composition band, status line, pager, facet sidebar and related searches under
  the error banner; the `(0.06 seconds)` suffix reads `exec_time` sent as a
  string; the document title carries a query containing `$&` or `$$` literally.
  It primes the theme's real `i18n.js` with the English bundle.
- `mosaic.gallery.test.js` — mosaic's label-filter chip and options bar for a
  label set through `ex_q`, the lightbox's no-thumbnail fallback, and the
  single popular-words request on the home view.
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
  and the header search form dropping both while carrying the labels picked
  in the drawer — for the same nine themes.
- `label-names.test.js` — a label from `ui/config`'s `label_options`
  (`{ value, name }`) is shown by its name, falling back to its value: in the
  search-options label select, the current-filters badge and the options bar
  (the nine themes above), and in the advanced-search checkboxes and the chat
  filter panel (all 10 themes).
- `results-status.test.js` — the results-status banner for a blank query (a
  category tile's `/search?q=&fields.label=x`): it names the active labels in
  place of `{bq}`, or uses the `_noquery` wording when there is no label either,
  rendered with each theme's real English bundle (the nine themes above).
- `docsearch.drawer.test.js` — docsearch's search-options drawer and clipped legacy
  header form: both are `visibility: hidden` while closed (out of the tab order and
  the accessibility tree), and the drawer closes on Escape and on a click outside it,
  with the focus going back to the control that opened it (the theme's real
  `index.html`, `styles.css`, `compat.js`, `app.js` and `palette.js`).
- `docsearch.palette.test.js` — docsearch's command palette: the keys of an IME
  conversion (synthetic composition events) are not commands, and Escape closes it
  wherever the focus is inside it.
- `docsearch.suggest.test.js` — docsearch's two suggest lists: the home search box's
  ArrowDown/ArrowUp/Enter/Escape model (`aria-selected`, `aria-activedescendant`), and
  no list acting on the keys of an IME conversion.
- `docsearch.headermenu.test.js` — docsearch's header nav below 768px: the toggle
  opens it as a menu and `app.js` closes it after a choice, on a route change and on
  Escape (focus back on the toggle).
- `docsearch.layout.test.js` — docsearch's small-screen and long-query polish: the
  stylesheet declarations that carry it (read back from the parsed `styles.css`; jsdom
  has no layout), and a failed search hiding the previous search's "did not match" panel.
- `docsearch.filters.test.js` — docsearch's active-filter chip names a label by its
  `label_options` name (value kept in the URL and the request), and the "Similar Results"
  view is written to the URL as `sdh` (a new history entry; shown again from a URL that
  carries it).
- `codesearch.query.test.js` — codesearch's query box -> Fess query translation (`query.js`):
  qualifier values escaped for the Lucene parser, `path:` as a prefix or an exact path, ranges,
  phrases (`"foo bar"~3`) kept as one term, a leading `--` read as text, the facet and chip
  clicks sending what a submit sends, and the suggest / Ask panel helpers built on the same parse.
- `codesearch.paging.test.js` — codesearch's pager steps by the `page_size` the server served
  when `num` is above its cap (page 2 of `num=500` starts at 100, not 500).
- `codesearch.shell.test.js` — codesearch's Filters button (the facet rail as a drawer below
  960px: open, close on Escape / scrim / route change, never open together with the Ask drawer),
  the stylesheet rules that carry it (read back from the parsed `styles.css`), and the `/`
  shortcut that focuses the search box.
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
├── helpdesk.shell.test.js  helpdesk.results.test.js
├── scheme.test.js  search.test.js  search-flows.test.js  helpdesk.plaintitle.test.js  helpdesk.searchstate.test.js
├── mosaic.searcher.test.js  semanticlens.searcher.test.js  semanticlens.results.test.js
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
