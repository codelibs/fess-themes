# SemanticLens — Fess Static Theme (Hybrid Search)

SemanticLens is a **self-contained** Fess static theme derived from the NomadKit theme. It applies an *indigo-violet* brand palette and adds **per-result searcher badges** (keyword / semantic / hybrid) plus a **legend above results** — surfacing how each document was retrieved when the Fess deployment exposes the `searcher` provenance field.

Activate it by setting `theme.default=semanticlens` in the admin UI (`/admin/theme/`) or by binding it to a virtual host.

## Purpose

SemanticLens targets **hybrid keyword + semantic search** deployments such as the `docker-semanticsearch` stack. When rank-fusion is active and Fess is configured to expose the `searcher` field, each result is labelled:

- **Keyword** — matched by BM25 / full-text search only (`default` searcher)
- **Semantic** — matched by vector / kNN search only (`semantic` searcher)
- **Hybrid** — matched by both searchers

A compact legend above the results list is shown whenever at least one hit carries searcher data, making the mix of retrieval strategies immediately visible to users.

## Requirements

- Fess 15.7+
- To show searcher badges, set in `fess_config.properties` (or via Java system properties):
  ```
  query.additional.api.response.fields=searcher
  rank.fusion.searchers=default,semantic
  ```

## Graceful degradation

When the `searcher` field is absent (standard Fess deployments without hybrid search), **no badges are rendered and the legend is hidden**. SemanticLens functions as a valid general-purpose search theme with zero visual regressions.

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

### Searcher badge colors

| Badge | Text | Background | Border |
|---|---|---|---|
| Semantic | `#5B21B6` | `#EDE9FE` | `#DDD6FE` |
| Keyword | `#075985` | `#E0F2FE` | `#BAE6FD` |
| Hybrid | `#92400E` | `#FEF3C7` | `#FDE68A` |

## Layout

```
semanticlens/
├── theme.yml             # manifest (kind: StaticTheme, name: semanticlens)
├── index.html            # SPA shell — semantic HTML5, no Bootstrap
├── thumbnail.png         # shown in /admin/theme/ (placeholder, follow-up)
├── assets/
│   ├── compat.js         # Bootstrap-JS-API shim
│   ├── styles.css        # self-contained SemanticLens stylesheet
│   ├── app.js            # entry point
│   ├── search.js         # search + searcher badge/legend logic
│   ├── logo.png          # home hero logo (nomadkit placeholder)
│   └── logo-head.png     # header brand logo (nomadkit placeholder)
├── i18n/
│   ├── messages.en.json  # English (includes searcher.* keys)
│   ├── messages.ja.json  # Japanese
│   └── …                 # 14 more locales
└── help/                 # help page assets
```

> **Note:** `logo.png`, `logo-head.png`, and `thumbnail.png` are nomadkit
> placeholders. Custom SemanticLens branding art is a follow-up task.

## Customise / repackage

```bash
cd repos/fess-themes
./scripts/package.sh semanticlens
# Produces dist/semanticlens-1.0.0.zip
```

Upload the ZIP via `/admin/theme/` or place it in Fess's theme directory.
