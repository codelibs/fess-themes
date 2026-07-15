# HelpDesk Design System

## Overview

HelpDesk is a design system for a FAQ / support-site search experience. Its
central idea is that a search result **is** the answer: clicking a result
expands its excerpt inline, in place, with no page navigation. The rest of the
system — palette, typography, layout — is the same blue/purple/gray,
docs-grade foundation used across this repository's `docuforge`-derived
themes, kept deliberately quiet so the accordion interaction stays the
visual focus.

This document describes the actual, current design of the `helpdesk` theme in
this repository (`assets/styles.css`, `assets/search.js`, `assets/helpdesk.js`,
`index.html`). It is an original work written for this theme, not a
third-party artifact.

---

## Design tokens (`--hd-*`)

All tokens are defined once in `assets/styles.css`'s `:root` and consumed
throughout the stylesheet — there are no hardcoded hex values outside the
token block.

### Colors

| Token | Value | Role |
|---|---|---|
| `--hd-primary` | `#2563EB` | Links, primary buttons, focus rings, active state |
| `--hd-primary-hover` | `#1D4ED8` | Hover/active shade of primary |
| `--hd-primary-subtle` | `#EFF6FF` | Tinted backgrounds behind primary content |
| `--hd-secondary` | `#7C3AED` | Secondary accents |
| `--hd-secondary-subtle` | `#F5F3FF` | Tinted secondary backgrounds |
| `--hd-success` / `-subtle` | `#16A34A` / `#F0FDF4` | Success state |
| `--hd-warning` / `-subtle` | `#CA8A04` / `#FFF7ED` | Warning state |
| `--hd-error` / `-subtle` | `#DC2626` / `#FEF2F2` | Error state |
| `--hd-info` / `-subtle` | `#2563EB` / `#EFF6FF` | Info callouts |
| `--hd-highlight-bg` | `#fff3bf` | Background behind server-highlighted `<strong>` matches in an answer |
| `--hd-bg` | `#FAFAFA` | Page background |
| `--hd-surface` | `#FFFFFF` | Cards, panels, the answer accordion itself |
| `--hd-zinc-100`…`--hd-zinc-900` | `#F4F4F5` … `#18181B` | Neutral scale for text, borders, muted UI |

### Type

| Token | Stack |
|---|---|
| `--hd-font-head` | `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", …` |
| `--hd-font-body` | same system stack |
| `--hd-font-mono` | `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, …` |

HelpDesk deliberately uses the **system font stack**, not a webfont. See
"Why Google Fonts are not used" below.

### Radius / elevation

`--hd-radius-sm` (4px) through `--hd-radius-xl` (16px) and `--hd-radius-pill`
(9999px), plus a three-step shadow scale (`--hd-shadow-subtle` /
`-medium` / `-large`), shared with the other `docuforge`-family themes in
this repository.

---

## The FAQ accordion

This is the theme's reason for existing: a search result's excerpt expands
and collapses **in place**, inside `#result`, instead of sending the user to
a separate page.

### Where the answer text comes from — and why it is never re-escaped

`assets/helpdesk.js`'s `answerHtml(hit)` returns `hit.content_description`
**verbatim**, and `titleHtml(hit)` returns `hit.content_title` verbatim. Both
are assigned directly to `element.innerHTML` in `search.js` (`buildResultCard`).
This is safe, and required, for a specific reason:

The `/api/v2/search` response's `content_description` /  `content_title` have
already been through the server's `ViewHelper.getContentDescription()` /
`getContentTitle()` (`DefaultSearcher` lines 245–246), which runs
`LaFunctions.h()` (full HTML-escaping) over the whole field and then restores
**only** the configured highlight tags (`query.highlight.tag.pre/post`,
`<strong>` by default) — see `ViewHelper.escapeHighlight()`. The value is
therefore already innerHTML-safe HTML, with exactly one live tag.

If this were instead routed through `format.js`'s `renderHighlightedSnippet()`
— which itself escapes plain text before re-inserting `<strong>`/`<em>` — the
already-escaped server string would be **escaped a second time**: a
server-sent `&#039;` would become `&amp;#039;` and render as the literal
string `&#039;` on the page, and a server-sent `&amp;` would render as the
literal text `&amp;`. In a FAQ theme the title *is* the question, so
apostrophes ("What's…", "Don't…") are the common case, not an edge case,
which makes this bug far more visible here than in a plain document-search
result list. (The `docuforge` baseline this theme was forked from has exactly
this double-escape bug in its own `assets/search.js`, around the line that
assigns `renderHighlightedSnippet(d.content_description || d.digest || "")`
to `description.innerHTML` — a different file from this theme's
`assets/helpdesk.js`, and not present in this theme.)

