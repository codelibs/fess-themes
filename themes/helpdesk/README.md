# HelpDesk — Fess FAQ / Support-Site Static Theme

HelpDesk is a **self-contained** Fess static theme that ships **no Bootstrap**,
built for FAQ and support-site search. Its defining feature is that a search
result **is** the answer: clicking a result expands its excerpt **inline**,
in place, with no page navigation — no accordion animation delay, no round
trip, just a CSS clamp toggled off. Long or image-heavy answers fall back to
a "View original page" link into the full cached source. The rest of the UI
(persistent left facet sidebar, blue/purple/gray palette, docs-grade
typography — see [`DESIGN.md`](DESIGN.md) in this theme) follows the same
foundation as this repository's other `docuforge`-derived themes, and it
exercises the same `/api/v2/*` surface, so it remains a drop-in alternative
to the bundled `bootstrap` reference theme it was built from.

Activate it by setting `theme.default=helpdesk` in the admin UI
(`/admin/theme/`) or by binding it to a virtual host.

## Features

| Feature | Notes |
|---|---|
| **Inline accordion answers** | Click a result and its excerpt expands in the results list itself (`.hd-answer` / `.hd-answer-toggle`); the clamp is CSS-only, so expanding costs no request. See `DESIGN.md` for the accessibility contract. |
| **"View original page"** | Always shown when a cache exists, independent of whether there is an inline excerpt to expand — the only path back to the source for image-only or near-empty pages. |
| **Featured answer** | An admin-authored "best bet" card (`/admin/relatedcontent/`) sourced from `related_contents` and sanitized before render. |
| **Category tiles** | The home view renders one tile per registered label (`/api/v2/labels`), linking straight into `?q=&fields.label=<value>` category browsing. |
| **Optional AI escalation** | The existing RAG chat view (gated by the `rag_chat_enabled` feature flag) is reused unmodified as an escalation path for questions the FAQ excerpts don't answer. |

⚠️ **This theme does not work correctly on stock Fess defaults.** See
"Required server settings" below before evaluating it.

## Layout

```
helpdesk/
├── theme.yml           # manifest (kind: StaticTheme, name: helpdesk)
├── index.html          # SPA shell — semantic HTML5, no Bootstrap
├── thumbnail.png       # shown in /admin/theme/ (≤512KB, ≤512x512)
├── assets/
│   ├── compat.js       # Bootstrap-JS-API shim (Modal/Collapse/Dropdown/Offcanvas/Tooltip)
│   ├── styles.css      # self-contained HelpDesk stylesheet (tokens + utilities + components)
│   ├── app.js          # entry point; loads modules in order; renders home category tiles
│   ├── api.js          # centralised fetch wrapper (CSRF, envelope)
│   ├── auth.js         # login, logout, /auth/me probe
│   ├── search.js       # search, facets, pagination, sort, favorite, and the FAQ accordion
│   ├── helpdesk.js     # FAQ-specific pure helpers (answer/title HTML, cache href, best bets) — DOM-free, unit tested
│   ├── advance.js      # advanced-search form
│   ├── chat.js         # optional RAG chat (rag_chat_enabled feature flag) — the AI-escalation path
│   ├── cache.js        # document cache viewer (sandboxed iframe) — the "View original page" target
│   ├── profile.js      # password change form
│   ├── error.js        # error pages (400/404/429/500/503)
│   ├── help.js         # help page renderer
│   ├── format.js       # date/size/HTML-sanitiser helpers
│   ├── markdown.js     # minimal markdown renderer (chat)
│   ├── i18n.js         # JSON bundle loader; navigator.language → en/ja
│   ├── router.js       # client-side SPA router
│   ├── logo.png        # home hero logo
│   └── logo-head.png   # header brand logo (white, sits on the dark top-bar)
├── i18n/               # messages.<locale>.json (16 locales)
├── help/               # <locale>.json help content (8 locales) — includes an "accordion" section
└── README.md
```

> **`thumbnail.png`:** the preview shown in the `/admin/theme/` picker
> (≤512×512, ≤512 KB). Swap in an updated screenshot if the UI changes.

## Derivation

