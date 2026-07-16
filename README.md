# fess-themes

A collection of [Fess](https://fess.codelibs.org/) **static themes**, each generated
from a design specification. Every theme is a self-contained vanilla-JS SPA that
talks to the Fess `/api/v2/*` endpoints and is installable by uploading a ZIP via
the Fess admin UI (`/admin/theme/`).

The goal of this repository is to keep design-driven themes in one place, so a
theme can be reviewed, re-skinned, or used as a starting point for a new one.

## Themes

| Theme | Description |
|---|---|
| [`codesearch`](themes/codesearch/) | Source-code-search-optimised static theme — dark-first IDE aesthetic, inline qualifier syntax (`repo:` / `org:` / `path:` / `file:` / `lang:`), per-file code cards with line-number gutters, query-refining facet rail, grounded Ask-AI panel. Requires Fess 15.7+ and `query.additional.api.response.fields`. Ships its [`DESIGN.md`](themes/codesearch/DESIGN.md). |
| [`docuforge`](themes/docuforge/) | Documentation-style theme on the DocuForge design system — blue/purple/gray palette, persistent facet sidebar, docs-grade typography, **no Bootstrap**. Ships its [`DESIGN.md`](themes/docuforge/DESIGN.md) spec. |
| [`helpdesk`](themes/helpdesk/) | FAQ / support site. Answers expand inline in an accordion — no navigation. Featured answers, category tiles, optional AI escalation. Ships its [`DESIGN.md`](themes/helpdesk/DESIGN.md) spec. |
| [`docsearch`](themes/docsearch/) | Documentation search — ⌘K command palette, grouped results, breadcrumb cards, optional cited Ask-AI. DocSearch design language: indigo/slate palette, self-hosted Inter + JetBrains Mono, FOUC-safe light/dark mode, **no Bootstrap**. |
| [`nomadkit`](themes/nomadkit/) | Free-spirited theme on the NomadKit design system — warm sand / ocean / forest palette, persistent facet sidebar, accessible (AA) contrast, **no Bootstrap**. Ships its [`DESIGN.md`](themes/nomadkit/DESIGN.md) spec. |
| [`semanticlens`](themes/semanticlens/) | Hybrid keyword + semantic search theme — per-result searcher badges (Keyword / Semantic / Hybrid) with source-colored card spines (teal / violet / amber) and a "Matched by …" microcopy line; a **Search Composition band** above results showing a proportional keyword/semantic/hybrid bar and a plain-language verdict; and a **count-free unified filter sidebar** (File type / Updated / Size from `/api/v2/ui/config`) that stays present and narrows the full fused result set even for semantic-only queries; and an advanced **"semantic-space" home/landing hero** with an animated vector-constellation canvas, converging amber/violet beams, a typewriter search-box, and three match-type preview cards. Ships its [`DESIGN.md`](themes/semanticlens/DESIGN.md). |
| [`mosaic`](themes/mosaic/) | Thumbnail-first visual gallery for multimodal (image + text) search. Requires Fess 15.7+. Ships its [`DESIGN.md`](themes/mosaic/DESIGN.md). |
| [`storefront`](themes/storefront/) | EC / product-search theme — every result is a **product card** (photo, price, star rating, stock badge, brand) with **no text snippet**, and facet counts are drawn as **proportional count bars** so a price band shows how many products fall in it at a glance. Grid only. Requires Fess 15.7+, an externally supplied index mapping (`price` as `double`, `rating` as `float`) and `query.additional.*` configuration — see its [`README.md`](themes/storefront/README.md). Ships its [`DESIGN.md`](themes/storefront/DESIGN.md). |
| [`rawblock`](themes/rawblock/) | Brutalist anti-design theme on the RawBlock design system — raw black-on-white, thick borders (1/3/5px), sharp 0px corners, no shadows, full color-inversion hover/active states, **no Bootstrap**. Ships its [`DESIGN.md`](themes/rawblock/DESIGN.md) spec. |
| [`voicebox`](themes/voicebox/) | Bold, magazine-style editorial theme on the VoiceBox design system — high-contrast black/white with a single red accent, flat (no shadows), sharp 0px corners, thick 2px borders, Archivo Black headlines, **no Bootstrap**. Ships its [`DESIGN.md`](themes/voicebox/DESIGN.md) spec. |

## Repository layout

```
fess-themes/
├── README.md
├── LICENSE                  # Apache-2.0
├── scripts/
│   └── package.sh           # zip a theme into dist/<name>-<version>.zip for upload
└── themes/
    └── <name>/
        ├── theme.yml        # manifest (apiVersion: fess.codelibs.org/v1, kind: StaticTheme)
        ├── index.html       # SPA shell
        ├── assets/          # JS modules + CSS
        ├── i18n/            # messages.<locale>.json
        ├── help/            # help/<locale>.json
        ├── DESIGN.md        # optional: the design spec the theme was built from
        └── README.md
```

> A theme may include an optional `thumbnail.png` (≤512KB, ≤512×512) plus a
> `thumbnail: thumbnail.png` line in `theme.yml` to show a preview in the admin
> UI. Capture it from a running instance of the theme so it stays accurate.

## Installing a theme

1. Package it into a ZIP:
   ```bash
   ./scripts/package.sh docuforge
   # → dist/docuforge-1.0.1.zip
   ```
2. In Fess, open **Admin → Theme** (`/admin/theme/`) and upload the ZIP, then
   activate it (or bind it to a virtual host).

> A theme is served at `/themes/<name>/` where `<name>` is `theme.yml#name`, so
> the asset paths inside `index.html` (e.g. `/themes/docuforge/assets/styles.css`)
> are tied to the theme name rather than this repository's location.

## Adding a new theme

1. Create `themes/<name>/` (copy an existing theme as a starting point).
2. Set `theme.yml#name` / `#displayName` to `<name>`, and update every
   `/themes/<old>/…` path in `index.html` / `assets/*.js` to `/themes/<name>/…`.
3. Reset `theme.yml#version` to `"1.0.0"` — versions are per-theme, not repo-wide.
4. Add a row to the **Themes** table above.

## Versioning

Each theme is versioned independently by `theme.yml#version` (SemVer). Changing a theme's
shipped files means bumping that theme's version in the same commit: patch for fixes,
minor for backwards-compatible additions, major for breaking changes. Edits confined to
`README.md` / `DESIGN.md` ship nothing and need no bump. See [`CLAUDE.md`](CLAUDE.md) for
the full rules and the format the server enforces.

## Requirements

- Fess `15.7+` (static-theme support; see each theme's `theme.yml#minFessVersion`).

## License

Apache-2.0 — see [LICENSE](LICENSE).
