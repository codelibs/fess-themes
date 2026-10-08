# File Search — Fess Static Theme for Searching Files and Folders

File Search is a general-purpose file search UI for Fess. It is built for the case where
people look for documents on file servers, shared folders and drives, and want to find
them the way they find files in a file manager: narrow to a folder, sort by name or date,
look at the file before opening it. It follows the usual conventions of file managers and
file-search tools; see [`DESIGN.md`](DESIGN.md) for the reasoning.

It is **self-contained** (no Bootstrap, no web fonts) and talks only to `/api/v2/*`, `go/`
and `thumbnail/`. Requires Fess 15.9+.

## The screen

Under a full-width header (the search box, the AI chat entry, login / profile / language,
help) the results screen has three regions:

| Region | What it does |
|---|---|
| **Folder tree** (left) | Sources (hosts), then folders, with the number of matching documents beside each. Click a name to look only inside that folder and everything below it; click the arrow to open or close it. The tree is rebuilt for every keyword and filter, so a count is a count of what the list would show. |
| **Location bar + toolbar + list** (middle) | The breadcrumb of the current folder (click any part to go up to it; a Windows-style `\\server\share\dir` path for smb, `/home/user/dir` for local paths; a copy-path button), the result count, **Filters** (file type, modified date, size, label), the sort control, and a view switch: **Details** (name, location, modified, size, type), **List** and **Tiles**. In Details view the column headings sort. |
| **Preview pane** (right) | The selected file's path, dates, size and type, the actions (open the original, copy path, show in folder, cached copy) and a content preview where one is possible. It collapses; below 900px it becomes a sheet over the list, and the folder tree becomes a drawer. |

The home page (no keyword, no folder) is the search box plus the same tree of sources and
the recent searches. Recent searches are kept in the browser (`localStorage`).

Keyboard: `/` focuses the search box; `↑ ↓ Home End PgUp PgDn` move through the list;
`Enter` opens the original; `Space` shows or hides the preview; `←` from the list goes to
the tree; in the tree `← →` close and open folders and `↑ ↓` move; `Esc` closes the preview
or the drawer. The tree is a WAI-ARIA tree and the list a grid with one tab stop.

### The address bar is the state

Everything you choose is in the URL, so back/forward, reload and a shared link all work:

| Choice | URL |
|---|---|
| keyword | `q=` |
| folder | `ex_q=url:<escaped prefix>*` (or `ex_q=host:<host>` for a whole source) |
| file type | `ex_q=filetype:pdf` (several: `ex_q=(filetype:pdf OR filetype:word)`) |
| modified / size | `ex_q=last_modified:[now/d-7d TO *]`, `ex_q=content_length:[10000 TO 99999]` |
| label | `ex_q=label:<value>` |
| sort | `sort=filename.asc` … (only after you chose one) |

The folder prefix is the raw `url` of the documents with every query-syntax character
backslash-escaped (`smb://srv/share/` is `url:smb\:\/\/srv\/share\/*`).

## Install and activate

```bash
./scripts/package.sh filesearch          # → dist/filesearch-15.9.2.zip
```

Upload the ZIP at **Admin → Theme** (`/admin/theme/`) and set it as the default theme, or
bind it to a virtual host whose key is `filesearch`. `theme.default` is a **system
property** (the **Default Theme** selector on the **Admin → Theme** screen, `system.properties`,
or `-Dfess.system.theme.default=filesearch`); writing it into `fess_config.properties` has no
effect. The JVM option is read only while `system.properties` has no `theme.default` key, so
once the Theme screen has saved one (even **(no default)**, which stores an empty value), that
key wins.

## Fess settings

None is required to start; these make it better. Mind the channel each one lives in:

| Setting | Channel | Why |
|---|---|---|
| `query.additional.sort.fields=filetype,url` | `fess_config.properties` or `-Dfess.config.query.additional.sort.fields=filetype,url` | Lets the **Type** and **Location** columns sort. Without it the server answers 400 for those two sorts; the theme shows a notice, falls back to the default order and stops offering the sort. Name, Modified and Size always work. |
| `thumbnail.enabled=true` | **system property** (admin **General**, or `-Dfess.system.thumbnail.enabled=true`); *not* `fess_config.properties` | Thumbnails in the preview pane and the Tiles view. They also need a thumbnail generator that works in your image (PDF and Office files need the external `generate-thumbnail` tools). A thumbnail Fess has not made yet answers 404; the theme retries and falls back to the file-type icon. |
| `crawler.document.cache.supported.mimetypes` (default `text/html`) | `fess_config.properties` | The cached copy is the only content preview for Office and similar files. Add the types you want (for example `text/html,text/plain,application/pdf`), then **re-crawl**: documents crawled earlier have no cache. |
| `search.file.proxy` (default `true`) | system property | The `go/` file proxy is how **Open original** and the PDF / text / image preview reach `file:` and `smb:` documents. Keep it on. |
| `response.inline.mimetypes` (default `application/pdf,text/plain`) | `fess_config.properties` | Files of these types open in the browser; every other type downloads. |
| `user.favorite=true` | system property | Shows the favourite star on each row. |
| Path mapping | admin **Crawler → Path Mapping** | If your files are also served over http(s), mapping `file:`/`smb:` URLs to them makes **Open original** open the file natively. |
| `query.facet.fields.size.max` (default `1000`) | `fess_config.properties` | The most URLs one tree request can see; see below. |
| `paging.search.page.size` (default `10`) | `fess_config.properties` | Rows per page when the visitor has not chosen; a file list is easier to scan with 50 (the Options drawer lets each visitor choose too). |