The shared SPA core (`api.js`, `auth.js`, `router.js`,
`markdown.js`, `profile.js`, `error.js`, `cache.js`, `advance.js`, `chat.js`,
`compat.js`, `i18n.js`) is **byte-for-byte identical** to the `docuforge`
theme this one was built from, except for the hard-coded `/themes/<name>/…`
asset paths and in-file theme-name mentions. `format.js` is **not** on that
list: it diverges (`sanitizeNode()`'s `DROP_WITH_CONTENT` set, added in
`c28df7d`) so raw-text elements like `<script>`/`<style>`/`<textarea>` are
dropped whole instead of unwrapped — a deliberate security fix, not drift;
do not re-sync it from docuforge. `search.js` and `app.js` carry this
theme's real deltas (the accordion render path, best-bet card, home
category tiles), and `assets/helpdesk.js` is new — a small, DOM-free module
of FAQ-specific helpers (`answerHtml`, `titleHtml`, `plainTitle`, `cacheHref`,
`bestBets`), kept separate from `search.js` specifically so it can be unit
tested under plain Node (`scripts/test-helpdesk-helpers.mjs`) with no
browser or DOM shim required.

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

The shim is XSS-safe (no `innerHTML` with dynamic data), honours
`prefers-reduced-motion`, and dispatches **no** `*.bs.modal`/`*.bs.collapse`
events — code that depends on those (e.g. the bundled `bootstrap` reference
theme's `auth.js`) cannot be copied in as-is. See `DESIGN.md` for why this
theme's own `auth.js` avoids that dependency.

---

## ★ Required server settings

**These are required, not recommended.** On a stock Fess install, the inline
answer is a ~120-character teaser with its opening clause silently
discarded — not a usable answer. Set all four before evaluating this theme:

```properties
# Without these the inline answer is a ~120-character teaser with its opening
# clause silently removed — not an answer.
query.highlight.fragment.size=1000
query.highlight.number.of.fragments=1

# true (the default) discards everything before the first match's clause: on
# a match, ViewHelper.escapeHighlight() walks backward from the match and cuts
# at the nearest "terminal" character — and query.highlight.terminal.chars
# includes U+002C, a COMMA. Any clause before the first comma before a match
# is silently dropped, not just sentence starts.
query.highlight.boundary.position.detect=false

# 0 (the default) means: when there is no query to highlight against — e.g.
# category browsing via /search?q=&fields.label=X — no hl_content is
# produced at all, and the answer falls back to `digest`, which is capped at
# crawler.document.html.max.digest.length (see below). fragment.size above
# has NO effect on this path; only no.match.size controls it.
query.highlight.no.match.size=500

# Raises the floor for the digest fallback path above. Requires a re-crawl —
# it only affects content indexed after the change.
crawler.document.html.max.digest.length=500
```

`fragment.size=1000` and `no.match.size=500` are the values measured against
the `docker-faqsearch` demo corpus (see that repo's
`conf/fess_config.overlay.properties` for the full measurement writeup): its
longest answer is 445 characters, and 1000 / 500 were the smallest of
500/1000/2000/3000 that carried it whole on the keyword-search and
category-browsing paths respectively. **These two values are
deployment-specific** — they depend on the length of a typical answer in
your corpus, and a corpus with longer answers needs larger numbers. Measure
your own corpus with a real verification pass (search for a term inside
your longest answer's last sentence, confirm `content_description` isn't
truncated) rather than assuming these numbers transfer as-is. Until you have
measured your own values, start from a generous placeholder (e.g.
`fragment.size=2000`, `no.match.size=2000`) and tune down once you can see
real answers rendering without excess trailing text.

## Admin-panel registration

HelpDesk's home view and result cards are driven entirely by data an admin
registers — there is no theme-side configuration beyond the server settings
above:

- **Labels** (`/admin/labeltype/`) — power both the home view's category
  tiles and the facet sidebar's Category group. A label with no
  documents assigned to it still appears as an (empty) tile; assign labels
  to crawl configs or via `label` scoping to populate them.
- **Related content** (`/admin/relatedcontent/`) — admin-authored raw HTML
  shown as the "Featured answer" card above the results for a matching
  query. Sanitized client-side (`format.js sanitizeHtml()`) before render.
- **Related query** (`/admin/relatedquery/`) — related-search suggestions.

> **Registering a related query changes the search results themselves, not
> just a UI chip row.** Fess's `QueryStringBuilder` (`buildBaseQuery()`,
> `QueryStringBuilder.java:177-190`) **OR-expands** every registered related
> query into the actual search query sent to OpenSearch — the original
> query and each related query are combined with `OR` and the whole group is
> executed as one search. This means a related-query registration changes
> **which documents match and how many results are returned**, not merely
> what appears as a suggestion chip. Review related-query registrations with
> the same care as a query rewrite, because that is exactly what they are.

