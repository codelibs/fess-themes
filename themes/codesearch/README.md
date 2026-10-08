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

- Fess **15.9+** (static-theme support)

## Install

### Via Fess Admin UI

1. Package the theme:
   ```bash
   ./scripts/package.sh codesearch
   # → dist/codesearch-15.9.9.zip
   ```
2. Open **Admin → Theme** (`/admin/theme/`) and upload the ZIP.
3. Choose it under **Default Theme** on the same screen and click **Set**.

### Via system property

`theme.default` is a **system property**. Set it in `system.properties` (`app/WEB-INF/conf/` in
the ZIP distribution) or start Fess with `-Dfess.system.theme.default=codesearch`; a
`theme.default` line in `fess_config.properties` has no effect.

```properties
theme.default=codesearch
```

The JVM option is read only while `system.properties` has no `theme.default` key, so once the
Theme screen has saved one (even **(no default)**, which stores an empty value), that key wins.

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

A qualifier's value is data, not query syntax: the characters Lucene reads as syntax
(`/ : ( ) [ ] { } ^ ~ ! "`, a leading `+` or `-`, `&&` and `||`) are escaped before the
query is sent, so `path:src/main` and `file:index[1].html` find what they name. `*` and `?`
stay wildcards, a backslash escapes the next character (as in Lucene), and a range is sent
as typed (`content_length:[1024 TO 10240]`). Quote a value that holds spaces:
`repo:"my repo"`.

`path` holds the file's path inside the repository (`src/main/java/Foo.java`), so its value
is read like this:

| You type | Matches | Sent as |
|---|---|---|
| `path:src/main` | every path that starts with `src/main` | `path:src\/main*` |
| `path:*Suggester.java` | a wildcard you type is used as typed | `path:*Suggester.java` |
| `path:"src/main/java/X.java"` | exactly that path | `path:"src/main/java/X.java"` |

The prefix is a Lucene prefix query on the keyword field `path`, so `path` has to be listed
in `query.additional.search.fields` and `query.additional.not.analyzed.fields` (the
`docker-codesearch` deployment sets both).

In the free text, a `"quoted phrase"` is searched as a phrase (`"foo bar"~3` is a proximity
search: the larger the number, the further apart the words may be), `-word` excludes a
word, and a word that starts with two hyphens (`--verbose`) is searched as written.
Press `/` to move to the search box.

## Locales

Messages are in `i18n/messages.<locale>.json`. The 16 supported locales are:
`de`, `en`, `es`, `fr`, `hi`, `id`, `it`, `ja`, `ko`, `nl`, `pl`, `pt-BR`,
`ru`, `tr`, `zh-CN`, `zh-TW`. Untranslated keys fall back to `en`.

## License

Apache-2.0 — same as Fess.
