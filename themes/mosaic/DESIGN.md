# Mosaic Design System

## Concept

Mosaic's core idea is **"see your whole corpus at a glance."** Where a conventional search theme answers a query with a scrollable list of links, Mosaic answers with a thumbnail gallery — a mosaic of tiles the eye can scan the way it scans a photo grid or a contact sheet. This framing fits its target use case: multimodal search over a mixed corpus, where a meaningful fraction of results are images (or documents best recognized by their preview) and where a query can be matched by what it *looks like* (CLIP-style visual similarity) as much as by what it *says* (keyword/BM25).

The name reflects that duality: individual tiles (keyword hits, visual hits, blended hits) assembling into one coherent picture of "what this deployment knows," with each tile's border/badge honestly labeling how it got there.

## Palette

| Token | Hex | Role |
|---|---|---|
| Brand primary (`--df-primary`) | `#6D28D9` | Buttons, active fills, key accents |
| Brand hover (`--df-primary-hover`) | `#5B21B6` | Hover state, darker accent |
| Secondary / links (`--df-secondary`) | `#0369A1` | Link text, secondary actions, focus indicators |
| Page background (`--df-bg`) | `#FAFBFF` | Body background — cool near-white |
| Card surface (`--df-surface`) | `#FFFFFF` | Result cards, panels, modals, tiles |
| Neutral stone-100 (`--df-stone-100`) | `#F4F6FB` | Sidebar, tile caption border, skeleton background |
| Neutral stone-200 (`--df-stone-200`) | `#E2E8F0` | Card and panel borders |
| Neutral stone-500 (`--df-stone-500`) | `#64748B` | Muted icons/secondary text |
| Neutral stone-900 (`--df-stone-900`) | `#0F172A` | Headings, dark header background |

The neutral palette is a cool slate, deliberately kept out of the badges/tiles/spines themselves — the gallery grid and its provenance colors are what carry visual interest; the surrounding chrome (header, sidebar, cards) stays quiet so the thumbnails read as a real media gallery rather than a colorful dashboard.

## Source-of-match color system

Every place Mosaic surfaces *how* a result was found — gallery tile corner badge, lightbox metadata badge, list-mode badge pill, list-mode card left spine, the composition bar, and the filter-sidebar caption — draws from the same three CSS custom properties, defined once in `assets/styles.css`'s `:root`. Each is a base/subtle-background/accessible-text triple:

| Kind | CSS variable | Base | Subtle bg | Text | Meaning |
|---|---|---|---|---|---|
| Keyword | `--mm-keyword` | `#D97706` | `#FEF3E2` | `#9A5A05` | Matched by BM25/keyword search only — amber |
| Visual | `--mm-visual` | `#7C3AED` | `#F1E9FE` | `#5B21B6` | Matched by image similarity (CLIP-style vector search) only — violet |
| Blend | `--mm-blend` | `#0D9488` | `#DCF5F1` | `#0B6B62` | Matched by both keyword and visual similarity — teal |