## Known limitations

1. **Long or structured answers do not render well inline.** The inline
   excerpt is sourced from `content`, which is passed through
   `TextUtil.normalizeText()` server-side — this collapses line breaks, so
   paragraphs, lists, and code blocks in the source page are flattened to a
   single run of text in the excerpt. This theme is optimized for **short,
   one-question-per-answer FAQ content**; anything more structured should
   rely on "View original page" to show the real, fully formatted source.
2. **No images render inside an inline answer.** The server CSP allows
   `img-src 'self' data:` only, and the excerpt HTML itself only ever
   contains `<strong>` from server-side highlighting — there is no path for
   an `<img>` to appear in an inline answer regardless of CSP.
3. **Registering a related query changes the result set** — see above.
4. **"Popular searches" depends on search-log history.** On a freshly
   deployed instance with no query history, the section renders nothing and
   is hidden entirely, not shown empty.
5. **`query.highlight.fragment.size` is a global server setting**, not
   per-theme or per-request. Raising it increases the size of every search
   response, because more highlighted text is generated and transferred for
   every hit, on every theme active on the server — not just this one. The
   accordion's CSS clamp only affects what is **visually** shown; it does
   not reduce what is fetched over the network, so tune `fragment.size`
   conservatively even though the UI hides the excess.

---

## Design system

`assets/styles.css` defines the HelpDesk tokens (`--hd-*`) and implements the
full utility/component layer on top of them; see [`DESIGN.md`](DESIGN.md) for
the full token tables, the accordion's accessibility contract, and the
rationale behind several choices (why `content_description` is assigned
verbatim, why Google Fonts are not used, why the facet sidebar is kept).

- **Palette:** primary `#2563EB`, secondary (purple) `#7C3AED`, neutrals
  (zinc), success/warning/error accents.
- **Type:** system font stack throughout (headings, body, and monospace) —
  no webfont request, so the theme renders with zero extra network round
  trips and needs no font-related CSP relaxation.
- **Layout:** persistent 280px facet sidebar on the left (sticky on
  desktop), results to the right; collapses to an offcanvas on mobile. Kept
  primarily so the required element IDs (`#facet-body`, `#facet-body-mobile`,
  `#facetOffcanvas`) stay present; under the recommended
  `query.facet.fields=label` configuration it shows a single Category group
  that duplicates the home view's category tiles (see `DESIGN.md`).

## API endpoints consumed

All under `/api/v2` — identical to the reference theme, plus `/labels` for
the home-view category tiles. See `api.js` (the single source of truth) and
the Fess static-theme API reference doc.

## CSP

`index.html` uses a strict `Content-Security-Policy`:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; connect-src 'self'; frame-src blob:; child-src blob:;
base-uri 'self'
```

No relaxation is required for fonts or any other external resource — the
theme runs fully offline / strictly self-hosted out of the box. See
`DESIGN.md` for why this is possible (system fonts, no webfont host).

## Customising

Copy this directory, rename it, edit `theme.yml#name` to match, update the
hard-coded `/themes/helpdesk/…` paths in `index.html`, `help.js`, and
`i18n.js`, then upload as a ZIP via `/admin/theme/`.

## License

Apache-2.0 — same as Fess.

Unlike some other themes in this repository, [`DESIGN.md`](DESIGN.md) here is
an **original document** written for this theme, not a third-party design
specification — it is Apache-2.0, the same as the rest of this theme.
