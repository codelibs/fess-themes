# File Search — Design

File Search is a utilitarian, information-dense interface for finding files. It does not
try to look like a web page about documents; it follows the conventions people already know
from file managers and file-search tools, so that nothing has to be learned: a tree of
folders on the left, a path above the list, a table with sortable columns, a detail pane on
the right, and the keyboard doing what it does in any list.

## Principles

1. **Where a file is matters as much as what it says.** The folder is first-class: it is a
   region of the screen (the tree), a line above the list (the breadcrumb and path) and a
   column in the table (Location). Narrowing to a folder is one click, and widening again is
   one click on the breadcrumb.
2. **The address bar is the state.** Keyword, folder, filters and sort all live in the URL,
   so Back, reload and "send me that link" behave. The folder is an `ex_q` clause.
3. **Numbers are honest.** A count is exact when it can be and drawn as `≥123` when it is only
   a lower bound. A missing count is never shown as zero, and a facet the server did not
   answer is not invented.
4. **Do not promise what a browser cannot do.** A web page cannot open a folder in the
   operating system, so the action is "Show in folder" (inside this page) and "Copy path".
   Links to the original always go through Fess (`go/`), never to a `file:` or `smb:` URL.
5. **Quiet by default, dense on purpose.** Hairline borders, small type, one accent. Colour
   carries meaning: the file-type glyphs, the selected row, a warning.
6. **Keyboard and screen reader first-class.** One tab stop per widget, roving focus, ARIA
   tree and grid, visible focus, `/` to search.

## Regions

| Region | Convention it follows |
|---|---|
| Header, full width | Search box (a combobox with suggestions), AI chat entry, account, help |
| Folder tree | A tree of sources and folders with expand / collapse and per-node counts; the selected node is the scope |
| Location bar | Up button, breadcrumb (each part clickable), the path as text, copy-path |
| Toolbar | Result count, filters, sort control, view switch (details / list / tiles), preview toggle |
| List | A table whose headings sort; one row per file with its type icon, name, snippet, location, modified, size, type |
| Preview pane | Metadata, actions, content preview; collapsible; a sheet on narrow screens |

Selection follows focus: moving to a row selects it and updates the preview. Double-click
or Enter opens the original; Space shows or hides the pane. Row actions (open, copy path,
show in folder, favourite) appear over the end of a row on hover, focus and selection, so they
take no column.

## Visual language

System font stacks only (the page's content-security policy serves nothing from other
hosts): UI text in the platform UI face, paths and code in the platform monospace face.

| Token | Light | Dark |
|---|---|---|
| `--fs-bg` page | `#f3f5f7` | `#12181f` |
| `--fs-surface` panes, rows | `#ffffff` | `#1a222b` |
| `--fs-border` | `#d8dde3` | `#2d3844` |
| `--fs-text` / `-2` / `-3` | `#1d2630` / `#46515e` / `#5a6573` | `#e6eaef` / `#b4bdc7` / `#a1abb7` |
| `--fs-accent` | `#0b6a85` | `#55b6d2` |
| `--fs-select` selected row | `#d9ebf1` | `#213d4b` |
| `--fs-header-bg` | `#1b2631` | `#0f151b` |

The header is dark in both schemes so the white logo always reads. All text pairs meet WCAG
AA on the surface they sit on; the focus ring is the accent at 2px. Light and dark follow
`prefers-color-scheme`; there is no toggle and nothing to flash.

Type scale: 15px page text, 14px names, 13px table cells and tree nodes, 12px counts and
meta; headings 650 weight. Radii 4 / 6 / 10px; the only shadows are on overlays (the drawer,
the sheet, menus). Rows are 3.1rem in Details, 2.15rem in List.

### File-type icons

Drawn here as inline SVG (24 × 24, 1.5px strokes, `currentColor`, rounded joins): a sheet of
paper with a folded corner and a glyph for the kind. The kind is decided from the mimetype,
then the `filetype` Fess assigned, then the extension of the url: PDF, word processor,
spreadsheet, presentation, text, source / data, image, audio, video, archive, web page,
e-mail, other. Each kind has one colour token with at least 3:1 contrast on the surface.
Sources are drawn as a small server, folders as folders (open when expanded). The UI glyphs
(chevron, copy, up, filter, sort arrows, view modes) are drawn the same way. No icon is a
font, so nothing is blocked and everything inherits the text colour.

## Responsive

Above 900px the three regions sit side by side (the tree and the pane narrower below 1400px).
The list is a container-query layout: as its own width shrinks it drops Type, then Location
(the path moves under the name), then Modified, rather than squeezing every column. Below
900px the tree becomes a drawer opened from the location bar and the preview a bottom sheet
that opens when a row is tapped; both close with Esc or their close button, and focus
returns to the control that opened the drawer.

## Motion

Only functional: the drawer and sheet slide (0.22s), the chevron turns, the spinner spins.
`prefers-reduced-motion` turns the transitions off.

## Behaviour notes

- Sorting maps a column to a `sort` field (`filename`, `last_modified`, `content_length`,
  `filetype`, `url`). The last two need `query.additional.sort.fields`; on a 400 the theme
  tells the user, reverts to the default order and does not offer that sort again.
- The default order is relevance with a keyword and name ascending without one.
- Filters are toggle buttons with `aria-pressed`; several file types combine with OR, the
  modified and size groups take one choice each (the date windows are cumulative, the size
  ranges are disjoint).
- The preview never runs content: the cached copy sits in a frame without scripts or the
  page's origin, a PDF is checked and shown in the browser's viewer, text is set with
  `textContent`.
