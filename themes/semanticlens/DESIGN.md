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

## Searcher badge color system

Badges use distinct hue families so they are distinguishable by color AND by icon + text label:

| Badge | Color | On | Background | Border | Semantic meaning |
|---|---|---|---|---|---|
| Semantic | `#5B21B6` | `#EDE9FE` | `#EDE9FE` | `#DDD6FE` | Meaning / vector — violet (brand family) |
| Keyword | `#075985` | `#E0F2FE` | `#E0F2FE` | `#BAE6FD` | Terms / BM25 — cyan (secondary family) |
| Hybrid | `#92400E` | `#FEF3C7` | `#FEF3C7` | `#FDE68A` | Both together — amber (warm contrast) |

Amber was chosen for Hybrid because it is visually distinct from both violet and cyan and reads as "combination / synthesis" — a warm bridge between the two modes.

## Accessibility rule: icon + text label, never color alone

Every badge renders an icon (`aria-hidden="true"`) **and** a visible text label. Color is a secondary reinforcement only. Screen readers receive the `aria-label` attribute on the badge span, which carries the full description (e.g. "Matched by meaning (vector search)").

This satisfies WCAG 1.4.1 (Use of Color) and ensures comprehension for users with color vision deficiency.

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
- **`.searcher-badge`** + **`.searcher-badge--{kind}`** — pill badge attached to each result card when the `searcher` field is present
- **`#searcher-legend` / `.searcher-legend`** — legend row above results; shown only when at least one hit carries known searcher data
