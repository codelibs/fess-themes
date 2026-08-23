# Mosaic — Fess Static Theme (Multimodal Gallery Search)

Mosaic is a **self-contained**, thumbnail-first Fess static theme built for **multimodal search**: text→image (CLIP-style) visual matching blended with keyword/BM25 full-text search over a mixed document/image corpus. Results are presented as a photo-gallery grid rather than a plain link list, with a full-size lightbox viewer for previewing hits in place.

Mosaic is designed for stacks such as `docker-multimodalsearch` (Fess + a multimodal search plugin + a CLIP embedding server), but it degrades gracefully to a perfectly usable general-purpose search theme on a stock Fess deployment with no multimodal configuration at all.

## Installation

```bash
cd repos/fess-themes
./scripts/package.sh mosaic
# Produces dist/mosaic-<version>.zip
```

Upload the ZIP via **Admin > Theme** (`/admin/theme/`) in the Fess admin console, or set

```properties
theme.default=mosaic
```

in `fess_config.properties` (or as a Java system property) and restart Fess.

## What it is

- **Gallery grid** — search results render as square thumbnail tiles (`ul.gallery` / `li.tile`) by default, so a corpus of images/documents can be scanned at a glance rather than read line by line.
- **Grid / list toggle** — a persistent `#view-toggle` control switches between the gallery grid and a traditional list of result cards; the choice is remembered per browser via `localStorage("mosaic.view")`.
- **Lightbox viewer** — clicking (or pressing Enter/Space on) a tile opens a full-screen overlay with the larger image, title, source link, facts (type/size/date/score), a searcher badge when available, and Prev/Next navigation across the current result page. It is a focus-trapped, `aria-modal="true"` dialog, closable via the close button, `Esc`, or backdrop click, and restores focus to the tile that opened it.
- **Multimodal home hero** — the `#home-view` opens on a dark, full-bleed band with a decorative canvas animation and a typewriter-animated search placeholder (see "Home hero" below), instead of a plain logo-and-search-box.

## Requirements / Configuration

Mosaic works on any Fess 15.8+ install with zero extra configuration — it is a valid general-purpose theme on its own. The searcher-provenance features described below only activate when the backend is additionally configured for multimodal/hybrid search:

```properties
query.additional.api.response.fields=searcher
```

(note: the `.api.` variant of the property, since the theme reads the field from the `/api/v2/search` JSON response) **plus** hybrid rank fusion enabled on the server (e.g. a multimodal search plugin performing keyword + CLIP-vector rank fusion, such as in the `docker-multimodalsearch` stack). When either piece is missing, the `searcher` field is simply absent from every hit and Mosaic **silently omits** every provenance-driven element (badges, composition band, colored card spine, filter-sidebar caption) — the theme still functions as a normal search UI, just without the extra context.

## Searcher badges: Keyword / Visual / Blend

When a hit carries the `searcher` field, Mosaic classifies it into one of three kinds and surfaces it consistently everywhere the result appears:

| Kind | Meaning | Source values |
|---|---|---|
| **Keyword** | Matched by full-text/BM25 search only | `default` |
| **Visual** | Matched by image similarity (CLIP-style vector search) only | `multi_modal` |
| **Blend** | Matched by both keyword and visual similarity | `default` + `multi_modal` |

Every badge is an icon **and** a visible text label (never color alone — see Accessibility). It appears as:

- a small pill badge in the top-left corner of a gallery tile, and in the lightbox metadata panel;
- a pill badge to the right of the title, a colored 3px left border on the card, and a one-line "Matched by …" caption, in list view;
- a **Search Composition band** (`#search-composition`) above the results, summarizing the page's retrieval mix as a total count, a plain-language verdict ("A balanced blend…", "Mostly visual matches", "Mostly keyword matches"), a proportional 3-segment bar, and a count-free color legend. Hidden whenever no hit on the page carries a known searcher kind.
- a **mode-aware caption** at the top of the filter sidebar, explaining that clicking a filter narrows the full fused result set, not just the keyword branch.