No facet field has to be added: the theme uses `host`, `url`, `filetype` and `label`,
which Fess allows by default.

## Known limits

- **A web page cannot open a folder in your operating system**, and a browser will not follow
  a `file:` or `smb:` link. **Show in folder** therefore moves to the folder *inside this
  page*, and **Copy path** gives you the path to paste into your file manager. Original files
  are always opened through `go/`.
- **Folder counts are approximate for large folders.** Fess has no folder hierarchy to ask
  for. The tree is built from facets: the sources from the `host` facet, a folder's
  sub-folders from a `url` facet over that folder (at most `query.facet.fields.size.max`
  URLs). When the facet saw every document the counts are exact; otherwise each count is a
  lower bound and is drawn as `≥123`. The facet returns the first 1000 URLs in order, so in a
  folder larger than that **whole sub-folders can be missing**, not just counted short; the tree
  says so under it ("some of its subfolders may not be listed"). Searching with a keyword, or
  opening the sub-folders you do see, narrows it. The tree's data comes from one small module
  (`assets/treesource.js`), so a server-side hierarchical facet can replace it later.
- **The folder is part of `ex_q`**, and the API refuses an `ex_q` value longer than 1000
  characters (HTTP 400). A `file:` path is stored percent-encoded, so each Japanese letter costs
  9 characters and a deep path can reach the limit. The theme then searches from the nearest
  parent folder that fits and says so.
- **Facet counts shrink as you filter** (Fess has no post-filter). The file types are counted a
  second time without the file-type choice itself, so the other types stay on offer and you can
  add one; the modified and size groups are not. The size ranges are disjoint, so choosing one
  drives its siblings to zero and they drop out until you remove it; the modified windows
  contain one another, so choosing one only narrows the others' counts and they all stay. A
  group the response gave no counts for is shown without counts; a facet the server did not
  answer at all (as with some hybrid-search setups) is not drawn.
- **Previews.** Only the selected file is loaded, one at a time, and a new selection cancels
  the previous load (`go/` writes a click log and re-reads the file); closing and reopening the
  pane keeps what has loaded rather than fetching it again. A PDF is fetched, checked
  for the `%PDF-` signature, and shown in the browser's viewer from a Blob whose type is fixed
  to `application/pdf` (at most 25 MB). Plain text, code and CSV show their first 256 KB of the original, as
  text (a file in an encoding the server does not declare may look garbled; the cached copy of a
  text file has lost its line breaks, so it is used only for files too large to fetch). An image is shown
  directly (at most 20 MB). The cached copy is shown in a frame with no scripts and no access
  to the page; the `<base href>` Fess puts in it is left out, because the page's content-security
  policy (`base-uri 'self'`) refuses one on another origin and it never took effect. Everything
  else, and an http(s) page that has no cached copy, shows the details only; the page's
  content-security policy rules out an in-page viewer for Office files.
- **Paths come from `url`.** `site` is cut at 100 characters, and `url_link` is not a usable path
  for a `file:` document (Fess writes `file://data/…` for `file:/data/…`), so locations,
  breadcrumbs and copied paths are derived from `url`. A `file:` url is stored percent-encoded
  and an `smb:` url decoded; both are shown decoded.
- Sorting with hybrid (semantic) search switched on has not been verified against a live
  server; the theme sends no `sort` for a keyword search unless you choose one.

## Layout

```
filesearch/
├── theme.yml              # manifest (kind: StaticTheme, name: filesearch)
├── index.html             # SPA shell: header, tree, location bar, list, preview, home
├── assets/
│   ├── styles.css         # tokens (light + dark) + utilities + file-search components
│   ├── app.js             # entry point; routes
│   ├── search.js          # search state, the URL round trip, the request pipeline, wiring
│   ├── scope.js           # folder scope <-> ex_q, query escaping, "browse without a keyword"
│   ├── paths.js           # url shapes -> folders, display paths, breadcrumb, parent scope
│   ├── tree.js            # folding the url facet into folders, counts, the tree model
│   ├── treesource.js      # the one place that asks Fess for tree data
│   ├── treeview.js        # the tree on screen (WAI-ARIA tree)
│   ├── listview.js        # the result rows and column headings (details / list / tiles)
│   ├── preview.js         # the preview pane
│   ├── previewload.js     # which preview a file gets, and how it is fetched
│   ├── filterpanel.js     # file type / modified / size / label filters
│   ├── filters.js         # filters as ex_q clauses, and back
│   ├── sorting.js         # column <-> sort parameter, the 400 fallback
│   ├── keynav.js          # the keyboard model
│   ├── viewmode.js        # the view choice in localStorage
│   ├── recent.js          # recent searches in localStorage
│   ├── icons.js           # file-type and UI icons (inline SVG) and the file-kind rules
│   ├── dom.js             # DOM helpers
│   └── …                  # shared modules, identical to the other themes: router, api, i18n,
│                          # help, cache, error, auth, profile, format, markdown (plus advance,
│                          # chat, compat)
├── i18n/messages.<locale>.json   # 16 locales, identical key sets
└── help/<locale>.json            # 16 locales, identical section ids
```

The ten shared modules are byte-identical across all themes (`test/parity.test.js`); the
file-search logic lives in the modules above them. The pure logic (paths, scope, tree folding,
sorting, filters, key handling, preview rules) has its own unit tests under `test/filesearch.*`.

## License

Apache-2.0, like the rest of this repository.