Amber for Keyword (warm, concrete, familiar — "found the words"), violet for Visual (evocative of vision/perception), and teal for Blend (a synthesis of the other two, reused as the hero's central "shared embedding" node color). The three hues remain visually distinct across the most common forms of color-vision deficiency, and are never the *only* signal — see Accessibility below.

## Structure: gallery / tile / lightbox / hero

Mosaic's result-facing UI is built from four layered components:

1. **Gallery** (`ul.gallery`) — a responsive CSS grid (`repeat(auto-fill, minmax(160px, 1fr))`) of tiles; this is the default result view (`state.viewMode = "grid"`), backed by the same `<ul id="results">` element the traditional list view (`ul.list-unstyled.results--list`) reuses when the user toggles to list mode.
2. **Tile** (`li.tile`) — a square thumbnail (`aspect-ratio: 1/1`, `object-fit: cover`) with a caption strip below it and an optional searcher badge pinned to the top-left corner. Tiles lift and their image scales up slightly on hover/focus; a `.tile--noimg` variant substitutes a typed file icon when there is no usable thumbnail.
3. **Lightbox** (`#lightbox`) — a fixed, full-viewport dark overlay opened by activating a tile. It shows the largest available image, a metadata panel (title, source link, facts, searcher badge, cache action), and Prev/Next buttons that step through the current result page. It is a proper modal dialog: focus-trapped, restores focus to the originating tile on close, and fades/pops in on open.
4. **Hero** (`.mosaic-hero`, home view only) — see below.

## The multimodal hero

### Concept

The home view's full-bleed dark band visualizes Mosaic's core mechanism directly: a **shared embedding space** where short text tokens and small image tiles are two representations of the same kind of thing, converging on one point.

### Implementation (what the code actually does)

`assets/home-hero.js` drives a `<canvas>` (`#mosaic-hero-canvas`) with two independent particle streams, driven by `requestAnimationFrame`:

- **Text tokens** — small pill shapes — spawn off-screen on the **left** edge and drift toward the canvas center with an ease-out curve, colored with `--mm-keyword`.
- **Image tiles** — small rounded squares with a corner highlight dot (evoking a lens/aperture glint) — spawn off-screen on the **right** edge and drift toward the center, colored with `--mm-visual`.
- Both streams fade in on spawn, wobble slightly as they travel, shrink slightly as they approach, and fade out as they merge into a **central pulsing node**, colored with `--mm-blend` and rendered with a soft radial glow.

Colors are read live from the theme's `--mm-keyword` / `--mm-visual` / `--mm-blend` custom properties via `getComputedStyle`, with hardcoded hex fallbacks, so the hero always matches the badge/tile/spine palette even if the tokens are customized. There is no WebGL, no image assets, and no external library — it is a small hand-rolled particle system (~20–64 particles, scaled to the hero's area) using canvas primitives only.

Layered over the canvas, the real `#contentQuery` search input is restyled as a glowing pill whose box-shadow gently breathes between the keyword (amber) and blend (teal) hues via a CSS `@keyframes` animation — a second, purely-CSS echo of the same "signals converging" idea.

### Typewriter placeholder

`home-hero.js` also animates the `placeholder` attribute of `#contentQuery` (never its `.value`, so it can never corrupt real user input), cycling through four localized example queries (`home.example_1..4`, e.g. *"a red sports car at sunset"*, *"snow-capped mountains"*). It types and deletes each phrase with a small per-character delay and a hold at full length. It yields to the user the instant they type a non-empty value into the box — but **mere focus does not stop it**, so an empty, focused input keeps showing the animated example, which is what makes the effect visible on first load. It resumes when the input is blurred while still empty.

### Performance and accessibility

- The canvas's `requestAnimationFrame` loop is started only in `setActive(true)` (called by `app.js`'s `showView()` when the home route is active) and is stopped via `cancelAnimationFrame` both when the home view is hidden and whenever `document.visibilitychange` reports the tab is backgrounded — zero CPU/battery cost while the user is anywhere else in the app.
- Under `prefers-reduced-motion: reduce`, the canvas renders exactly one static frame (no `requestAnimationFrame` loop is ever scheduled), the typewriter is replaced with a single static example string, and the search-pill glow animation is disabled in CSS.
- The canvas is `aria-hidden="true"`; it is purely decorative, and the real, always-present `#contentQuery` input carries the actual accessible search semantics.
- No inline scripts are used anywhere; `home-hero.js` is a standard ES module imported by `app.js`, satisfying the theme's `script-src 'self'` CSP with no relaxation.

## Accessibility

