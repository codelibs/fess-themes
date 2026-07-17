# codesearch Theme — UX Rationale

This document captures the design decisions behind the `codesearch` static theme.
The full specification is at
`docs/superpowers/specs/2026-06-27-codesearch-static-theme-design.md`.

## 1. Dark-first IDE aesthetic

Source-code search tools (VS Code, GitHub, Sourcegraph) are predominantly dark. A
dark-first palette reduces eye strain during long coding sessions and sets
appropriate expectations for developers. Light mode is available via a toggle
persisted in `localStorage`; it uses `[data-theme="light"]` on `<html>` so the
preference is applied before first paint (no FOUC).

Design tokens are CSS custom properties — a single `[data-theme="light"]` block
swaps the entire palette. No Bootstrap; no CDN; no external fonts — only the
system `ui-monospace` / `SFMono-Regular` / `Menlo` / `Consolas` stack, which
matches the font developers already use in their editors.

## 2. Query-as-source-of-truth

All search state lives in the URL query string (`?q=repo:fess+lang:java+parse`).
Facet selections and filter chips **write back into the query string** via
`query.js` rather than maintaining a parallel filter state object. This means:

- Deep-linking works out of the box — share a URL and the search re-runs exactly.
- The back/forward buttons work correctly — history entries are full URLs.
- There is one canonical representation of "what is being searched" — the query
  box shows exactly what the server receives (after qualifier expansion).

Inline qualifiers (`repo:`, `org:`, `path:`, `file:`, `lang:`) are parsed
client-side by `query.js` and mapped to Fess field queries before dispatch. The
grammar is intentionally minimal: implicit-AND, `-` exclude, `or` operator.

Deferred: qualifier autocomplete, regex toggle, structural/AST search (YAGNI v1).

## 3. Per-file code cards with line gutters

Fess returns one document per file with a single highlighted snippet
(`content_description`). The snippet body is ingest-time line-prefixed (`L1:`,
`L2:`, …) so the theme can reconstruct a visual line-number gutter. The gutter
is rendered with a monospace font at a smaller weight, matching IDE conventions.

Match terms are highlighted (bold/em from `content_description`) on a tinted
background row. XSS safety is maintained by `renderHighlightedSnippet()` in
`format.js`, which parses the server snippet in an inert `<template>` and keeps
only the `<strong>`/`<em>` match tags, rather than assigning raw `innerHTML`
with user data.

The card header carries `org / repo · path` as a breadcrumb and an ↗
open-in-repo link constructed best-effort from `repository_url + path`.
The language badge derives from `filetype`. A favorite star is shown when
`features.user_favorite` is enabled.

The footer shows `domain · owner · last_modified` for provenance. When the seven
custom fields are absent the card degrades to a generic title+snippet layout so
the theme remains usable on non-codesearch indexes.

## 4. Query-refining facets

The left-rail facets (Repository, Language, Organization, Path/Filename) are
populated from the `facet_field` array in the Fess search response. Checking a
facet appends a qualifier to the query string and re-runs the search; unchecking
removes it. This keeps the query box honest — the user can always see (and edit)
exactly what filters are active.

Active qualifiers are displayed as removable chips above the result list, giving
a secondary affordance for editing filters without touching the query box.

Facets are collapsible `<details>/<summary>` elements. The first group is open by
default. An empty placeholder is shown before the first search.

## 5. Grounded AI panel

The "Ask AI" panel is placed on the right side and collapses to a button at
narrow viewports. It is hidden when `features.rag_chat_enabled` is `false`
(default in docker-codesearch unless an LLM plugin is installed), so operators
who have not configured an LLM see a clean two-column layout with no dead
buttons.

When enabled, the panel passes the current search context (`fields`,
`extra_queries` derived from active qualifiers) to `/api/v2/chat/stream` so the
AI answer is grounded in the same scope as the search results. Citations link
back to the result documents.

A standalone `/chat` page is also provided for longer conversational use.

## 6. Rejected alternatives

| Alternative | Reason rejected |
|---|---|
| Pure CSS restyle of bootstrap theme | Cannot render code-specific result cards (line gutters, breadcrumbs, open-in-repo) without JS changes |
| Build from scratch | Would re-implement API/auth/i18n/chat plumbing — high risk with no benefit |
| Bootstrap 5 dependency | Adds ~80KB, constrains dark-mode implementation, contradicts the no-CDN / no-external-resources CSP requirement |
| Regex toggle | Lucene layer does not reliably support all regex patterns; do not expose what cannot be delivered |
| CDN fonts (Inter, JetBrains Mono) | Violates `connect-src 'self'` CSP |
