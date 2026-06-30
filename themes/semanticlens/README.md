# SemanticLens — Fess Static Theme (Hybrid Search)

SemanticLens is a **self-contained** Fess static theme derived from the NomadKit theme. It applies an *indigo-violet* brand palette and adds **per-result searcher badges** (keyword / semantic / hybrid) plus a **Search Composition band above results** — surfacing how each document was retrieved when the Fess deployment exposes the `searcher` provenance field.

Activate it by setting `theme.default=semanticlens` in the admin UI (`/admin/theme/`) or by binding it to a virtual host.

## Purpose

SemanticLens targets **hybrid keyword + semantic search** deployments such as the `docker-semanticsearch` stack. When rank-fusion is active and Fess is configured to expose the `searcher` field, each result is labelled:

- **Keyword** — matched by BM25 / full-text search only (`default` searcher)
- **Semantic** — matched by vector / kNN search only (`semantic` searcher)
- **Hybrid** — matched by both searchers

A Search Composition band above the results list is shown whenever at least one hit carries searcher data, making the mix of retrieval strategies immediately visible to users.

## Requirements

- Fess 15.7+
- To show searcher badges, set in `fess_config.properties` (or via Java system properties):
  ```
  query.additional.api.response.fields=searcher
  rank.fusion.searchers=default,semantic
  ```

## Hybrid search experience

### Per-result provenance

Each result card shows three layers of source information, all driven by the card's own `searcher` field — no aggregation:

- **Badge** (top-right of the title row) — a pill labelled Keyword, Semantic, or Hybrid with an icon, colored via `--sl-keyword/-semantic/-hybrid-subtle` + text vars.
- **Left card spine** — a 3 px colored border (`border-left`) on the `li` root, keyed to the same color var family.
- **Microcopy line** — a single `div.result-why` below the title reading "Matched by keyword / meaning / both keyword and meaning", sized at 0.78 rem.

When `searcher` is absent all three are silently omitted (graceful degradation; see below).

### Search Composition band

A full-width frosted band (`#search-composition`, `role="note" aria-live="polite"`) sits above the result list. It shows:

- The server's `record_count` total and a "results" label.
- A proportional 3-segment bar (`.comp-seg--hybrid/semantic/keyword`, widths set inline) reflecting the share of each kind on the current page.
- A plain-language verdict: "A balanced blend" / "Mostly meaning-matched" / "Mostly keyword matches" — chosen by thresholding the page tally (semantic ≥ 60% → semantic, keyword ≥ 60% → keyword, else balanced).
- A color legend (dots + labels, no numbers).

The band is hidden (`d-none`) when `searcher` is absent on all page results (non-hybrid deployments). The tally is read-only display data; it is never used to build filters.

### Count-free unified filter sidebar

The sidebar always shows three option groups — **File type**, **Updated**, and **Size** — sourced from `GET /api/v2/ui/config` (`filetype_options` and `facet_views`). This makes the groups query-independent and always populated, even for semantic-only queries that return empty BM25 facet buckets.

