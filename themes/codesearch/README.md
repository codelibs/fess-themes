# codesearch — Source-Code-Search Static Theme

A Fess **static theme** optimised for source-code search (GitHub Code Search /
Sourcegraph class). It replaces the legacy JSP-based `fess-theme-codesearch`
Bootstrap plugin and targets the `docker-codesearch` deployment. Built with
vanilla JS and CSS (no Bootstrap, no CDN).

## Features

- **3-column layout** — facet rail · results · Ask AI panel
- **Query-as-source-of-truth** — inline `repo:`, `org:`, `path:`, `file:`,
  `lang:` qualifiers map to Fess field queries; facet selections append qualifiers
  into the query string; deep-linkable URLs
- **Per-file code cards** — `org / repo · path` breadcrumb, ↗ open-in-repo link,
  language badge, snippet with line-number gutter parsed from ingest-time `Lnn:`
  prefixes, match terms highlighted on a tinted row
- **Facet rail** — Repository, Language (filetype), Organization, Path/Filename;
  active filters shown as removable chips
- **Grounded AI panel** — "Ask AI" right-side collapsible panel + standalone
  `/chat` page (requires `rag.chat.enabled=true` and an LLM plugin)
- **Dark-first IDE aesthetic** — slate palette, monospace gutters/paths/counts,
  light theme via `[data-theme="light"]` toggle persisted in `localStorage`
- **Graceful fallback** — degrades to a generic card when the seven code fields
  are absent (works on non-codesearch indexes too)

## Requirements

- Fess **15.7+** (static-theme support)

## Install

### Via Fess Admin UI

1. Package the theme:
   ```bash
   ./scripts/package.sh codesearch
   # → dist/codesearch-1.0.2.zip
   ```
2. Open **Admin → Theme** (`/admin/theme/`) and upload the ZIP.
3. Activate it or set `theme.default=codesearch`.

### Via server config property

```properties
theme.default=codesearch
```

## Required server configuration

The theme relies on seven extra fields indexed by `fess-ds-git`
(`domain`, `organization`, `repository`, `path`, `repository_url`, `owner`,
`homepage`). Add the following to your Fess configuration
(`fess_config.properties` or as `-Dfess.config.*` JVM arguments):

```properties
# Expose the seven custom fields to /api/v2/search responses (REQUIRED)
query.additional.api.response.fields=domain,organization,repository,path,repository_url,owner,homepage

# Expose them in standard response (already set in docker-codesearch)
query.additional.response.fields=domain,organization,repository,path,repository_url,owner,homepage

# Enable facet fields for the left-rail filter
query.facet.fields=label,organization,repository,filename,filetype

# Facet queries used by the rail
query.additional.facet.fields=organization,repository,filename
```

> **Note:** `query.additional.api.response.fields` is the critical setting.
> Without it the SPA cannot render code-aware cards.

### Optional: Enable AI chat

```properties
rag.chat.enabled=true
```

Then install a compatible LLM plugin (e.g. `fess-llm-openai`) and configure the
model. The Ask AI panel and standalone `/chat` page are hidden when this is
`false` (default).

## Supported query qualifiers

| Qualifier | Maps to Fess field | Example |
|---|---|---|
| `repo:<value>` | `repository` | `repo:fess lang:java` |
| `org:<value>` | `organization` | `org:codelibs` |
| `path:<value>` | `path` | `path:src/main` |
| `file:<value>` | `filename` | `file:*.java` |
| `lang:<value>` | `filetype` | `lang:python` |
| free text | content / title | `parse tree` |

Prefix a qualifier with `-` to exclude: `-lang:xml parse`.

## Locales

Messages are in `i18n/messages.<locale>.json`. The 16 supported locales are:
`de`, `en`, `es`, `fr`, `hi`, `id`, `it`, `ja`, `ko`, `nl`, `pl`, `pt-BR`,
`ru`, `tr`, `zh-CN`, `zh-TW`. Untranslated keys fall back to `en`.

## License

Apache-2.0 — same as Fess.