The home page also shows three static "preview cards" (Keyword / Visual / Blend) that explain the badge vocabulary up front, regardless of whether the backend exposes `searcher` — these are purely educational and always render.

### Count-free filter sidebar

The sidebar's filter groups (file type, updated, size) are sourced from the query-independent `GET /api/v2/ui/config` endpoint rather than from the search response's facet buckets, so they stay populated even for visual-only queries that return no BM25 facet counts. No per-option counts are shown, since a hybrid deployment's aggregation counts only reflect the keyword branch and would otherwise be misleading.

### The query is sent verbatim

Mosaic sends whatever the user typed, unchanged, whether or not a filter is active.

Earlier versions quoted a multi-word query into a single phrase once a filter was applied, to dodge an HTTP 400 that the 15.7 plugin's `content_vector` inner-hits raised. On Fess 15.8 that workaround is actively harmful: a quoted phrase is real query syntax, so the core's query-syntax gate skips the vector branch — meaning every filtered search would silently lose its visual results. Filter conditions are lifted into the kNN query on the server side instead, so visual matches survive filtering without any client-side rewriting.

## Thumbnails

Gallery tiles and the JSP-parity list-view thumbnail both load images from the same-origin `/thumbnail/?docId=&queryId=` endpoint, lazily via `IntersectionObserver` (native `loading="lazy"` is intentionally not also set, to avoid double-gating). Because thumbnail generation can be an asynchronous server-side job, a failed load is retried with a backoff schedule of **2s → 5s → 15s → 30s**; once every retry is exhausted, the tile converts to a typed file-icon placeholder (`.tile--noimg`) instead of showing a broken-image glyph.