Options are rendered as clickable `li.filter-opt` rows with a `.filter-chk` checkbox (filled when active) and a label. **No counts are shown.** Clicking toggles the clause in `state.facetQueries` and re-queries the server, which narrows the full fused result set (both keyword and semantic branches share the same `bool.must` filter in the plugin's query builder).

A **mode-aware caption** (`.facet-cap`) at the top of the sidebar describes what filters do:

- Semantic-dominant page (semantic ≥ 60%): violet-bordered "Most of these are meaning-matched. Filters narrow all of them — including semantic matches."
- Otherwise: teal-bordered "Filters narrow the full result set — keyword and semantic alike."

The caption is omitted when `searcher` is absent (standard deployments).

### Quote-on-filter behavior

A multi-word free-text query combined with any active filter currently causes an HTTP 400 from the semantic-search plugin (`[inner_hits] already contains an entry for key [content_vector]`). The plugin auto-quotes unfiltered multi-word queries to produce a single neural clause, but adding a filter suppresses that quoting, creating duplicate inner-hits names.

When at least one filter is active, SemanticLens wraps the free-text query as a single quoted phrase before sending it (`q="how do I make search faster"`). This collapses the query to one neural clause, which the plugin handles correctly. The quoting is skipped when the query is empty, already quoted, contains `field:` operators, or is a single token.

**Tradeoff:** with a filter active, the BM25 branch becomes phrase-match rather than OR-of-terms, so lexical ranking may shift slightly. The semantic branch is unaffected and preserves recall. This behavior is documented and acceptable; it replicates what the plugin already does for unfiltered multi-word queries, so it remains correct if the plugin later fixes the underlying bug.

## Graceful degradation

When the `searcher` field is absent (standard Fess deployments without hybrid search), **no badges are rendered and the Search Composition band, card spines, microcopy, and sidebar caption are all hidden**. SemanticLens functions as a valid general-purpose search theme with zero visual regressions.

## SemanticLens palette

| Token | Value | Usage |
|---|---|---|
| Brand primary | `#6D28D9` | Buttons, focus rings, active fills |
| Brand hover | `#5B21B6` | Hover / darker accent |
| Secondary | `#0369A1` | Links, secondary actions |
| Page background | `#FAFBFF` | Body background |
| Card surface | `#FFFFFF` | Result cards, panels |
| Secondary surface | `#F4F6FB` | Sidebar, legend background |
| Border | `#E2E8F0` | Card and panel borders |
| Muted text | `#475569` | Secondary labels, descriptions |

### Source-of-match colors (CSS vars)

The redesigned badge system uses three semantic colors, each with a base, subtle background, and accessible text variant. The old hardcoded badge hex has been removed in favor of these vars.

| CSS variable | Value | Subtle bg | Text | Meaning |
|---|---|---|---|---|
| `--sl-hybrid` | `#0D9488` | `#DCF5F1` | `#0B6B62` | Matched by both keyword and meaning — teal |
| `--sl-semantic` | `#7C3AED` | `#F1E9FE` | `#5B21B6` | Matched by meaning/vector only — violet |
| `--sl-keyword` | `#D97706` | `#FEF3E2` | `#9A5A05` | Matched by BM25/keyword only — amber |

These vars drive the composition bar segments, result card left spines, badge backgrounds, sidebar caption borders, and filter active states.

## Layout

```
semanticlens/
├── theme.yml             # manifest (kind: StaticTheme, name: semanticlens)
├── index.html            # SPA shell — semantic HTML5, no Bootstrap
├── thumbnail.png         # shown in /admin/theme/ (512×320 screenshot of the redesign)
├── assets/
│   ├── compat.js         # Bootstrap-JS-API shim
│   ├── styles.css        # self-contained SemanticLens stylesheet
│   ├── app.js            # entry point
│   ├── search.js         # search + searcher badge/composition/filter logic
│   ├── logo.png          # home hero logo (nomadkit placeholder)
│   └── logo-head.png     # header brand logo (nomadkit placeholder)
├── i18n/
│   ├── messages.en.json  # English (includes searcher.*, composition.*, sidebar.* keys)
│   ├── messages.ja.json  # Japanese
│   └── …                 # 14 more locales
└── help/                 # help page assets
```

Key DOM landmarks added by the redesign:

| Element | Description |
|---|---|
| `#search-composition` | Search Composition band — replaces the old `#searcher-legend` |
| `.comp-seg--{hybrid,semantic,keyword}` | Proportional bar segments inside the band |
| `li.result--{kind}` | Result `li` root — carries source class that drives the left spine color |
| `div.result-why` | Per-card microcopy "Matched by …" line |
| `.filter-opt` | Count-free clickable filter row in the sidebar |
| `.filter-chk` | Checkbox indicator inside each filter row |
| `.facet-cap` / `.cap--semantic` / `.cap--mixed` | Mode-aware sidebar caption |
| `.sl-lensmark` | CSS lens-mark brand element in the header (gradient mark, no image) |

> **Note:** `#searcher-legend` / `.searcher-legend` from the initial badge pass have been removed. `thumbnail.png` is a screenshot of the redesigned search view. `logo.png` and `logo-head.png` remain nomadkit placeholders; custom SemanticLens branding art is a follow-up task.

## Customise / repackage

```bash
cd repos/fess-themes
./scripts/package.sh semanticlens
# Produces dist/semanticlens-1.0.0.zip
```

Upload the ZIP via `/admin/theme/` or place it in Fess's theme directory.
