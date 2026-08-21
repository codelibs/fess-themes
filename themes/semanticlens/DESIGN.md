# SemanticLens Design System

## Concept

SemanticLens is "a lens that reveals meaning" — it surfaces the **search provenance** (how each result was found) alongside the result itself. In a hybrid search deployment, results may be retrieved by keyword (BM25), by semantic vector similarity, or by both. SemanticLens makes this visible without cluttering the interface.

The name reflects the dual nature: a lens for semantic depth, combined with the precision of keyword retrieval.

## Palette

| Token | Hex | Role |
|---|---|---|
| Brand primary | `#6D28D9` | Buttons, active fills, key accents |
| Brand hover | `#5B21B6` | Hover state, darker accent |
| Secondary / links | `#0369A1` | Link text, secondary actions, focus indicators |
| Page background | `#FAFBFF` | Body background — cool near-white |
| Card surface | `#FFFFFF` | Result cards, panels, modals |
| Secondary surface | `#F4F6FB` | Sidebar, facet panel, legend background |
| Border | `#E2E8F0` | Card and panel borders |
| Muted text | `#475569` | Secondary labels, descriptions, metadata |

The palette is cool-slate rather than the warm-sand of NomadKit, signalling precision and analytical depth.

## Source-color system

The redesign replaced the original per-badge hardcoded hex with a unified three-color provenance system surfaced consistently across badges, card spines, the composition bar, and sidebar captions. The colors are declared as CSS custom properties in `:root` (prefix `--sl-`), each with a base, a subtle background tint, and an accessible dark text variant:

| Kind | CSS variable | Base | Subtle bg | Text | Semantic meaning |
|---|---|---|---|---|---|
| Hybrid | `--sl-hybrid` | `#0D9488` | `#DCF5F1` | `#0B6B62` | Matched by both keyword and meaning — teal |
| Semantic | `--sl-semantic` | `#7C3AED` | `#F1E9FE` | `#5B21B6` | Matched by meaning / vector only — violet |
| Keyword | `--sl-keyword` | `#D97706` | `#FEF3E2` | `#9A5A05` | Matched by BM25 / keyword only — amber |

Teal was chosen for Hybrid (a synthesis of the two modes), violet for Semantic (evocative of meaning-space / embedding depth), and amber for Keyword (warm, concrete, familiar). Each hue family is perceptually distinct across the most common forms of color-vision deficiency.

## Accessibility rule: icon + text label, never color alone

Every badge renders an icon (`aria-hidden="true"`) **and** a visible text label. Color is a secondary reinforcement only. Screen readers receive the `aria-label` attribute on the badge span, which carries the full description (e.g. "Matched by meaning (vector search)"). The composition bar legend uses both color dots and text labels; the result microcopy is text-only.

This satisfies WCAG 1.4.1 (Use of Color) and ensures comprehension for users with color vision deficiency.

## Search Composition band

A frosted band (`#search-composition`) sits immediately above the result list and summarizes the retrieval mix for the current page:

- **Total** — the server's `record_count` localized with a "results" label.
- **Proportional bar** — three `<i>` segments (`comp-seg--hybrid/semantic/keyword`) whose `style.width` values are set from a read-only tally of the current page's `searcher` values. This tally is display-only; it is never used to build filter clauses (honors the no-client-side-facet-computation constraint).
- **Verdict** — a plain-language sentence chosen by thresholding: semantic share ≥ 60% → "Mostly meaning-matched"; keyword share ≥ 60% → "Mostly keyword matches"; otherwise → "A balanced blend". Intended to give users immediate intuition about the query's character.
- **Legend** — three color dots + labels (Hybrid / Semantic / Keyword), no per-source numbers (per explicit user decision).

The band is hidden (`d-none`) when `searcher` is absent on all current-page results, so non-hybrid deployments see nothing. It uses `aria-live="polite"` so assistive technologies announce updates after each search without interrupting.

The `tallyKinds(data)` helper that drives the bar is also reused by the sidebar caption, ensuring the two are always consistent.

## Count-free filter sidebar

### Rationale for no counts

In a hybrid deployment, the server's facet counts come exclusively from the BM25 (`default`) searcher's aggregation response. The semantic searcher's matches are fused into the result list by `RankFusionProcessor` after the fact; their contribution is not reflected in any facet bucket. Showing these counts would be actively misleading — users would see "PDF (12)" while the result list contains 30 PDFs found semantically. Removing counts entirely avoids the discomfort, is honest, and is consistent with the count-free composition band. The new `record_count` after each filter click provides immediate real feedback.

