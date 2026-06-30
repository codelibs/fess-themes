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

A caption (`.facet-cap`) derived from `tallyKinds` sits at the top of the sidebar. It reassures users that clicking a filter narrows the full fused set, not just the BM25 branch:

- Semantic-dominant (semantic ≥ 60%): violet border, explains that filters include semantic matches.
- Otherwise: teal border, explains that filters cover keyword and semantic alike.

The caption is absent when `searcher` is not in the response.

## Quote-on-filter rationale and forward-safety

A multi-word free-text query combined with any field filter currently causes an HTTP 400 from the semantic-search plugin. The root cause: the plugin auto-quotes an unfiltered whitespace query (collapsing it to one `neural` clause), but the presence of a `field:` token in the query string suppresses that quoting, causing each word to become a separate `neural` clause with duplicate `content_vector` inner-hits names, which OpenSearch rejects.

The theme-side fix: whenever `hasActiveFilter()` is true, `quoteQueryForFilter(q)` wraps the raw free-text query in double quotes before sending. This replicates what the plugin already does in the unfiltered case. It is skipped when the query is empty, already quoted, contains `field:` or boolean operators (user-authored advanced queries are left untouched), or is a single token (no crash risk, no need).

**Forward-safety:** if the plugin is later fixed (see Out of scope), quoting a phrase that would have been quoted anyway produces the same result. If the plugin begins quoting even filter-bearing queries, the double-quoting path becomes a no-op. Either way the theme behavior degrades gracefully.

**Known tradeoff:** with a filter active, the BM25 branch evaluates the query as a phrase match rather than OR-of-terms, which may shift lexical ranking slightly. The semantic branch is unaffected. This is documented and acceptable.

## Lens identity: brand mark (header gradient skipped)

The plan specified a header gradient (`linear-gradient(115deg,#1b1e3c,#3b2a78,#0d6b66)`) scoped to the search view. This was skipped in implementation: `.df-header` is a `position:fixed` global navbar rendered outside the per-view `<section>` elements, and `showView()` only toggles `hidden` on sections. There is no CSS hook to scope the gradient to the search view without editing `app.js` (out of scope).

What was added instead: a `<span class="sl-lensmark" aria-hidden="true">` inside the header brand `<a>`, styled with a CSP-safe `radial-gradient` + `conic-gradient` focus-ring mark in the three source colors. This marks SemanticLens visually in the header without touching any other view.

## Out of scope / future

The following were explicitly excluded to keep the implementation theme-only and low-risk:

- **Accurate per-bucket counts via server fan-out.** Each filter option would need its own `GET /api/v2/search?ex_q=…&num=0` request to get a real `record_count`. This adds N parallel requests per render; count-free was chosen instead.
- **Interactive server-side mode switch.** `rank.fusion.searchers` is read once at Fess boot; switching between hybrid, keyword-only, and semantic-only modes requires a Fess or plugin change and is outside the theme's scope.
- **Upstream plugin fix: wire filters into `NeuralQueryBuilder.filter` and use unique inner-hits names per neural clause.** This would eliminate the HTTP 400 bug at source and make the quote-on-filter workaround unnecessary. The fix lives in `repos/fess-webapp-semantic-search/…/helper/SemanticSearchHelper.java` (~lines 330-380). Until that fix lands, the theme workaround remains the correct behavior.

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