- **Icon + text, never color alone (WCAG 1.4.1).** Every searcher badge — gallery tile corner badge, lightbox meta badge, and list-mode pill — renders a Font Awesome icon (`aria-hidden="true"`) together with a visible, localized text label, and carries a matching `aria-label`/`title` for assistive technology. The list-mode "Matched by …" microcopy line is text-only by construction.
- **`aria-live` for compositional/dynamic updates.** The Search Composition band (`role="note" aria-live="polite"`) and the results-status line (`aria-live="polite"`) announce their content after each search without interrupting the user; the lightbox is `role="dialog" aria-modal="true"` with a maintained tab order and focus restored to the triggering tile on close.
- **`prefers-reduced-motion` handling.** Every animated element in the theme — the hero canvas and search-pill glow, tile hover lift/image zoom, lightbox fade/pop, skeleton-loading shimmer, and the search-options drawer/offcanvas/modal transitions — is disabled or collapsed to a static equivalent under `(prefers-reduced-motion: reduce)`. This is handled independently in both `styles.css` (`@media (prefers-reduced-motion: reduce)` blocks) and `home-hero.js` (checks `window.matchMedia` directly and reacts live to runtime changes via the media query's `change` event).

## Graceful degradation

The `searcher` field is only present on a hit when the backend has both `query.additional.api.response.fields=searcher` set **and** hybrid rank fusion actually active (e.g. a multimodal plugin blending keyword and CLIP-vector search). Every provenance-driven element in the theme is written to check for this field's presence and silently omit itself when absent:

- `searcherBadgeKind()` returns `null` for a hit with no `searcher` data → no corner badge, no list-mode badge, no colored card spine, no "Matched by …" microcopy for that hit.
- `renderComposition()` hides the Search Composition band entirely (`d-none`) when **no** hit on the page carries a known searcher kind.
- The filter-sidebar's mode-aware caption (`.facet-cap`) is only rendered when the page tally has at least one classified hit.
- The quote-on-filter query rewrite is gated on `semanticSeen` (a sticky flag set the first time any hit ever carries a `searcher` value in the current session), so a keyword-only deployment's queries are never rewritten.

The gallery grid, lightbox, and grid/list toggle are **not** gated on `searcher` at all — they work identically with or without multimodal search configured, using the plain thumbnail endpoint and standard result fields. This means Mosaic is a fully valid, visually coherent theme on a stock Fess install with no multimodal plugin at all; the searcher badges are a progressive enhancement, not a hard dependency.

## Component inventory

- **`.gallery` / `.tile` / `.tile--noimg`** — the grid-mode result list and its tiles, with the no-thumbnail fallback variant
- **`.view-toggle` / `.view-toggle__btn`** — the persistent grid/list toggle above the results, synced to `localStorage("mosaic.view")`
- **`#lightbox` / `.lightbox__*`** — the full-screen preview overlay and its close/prev/next controls and metadata panel
- **`.mosaic-hero` / `.mosaic-hero-canvas` / `.mosaic-hero-pill`** — the home view's multimodal-convergence hero band
- **`.mosaic-preview-cards` / `.mosaic-preview--{kw,vi,bl}`** — the three educational Keyword/Visual/Blend cards below the hero
- **`.mm-brandmark`** — a small four-quadrant conic-gradient "mosaic tile" glyph in the header brand link (pure CSS, no image request), combining the three source-of-match hues with the secondary accent
- **`.searcher-badge` / `.searcher-badge--{keyword,visual,blend}`** — list-mode badge pill
- **`.badge.badge--{keyword,visual,blend}`** — gallery-tile / lightbox-meta badge (distinct markup/CSS namespace from the list-mode pill, styled independently)
- **`li.result--{keyword,visual,blend}`** — list-mode result root, drives the 3px colored left spine
- **`.result-why` / `.result-why--{keyword,visual,blend}`** — per-card "Matched by …" microcopy line
- **`#search-composition` / `.comp-*`** — the Search Composition band (lead count, verdict, proportional bar, legend)
- **`.filter-opt` / `.filter-chk`** — count-free clickable filter rows and their checkbox indicators in the sidebar
- **`.facet-cap` / `.cap--visual` / `.cap--mixed`** — the mode-aware sidebar caption
- **`.skeleton` / `.skeleton-*`** — shimmering loading-placeholder blocks (offline-first design, reused across views)

## Out of scope / follow-ups

- **Real Mosaic branding art.** `logo.png`, `logo-head.png`, and `thumbnail.png` are placeholder graphics; a genuine logo and a real product screenshot are a follow-up task.
- **Accurate per-bucket filter counts.** As with the count-free rationale above, showing true per-option counts would require a separate fan-out request per filter option; count-free was chosen to avoid the N-parallel-requests cost and the "counts exclude visual matches" confusion a keyword-only aggregation would otherwise cause.
- **Interactive server-side mode switch.** Whether hybrid rank fusion is active is a server/plugin-level configuration decision, not something the theme can toggle at request time.