### Option sourcing from `/api/v2/ui/config`

Filter options are built at render time from `api.getConfig()` — a query-independent endpoint that is always populated regardless of whether the current query has BM25 matches. This solves the "empty sidebar for semantic-only results" problem: the three groups (File type from `filetype_options`, Updated and Size from `facet_views`) are structurally stable across every search.

### Mode-aware caption

A caption (`.facet-cap`) derived from `tallyKinds` sits at the top of the sidebar. It states how the current page was matched and what applying a filter will do:

- Semantic-dominant (semantic ≥ 60%): violet border, notes that most results are meaning-matched and that filtering falls back to keyword-only search.
- Otherwise: teal border, notes that filtering falls back to keyword-only search.

The caption is absent when `searcher` is not in the response.

## Filtering is keyword-only on Fess 15.8

Fess 15.8 skips the semantic branch for any query containing search syntax, judged on the **assembled** query. Every filter this theme offers adds such syntax — an `ex_q` clause from the sidebar, `label:"…"` from the label picker, `sort:…` from the options bar — so a filtered request never reaches the vector searcher.

The theme cannot change that from the client, so it surfaces it instead of hiding it: the sidebar caption says so up front, and the per-result badges independently show the truth (every hit on a filtered page is labelled Keyword).

### Why the quote-on-filter workaround was removed in 2.0.0

Versions up to 1.0.7 wrapped a multi-word query in double quotes whenever a filter was active. That existed for a bug in the 15.7 `fess-webapp-semantic-search` plugin: it auto-quoted an unfiltered whitespace query into one `neural` clause, but a `field:` token suppressed that quoting, producing one `neural` clause per word with duplicate `content_vector` inner-hits names, which OpenSearch rejected with HTTP 400.

15.8 replaced that plugin with core semantic search, which builds a single `knn` query and never emits inner hits by that name — the 400 cannot occur. Meanwhile a double quote is itself search syntax, so the workaround would now be actively harmful twice over: it would force the keyword-only path even for queries that would otherwise have kept it, and it would narrow the BM25 branch to a phrase match. Queries are sent verbatim, the same as every other theme; `test/semanticlens.searcher.test.js` pins that.

## Home / semantic-space hero

### Concept

The home/top view (`#home-view`) is the user's first encounter with SemanticLens. Instead of a static logo-plus-search-box, it opens on a dark "semantic-space" band that makes the theme's core idea — that keyword and semantic retrieval are two overlapping dimensions of meaning — immediately legible as a visual metaphor.

The background visualises a high-dimensional embedding space: nodes (documents) drift at random through the field, and edges (proximity lines) connect them when they draw near in that space. The amber and violet beams converging from opposite sides represent the keyword and semantic retrieval signals merging at the search box — a literal depiction of rank fusion. The pulsing lens mark at the centre echoes the brand motif and marks the point of synthesis.

### Animation approach

**Constellation canvas (`#sl-hero-canvas`)**: implemented in `assets/home-hero.js` as a `requestAnimationFrame` loop. Approximately 30–70 nodes are seeded with random positions and velocities, each assigned one of the three source-of-match colors (`--sl-keyword` amber, `--sl-semantic` violet, `--sl-hybrid` teal, resolved from CSS custom properties at init time with a hardcoded fallback). On each frame, positions are updated and a proximity check (128 px threshold) draws connecting lines at proportional opacity. The loop is intentionally low-cost: no WebGL, no image assets, no external libraries.

**Converging beams (`.sl-beam--kw`, `.sl-beam--se`)**: pure CSS — two `div` elements in `.sl-hero-bg`, styled as soft radial/conic gradient blobs that drift toward the centre using a CSS `@keyframes` animation. Amber from the left (keyword), violet from the right (semantic).

**Spectral lens mark (`.sl-hero-lens`)**: a CSS-only pulsing ring, `@keyframes` scale + opacity, using the brand violet.

**Typewriter placeholder**: `home-hero.js` animates the `placeholder` attribute of `#contentQuery` (never `.value`) cycling through four localized example queries. The typewriter respects user intent: it yields as soon as the input is focused or non-empty, and restores the plain placeholder. Under `prefers-reduced-motion` it sets the first example as a static placeholder and never animates.

### Accessibility and performance