The **lightbox** prefers the crawled full-resolution image over the thumbnail: it uses the hit's `url_link` when the hit's mimetype starts with `image/` **and** the URL is displayable under the theme's CSP — that is, its scheme is `https:`, **or** it resolves to the page's own origin (same-origin `http:` URLs are also allowed; only bare cross-origin `http:` is excluded, since the CSP's `img-src` has no plain `http:` source). In every other case (non-image hit, unsafe/cross-origin `http:` URL, or missing `url_link`) the lightbox falls back to the same `/thumbnail/?docId=&queryId=` endpoint the gallery tile uses.

## Home hero

The `#home-view` route opens with a full-bleed dark band (`.mosaic-hero`) containing a decorative `<canvas>` (`assets/home-hero.js`) that visualizes a shared text/image embedding space: short text-token chips stream in from the left (colored with `--mm-keyword`), small image tiles stream in from the right (`--mm-visual`), and both drift toward a central pulsing "shared embedding" node (`--mm-blend`). Colors are read live from the theme's CSS custom properties, with hardcoded fallbacks. The canvas runs on `requestAnimationFrame`, is paused whenever the home view is not visible or the tab is backgrounded, and renders a single static frame (no animation) under `prefers-reduced-motion`.

Layered over the canvas is the real search box, restyled as a glowing pill (`.mosaic-hero-pill`) whose glow breathes gently between the keyword and blend hues. The `#contentQuery` input's `placeholder` (never its value) is animated with a typewriter effect that cycles through four localized example queries (`home.example_1..4`); it yields to the user the moment they type a non-empty value (mere focus does **not** stop it, so an empty focused box keeps showing the animated example) and resumes on blur-while-empty. Under `prefers-reduced-motion`, the first example is shown statically instead.

Below the hero, three preview cards straddle the hero/light boundary, introducing the Keyword / Visual / Blend badge vocabulary (see above) before the user has even searched.

## Content Security Policy

Mosaic ships a tightened CSP (see `<meta http-equiv="Content-Security-Policy">` in `index.html`):

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
font-src 'self'; img-src 'self' data: https:; connect-src 'self';
frame-src blob:; child-src blob:; base-uri 'self'
```

`img-src 'self' data: https:` is **intentionally widened** beyond the otherwise-strict `'self'` so the lightbox and gallery tiles can display crawled images served over HTTPS from third-party origins (a same-origin-only policy would break visual search on any multi-domain corpus). Every other directive stays strict:

- `script-src 'self'` — no inline JavaScript anywhere in the theme, no `unsafe-eval`.
- `style-src 'self' 'unsafe-inline'` — the one relaxation beyond `script-src`, required because `search.js` sets a handful of inline style properties at runtime (e.g. the composition band's proportional bar segment widths); no external stylesheet host is ever referenced.
- `font-src 'self'` — **system fonts only**; there is no `<link>`/`@import` to Google Fonts or any other web-font host anywhere in the theme, so this directive requires no relaxation.
- `connect-src 'self'` — all API calls are same-origin.
- `frame-src blob:` / `child-src blob:` — needed for the cache viewer's sandboxed iframe.

## Accessibility

- Every searcher badge renders an icon **and** a visible text label — color is never the sole signal (WCAG 1.4.1). Screen readers get a matching `aria-label`/`title`.
- The Search Composition band and results-status line use `aria-live="polite"` so assistive technology is informed of updates without interrupting.
- The lightbox is a focus-trapped `role="dialog" aria-modal="true"` overlay with a logical tab order, Escape-to-close, and focus restoration on close.
- All motion (hero canvas, search-pill glow, tile hover/lift, lightbox fade/pop, skeleton shimmer) is disabled or reduced to a single static state under `prefers-reduced-motion: reduce`.

## Graceful degradation

On a Fess deployment without `query.additional.api.response.fields=searcher` and/or without hybrid rank fusion, the `searcher` field never appears on a hit. Mosaic then renders with **zero badges, no composition band, no colored card spine/caption, and no quote-on-filter rewriting** — the gallery grid, lightbox, view toggle, and every other core feature keep working exactly the same, so Mosaic remains a fully valid theme for a plain keyword-search Fess install.

## Design tokens (source-of-match palette)

Mosaic's badges, tile corners, card spines, and the composition bar all key off three CSS custom properties defined in `assets/styles.css`:

| Token | Base | Subtle bg | Text | Meaning |
|---|---|---|---|---|
| `--mm-keyword` | `#D97706` | `#FEF3E2` | `#9A5A05` | Matched by keyword/BM25 only — amber |
| `--mm-visual` | `#7C3AED` | `#F1E9FE` | `#5B21B6` | Matched by image similarity only — violet |
| `--mm-blend` | `#0D9488` | `#DCF5F1` | `#0B6B62` | Matched by both — teal |

See `DESIGN.md` for the full design rationale, neutral surface tokens, and component inventory.

## Layout

```
mosaic/
├── theme.yml             # manifest (kind: StaticTheme, name: mosaic)
├── index.html             # SPA shell — semantic HTML5, no Bootstrap
├── thumbnail.png          # shown in /admin/theme/ (placeholder gallery-grid graphic)
├── assets/
│   ├── compat.js           # Bootstrap-JS-API shim (Modal/Collapse/Dropdown/Offcanvas/Tooltip)
│   ├── styles.css          # self-contained Mosaic stylesheet (--mm-*/--df-* tokens)
│   ├── app.js               # entry point / router wiring
│   ├── search.js            # search, gallery/lightbox, searcher badges, composition band
│   ├── home-hero.js         # multimodal-convergence canvas + typewriter placeholder
│   ├── logo.png             # home hero logo (placeholder art)
│   └── logo-head.png        # header brand logo (placeholder art)
├── i18n/
│   ├── messages.en.json     # English (includes searcher.*, composition.*, sidebar.* keys)
│   ├── messages.ja.json     # Japanese
│   └── …                    # 14 more locales (16 total)
└── help/                    # help page content, one JSON per supported locale
```

> **Note:** `logo.png`, `logo-head.png`, and `thumbnail.png` are placeholder graphics; real Mosaic branding art and a genuine product screenshot are a follow-up task.

## Customise / repackage

```bash
cd repos/fess-themes
./scripts/package.sh mosaic
# Produces dist/mosaic-<version>.zip
```

Upload the ZIP via `/admin/theme/` or place it in Fess's theme directory. `README.md` and `DESIGN.md` are excluded from the packaged ZIP.