### Accessibility contract

- **`aria-expanded` / `aria-controls`.** The "Show answer" / "Hide answer"
  toggle button carries `aria-expanded="false"`/`"true"` and
  `aria-controls="answer{n}"`, kept in sync on every click
  (`search.js` `buildResultCard`).
- **The clamp is visual only.** A collapsed answer gets the
  `.hd-answer--clamped` class, which applies `-webkit-line-clamp: 2` /
  `overflow: hidden` — a purely visual truncation. The full answer text is
  **always present in the DOM**, so in-page browser search (Ctrl+F / Cmd+F)
  and screen readers reach the complete text regardless of the clamp's
  visual state. Nothing is removed or lazily rendered.
- **The toggle appears only when the text actually overflows.** After layout
  (`requestAnimationFrame`), the code compares `answer.scrollHeight` against
  `answer.clientHeight`; the "Show answer" control is revealed only if the
  clamp is actually hiding content. A one-line answer never shows a toggle
  that would expand to nothing.
- **Distinct accessible names per card.** Each toggle's `aria-label` is
  suffixed with the plain-text question title (`plainTitle(d)`, which strips
  the server's `<strong>`/`<em>` highlight tags), so a screen-reader user
  tabbing through N result cards hears N distinct names instead of N copies
  of "Show answer".
- **"View original page" is independent of the toggle.** A document with no
  extractable excerpt (`content_description === ""`) renders neither an
  answer box nor a toggle — but if a cache exists, the "View original page"
  link is still shown. An image-only PDF or a near-empty page can have a
  cache with no extractable text; the link must not disappear along with the
  (absent) teaser, since it is the only path to the source for that result.

### Component inventory

- `.hd-answer-wrap` — flex child holding the answer and its actions
- `.hd-answer` / `.hd-answer--clamped` — the answer text and its collapsed state
- `.hd-answer strong` — server-highlighted match, background `--hd-highlight-bg`
- `.hd-answer-actions` — row holding the toggle and the "View original page" link
- `.hd-answer-toggle` — the expand/collapse control
- `.hd-best-bet` / `.hd-best-bet-title` / `.hd-best-bet-body` — the featured-answer
  card sourced from `/admin/relatedcontent/` (admin-authored raw HTML, always
  passed through `format.js sanitizeHtml()` before it reaches the DOM — see
  `bestBets()` in `assets/helpdesk.js`)
- `.hd-categories` / `.hd-category-tile` — the home-view category tiles, built
  from `/api/v2/labels` (role-filtered, localized; see `renderHomeCategories()`
  in `assets/app.js`)

---

## Accessibility (general)

Following the same pattern documented in this repository's `mosaic` theme
(`mosaic/DESIGN.md`):

- **Never color alone (WCAG 1.4.1).** The highlighted match inside an answer
  is marked up as `<strong>` (a real semantic emphasis element) with a
  background tint, not color alone; the same applies to focus indicators,
  which pair a 2px outline with `outline-offset`, never a color change alone.
- **`aria-live="polite"`** regions announce asynchronous state without
  interrupting the user: `#results-status`, `#results-notification`,
  `#related-queries`, `#similar-doc-banner`, and the featured-answer section
  (`#related-content[aria-live="polite"]`) all update this way after a search.
- **`prefers-reduced-motion`.** All animated transitions in `styles.css` are
  wrapped in `@media (prefers-reduced-motion: reduce)` blocks and collapse to
  their static end-state; the accordion's clamp/unclamp is a layout change,
  not an animation, so it is unaffected either way.

---

## Why not copy `assets/auth.js` (or anything else) from the bundled `bootstrap` theme

Do not use Fess core's bundled `bootstrap` reference theme as a shortcut when
touching this theme's modal/dropdown/offcanvas behavior. Two reasons:

1. **It has no `compat.js`.** The bundled `bootstrap` theme loads the real
   `/js/bootstrap.min.js` + `/js/popper.min.js` from Fess core. This theme
   (like every theme in this repository derived from `docuforge`) ships
   **no Bootstrap** — `assets/compat.js` is a ~9 KB shim that implements only
   the subset of the `window.bootstrap` API (`Modal`, `Collapse`, `Dropdown`,
   `Offcanvas`, `Tooltip`) the shared SPA modules call.
2. **`compat.js` dispatches no `*.bs.modal` events.** The bundled theme's
   `auth.js` is free to listen for real Bootstrap events such as
   `hidden.bs.modal`, because the real library fires them. This theme's
   `assets/auth.js` does **not** rely on that event — the login-form reset
   logic instead watches the modal's `show` class directly with a
   `MutationObserver` (see the comment above that observer in `auth.js`),
   specifically because it needs to work identically "with both real
   Bootstrap and the `compat.js` shim, which dispatches no `*.bs.modal`
   events." Copying the bundled theme's `auth.js` verbatim into a
   `compat.js`-based theme would silently break the login-form reset: the
   `hidden.bs.modal` listener would simply never fire.

---

## Why Google Fonts are not used

`index.html`'s `Content-Security-Policy` meta tag is:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; connect-src 'self'; frame-src blob:; child-src blob:;
base-uri 'self'
```

There is no `font-src` directive. Per the CSP specification, a directive that
is not explicitly listed falls back to `default-src`, which here is
`'self'` — so any attempt to load a font from `fonts.gstatic.com` (or any
other external host) is blocked by the server-sent header CSP, regardless of
what the theme's own `<meta>` tag says. Browsers enforce the **intersection**
of the meta-tag CSP and any `Content-Security-Policy` response header Fess
itself sends, so relaxing only the theme's meta tag is not sufficient on a
server that also sends a stricter header. This is why `--hd-font-head` /
`--hd-font-body` / `--hd-font-mono` are system font stacks rather than
`@font-face` webfont references: they render correctly with **zero** CSP
changes, on any Fess deployment, offline or online.

(Contrast this with `docsearch`, which self-hosts its fonts as same-origin
`.woff2` files under `assets/fonts/` — a same-origin font load needs no CSP
relaxation at all. HelpDesk uses the system stack instead because a FAQ/
support UI benefits more from zero extra network requests and instant text
render than from a custom display face.)

---

## Facet sidebar: kept deliberately, mostly redundant

`#facet-body` (desktop sidebar), `#facet-body-mobile`, and `#facetOffcanvas`
(the mobile offcanvas panel) are present in `index.html` and are populated by
the unmodified `search.js` facet-rendering code. They are **required element
IDs** — `scripts/verify-theme.sh` fails a theme copy that drops any of them
— so they are not removed here even though, in this theme's expected
deployment shape, they add little:

- A FAQ site is expected to run with `query.facet.fields=label` (see the
  theme's `README.md`), so the only facet group that ever renders is
  **Category** (`labels.facet_label_title`).
- That single group is a near-duplicate of the home view's category tiles
  (`#home-categories`, built from `/api/v2/labels`) — both let a user filter
  or browse by the same admin-registered label set, just via two different
  UI affordances (a persistent sidebar filter vs. a set of clickable home
  tiles).
- Under that same facet configuration, the file-type facet is never
  registered, which means `labels.facet_filetype_title` ("File Type") and
  its accompanying `labels.facet_filetype_*` strings are **dead** — present
  in every i18n bundle for key-set parity with the other themes in this
  repository, but never rendered by `renderFacets()` because
  `state.fields.filetype` is never populated when `query.facet.fields=label`
  is the only configured facet field.

This is a deliberate trade-off, not an oversight: keeping the sidebar means
the theme still behaves correctly (and non-redundantly) on a deployment that
enables additional facet fields (time, size, file type) alongside labels,
rather than hard-coding an assumption that categories are the only facet a
FAQ site will ever want.

---

## Related documents

- `README.md` (this theme) — installation, the four required server settings,
  admin-panel registration steps, and known limitations.
- `mosaic/DESIGN.md` — the accessibility-pattern precedent this document's
  "Accessibility (general)" section follows.

## License

Apache-2.0 — same as Fess. This document is an original work written for the
`helpdesk` theme; it is not derived from, or a redistribution of, any
third-party design specification.