- All decorative elements (`canvas`, beams, lens mark) carry `aria-hidden="true"`.
- The `requestAnimationFrame` loop is paused via `cancelAnimationFrame` whenever `setActive(false)` is called (user navigates away from the home view) or the `document.visibilitychange` event fires (tab backgrounded). No animation CPU is consumed while the user is on the results, help, or profile view.
- CSS animations on the beams and lens use `animation-play-state: paused` under `(prefers-reduced-motion: reduce)`. The canvas draw loop similarly skips to a single static frame and does not schedule further rAF calls.
- The module is a standard ES import (`import { homeHero } from "./home-hero.js"`), driven by `app.js`. No inline scripts; CSP `script-src 'self'` is unaffected.
- System fonts are used throughout the hero (consistent with the rest of the theme); no web-font requests are issued.

## Lens identity: brand mark (header gradient skipped)

The plan specified a header gradient (`linear-gradient(115deg,#1b1e3c,#3b2a78,#0d6b66)`) scoped to the search view. This was skipped in implementation: `.df-header` is a `position:fixed` global navbar rendered outside the per-view `<section>` elements, and `showView()` only toggles `hidden` on sections. There is no CSS hook to scope the gradient to the search view without editing `app.js` (out of scope).

What was added instead: a `<span class="sl-lensmark" aria-hidden="true">` inside the header brand `<a>`, styled with a CSP-safe `radial-gradient` + `conic-gradient` focus-ring mark in the three source colors. This marks SemanticLens visually in the header without touching any other view.

## Out of scope / future

The following were explicitly excluded to keep the implementation theme-only and low-risk:

- **Accurate per-bucket counts via server fan-out.** Each filter option would need its own `GET /api/v2/search?ex_q=…&num=0` request to get a real `record_count`. This adds N parallel requests per render; count-free was chosen instead.
- **Interactive server-side mode switch.** `rank.fusion.searchers` is read once at Fess boot; switching between hybrid, keyword-only, and semantic-only modes requires a server change and is outside the theme's scope.
- **Keeping semantic matching alive under a filter.** The syntax gate lives in Fess core (`SemanticChunkSearcher`), which decides on the assembled query string. A client cannot opt out of it, and faking a filter by post-filtering results would break paging and `record_count`. Surfacing the behaviour is the theme-level answer.

## System font stack rationale

The SemanticLens CSP blocks external font sources including Google Fonts:

```
font-src 'self'
```

No `fonts.googleapis.com` or `fonts.gstatic.com` is permitted. Using system fonts:

- eliminates the external network request (faster first paint)
- removes the potential for layout shift (FOIT/FOUT)
- avoids the need to relax the CSP for font sources
- works offline and in air-gapped deployments

System fonts on modern operating systems (San Francisco on macOS/iOS, Segoe UI on Windows, Roboto on Android/Chrome OS) are high-quality and render well for both Latin and CJK scripts.

Font stack used:

```css
system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif
```

## Component inventory (inherited from NomadKit)

SemanticLens inherits all NomadKit components without functional changes:

- Slim dark top-bar header (`.df-header`)
- Persistent left facet sidebar (desktop) + offcanvas (mobile)
- Result cards with title, snippet, site line, info row
- Pagination
- Search options drawer (sort, count, language, label, geo)
- Login modal
- RAG chat column (when `rag_chat_enabled`)
- Cache viewer (sandboxed iframe)
- Profile page (password change)
- Help page
- Advanced search
- Suggest dropdown

### SemanticLens additions

- **`.result-head`** — flex container wrapping the result `h3.title` and the badge so the badge sits to the right of the (text-truncating) title
- **`.searcher-badge`** + **`.searcher-badge--{kind}`** — pill badge attached to each result card when the `searcher` field is present; colors driven by `--sl-*` vars (old hardcoded hex removed)
- **`li.result--{kind}`** — source class on the result card root, drives the 3 px colored `border-left` spine
- **`div.result-why`** — one-line "Matched by …" microcopy below the title, per-card, text-only
- **`#search-composition`** — Search Composition band above results; replaces the former `#searcher-legend` / `.searcher-legend` (removed)
- **`.comp-seg--{hybrid,semantic,keyword}`** — proportional bar segments inside the band
- **`.filter-opt`** / **`.filter-chk`** — count-free clickable filter rows and their checkbox indicators
- **`.facet-cap`** / **`.cap--semantic`** / **`.cap--mixed`** — mode-aware sidebar caption
- **`.sl-lensmark`** — CSS lens-mark brand element in the header brand link
