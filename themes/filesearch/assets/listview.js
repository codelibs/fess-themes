// SPDX-License-Identifier: Apache-2.0
// The result list. One row structure serves three layouts (details, compact, tiles); the
// layout is a data-view attribute on the list and CSS does the rest, so switching view
// never re-fetches anything.
//
//   a row is role="row" with role="gridcell" children (name, location, modified, size,
//   type, actions) inside a role="grid"; exactly one row is in the tab order (roving
//   tabindex) and the row that has focus is the selected one, which the preview follows.
//
// Row actions: open the original (always through go/, never a raw file: or smb: href),
// copy the path, show the document's folder, favourite (only when the server enables it).
// Titles and snippets are server-escaped HTML run through the sanitizer helpers in
// format.js; the digest is raw text and is escaped here. Keyboard decisions live in
// keynav.js.

import { t } from "./i18n.js";
import { escapeHtml, formatFileSize, formatDate, renderHighlightedSnippet, renderSnippetText } from "./format.js";
import { el, clear, reveal } from "./dom.js";
import { fileKind, fileIcon, uiIcon } from "./icons.js";
import { displayPath, locationOf, copyPathOf, scopeOfDocParent } from "./paths.js";
import { listKey } from "./keynav.js";
import { loadThumbnail } from "./previewload.js";
import { describeSort, isSortSupported } from "./sorting.js";

/** Columns of the details view, in order. `sort` is the column id sorting.js knows. */
export const COLUMNS = [
  { id: "name", labelKey: "fs.sort_name", cls: "fs-c-name", sort: "name" },
  { id: "location", labelKey: "fs.sort_location", cls: "fs-c-loc", sort: "location" },
  { id: "modified", labelKey: "fs.sort_modified", cls: "fs-c-mod", sort: "modified" },
  { id: "size", labelKey: "fs.sort_size", cls: "fs-c-size", sort: "size" },
  { id: "type", labelKey: "fs.sort_type", cls: "fs-c-type", sort: "type" },
  { id: "actions", labelKey: "fs.col_actions", cls: "fs-c-actions", sort: null, hiddenLabel: true },
];

/** The plain-text title of a hit (entities decoded, highlight tags removed). */
export function plainTitle(d) {
  // content_title is server-escaped HTML with highlight tags; title and url are raw index
  // fields the server never escapes, so they are used as they are.
  if (d.content_title) return renderSnippetText(d.content_title);
  return d.title || d.url || "";
}

/** The file name shown for a hit. */
export function nameOf(d) {
  return d.filename || plainTitle(d);
}

function cell(cls, role = "gridcell") {
  return el("div", { className: "fs-c " + cls, attrs: { role } });
}

function actionButton(iconName, label, onClick, extra = {}) {
  const btn = el("button", {
    className: "fs-act" + (extra.className ? " " + extra.className : ""),
    attrs: { type: "button", "aria-label": label, title: label, tabindex: "-1", ...(extra.attrs || {}) },
  });
  btn.appendChild(uiIcon(iconName));
  if (onClick) btn.addEventListener("click", ev => { ev.stopPropagation(); onClick(ev, btn); });
  return btn;
}

/**
 * Build one result row.
 *
 * @param {object} d      the hit
 * @param {number} idx0   0-based position on the page (the `order` of go/)
 * @param {object} ctx    { queryId, requestedTime, buildGoUrl, features, view, actions }
 */
export function buildRow(d, idx0, ctx) {
  const features = ctx.features || {};
  // url_link is for the browser and is not a usable path for a file: document ("file://data/..."
  // for file:/data/...), so every path shown or copied is derived from url.
  const url = d.url_link || d.url || "";
  const source = d.url || url;
  const goHref = ctx.buildGoUrl(url, d.doc_id, ctx.queryId, idx0, ctx.requestedTime);
  const kind = fileKind(d);
  const title = plainTitle(d);
  const location = locationOf(source);

  const row = el("li", {
    className: "fs-row",
    attrs: { id: "result" + idx0, role: "row", tabindex: "-1", "aria-selected": "false" },
    dataset: { docId: d.doc_id || "", queryId: ctx.queryId || "", order: idx0, kind },
  });

  // ── name: icon (or thumbnail), title, snippet, path ──
  const name = cell("fs-c-name");
  const visual = el("span", { className: "fs-visual" });
  visual.appendChild(fileIcon(kind));
  if (ctx.view === "tiles" && features.thumbnail_enabled && d.thumbnail && d.doc_id) {
    const img = el("img", { className: "fs-thumb", attrs: { alt: "", loading: "lazy", decoding: "async" } });
    // Shown only once it has loaded: until then (a 404 while Fess generates it) the icon stands.
    img.addEventListener("load", () => img.classList.add("is-loaded"));
    loadThumbnail(img, "thumbnail/?docId=" + encodeURIComponent(d.doc_id) + "&queryId=" + encodeURIComponent(ctx.queryId || ""), {
      delays: [4000],
      onGiveUp: () => img.remove(),
    });
    visual.appendChild(img);
  }
  name.appendChild(visual);
  const block = el("div", { className: "fs-name-block" });
  const link = el("a", {
    className: "fs-name link",
    attrs: { href: goHref, "data-uri": url, "data-id": d.doc_id || "", "data-order": String(idx0), title: displayPath(source) || title, tabindex: "-1" },
  });
  if (goHref !== "#") { link.setAttribute("target", "_blank"); link.setAttribute("rel", "noopener"); }
  if (d.content_title) link.innerHTML = renderHighlightedSnippet(d.content_title);
  else link.textContent = d.title || d.url || "";
  block.appendChild(link);
  const description = el("div", { className: "fs-snippet description" });
  description.innerHTML = renderHighlightedSnippet(d.content_description || escapeHtml(d.digest || ""));
  block.appendChild(description);
  block.appendChild(el("div", { className: "fs-path site" })).appendChild(el("cite", { text: location }));
  name.appendChild(block);
  row.appendChild(name);

  // ── location: the parent folder, which moves the scope there ──
  const loc = cell("fs-c-loc");
  const locBtn = el("button", { className: "fs-loc-btn", text: location, attrs: { type: "button", tabindex: "-1", title: location } });
  locBtn.addEventListener("click", ev => { ev.stopPropagation(); ctx.actions.showInFolder(d); });
  loc.appendChild(locBtn);
  row.appendChild(loc);

  // ── modified / size / type ──
  row.appendChild(cell("fs-c-mod")).textContent = formatDate(d.last_modified || d.timestamp);
  row.appendChild(cell("fs-c-size")).textContent = formatFileSize(d.content_length);
  row.appendChild(cell("fs-c-type")).textContent = t("fs.kind_" + kind);

  // ── actions ──
  const actions = cell("fs-c-actions");
  const open = el("a", {
    className: "fs-act", attrs: { href: goHref, "aria-label": t("fs.open_original") + ": " + title, title: t("fs.open_original"), tabindex: "-1" },
  });
  if (goHref !== "#") { open.setAttribute("target", "_blank"); open.setAttribute("rel", "noopener"); }
  open.appendChild(uiIcon("external"));
  open.addEventListener("click", ev => ev.stopPropagation());
  actions.appendChild(open);
  actions.appendChild(actionButton("copy", t("fs.copy_path"), (ev, btn) => ctx.actions.copyPath(copyPathOf(source), btn)));
  actions.appendChild(actionButton("up", t("fs.show_in_folder"), () => ctx.actions.showInFolder(d)));
  if (features.user_favorite) {
    const fav = actionButton("star", t("result.favorite_add"), null, { className: "favorite-btn", attrs: { "aria-pressed": "false" } });
    fav.dataset.count = String(d.favorite_count || 0);
    actions.appendChild(fav);
  }
  row.appendChild(actions);
  return row;
}

/** Column headers; a sortable one is a button, and `aria-sort` marks the active column. */
function buildHead(head, { sort, hasKeyword, onSort }) {
  clear(head);
  const current = describeSort(sort, hasKeyword);
  for (const col of COLUMNS) {
    const h = el("div", { className: "fs-h " + col.cls, attrs: { role: "columnheader" } });
    const label = t(col.labelKey);
    if (col.sort && onSort) {
      const active = current.column === col.sort;
      h.setAttribute("aria-sort", active ? (current.dir === "asc" ? "ascending" : "descending") : "none");
      const supported = isSortSupported(col.sort);
      const btn = el("button", { className: "fs-sort-btn" + (active ? " is-active" : ""), attrs: { type: "button", "data-col": col.sort } });
      btn.appendChild(el("span", { text: label }));
      btn.appendChild(uiIcon(active ? (current.dir === "asc" ? "sort-asc" : "sort-desc") : "sort-none"));
      if (!supported) {
        btn.disabled = true;
        btn.title = t("fs.sort_unsupported", { column: label });
      } else {
        btn.addEventListener("click", () => onSort(col.sort));
      }
      h.appendChild(btn);
    } else {
      h.appendChild(el("span", { className: col.hiddenLabel ? "visually-hidden" : "", text: label }));
    }
    head.appendChild(h);
  }
}

/**
 * The list controller. `list` is the <ol> of rows, `head` the header row of the grid.
 *
 * @param {{list:HTMLElement, head?:HTMLElement, onSelect:(doc:object,index:number,source:string)=>void,
 *          onOpen?:()=>void, onTogglePreview:()=>void, onFocusTree:()=>void}} opts
 */
export function createListView({ list, head, onSelect, onTogglePreview, onFocusTree }) {
  let docs = [];
  let active = -1;
  let view = "details";
  let lastCtx = null;

  const rows = () => Array.from(list.children);

  function setRoving(index) {
    rows().forEach((row, i) => {
      const on = i === index;
      row.tabIndex = on ? 0 : -1;
      row.setAttribute("aria-selected", on ? "true" : "false");
      row.classList.toggle("is-selected", on);
      // The row's own controls join the tab order only while the row is the active one.
      row.querySelectorAll(".fs-name, .fs-loc-btn, .fs-act").forEach(c => c.setAttribute("tabindex", on ? "0" : "-1"));
    });
  }

  function select(index, { focus = true, source = "program" } = {}) {
    const all = rows();
    if (index < 0 || index >= all.length) return;
    active = index;
    setRoving(index);
    if (focus) all[index].focus({ preventScroll: true });
    reveal(all[index]);
    if (onSelect) onSelect(docs[index], index, source);
  }

  /** Tiles per row, read from the layout (1 outside the tiles view or when it cannot be measured). */
  function columns() {
    if (view !== "tiles") return 1;
    const all = rows();
    if (all.length < 2) return 1;
    const top = all[0].offsetTop;
    let n = 0;
    while (n < all.length && all[n].offsetTop === top) n++;
    return Math.max(1, n);
  }

  list.addEventListener("keydown", ev => {
    const row = ev.target.closest && ev.target.closest(".fs-row");
    // Keys typed in a control inside the row (a button, the title link) belong to that control.
    if (!row || ev.target !== row || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const action = listKey({ key: ev.key, index: rows().indexOf(row), count: docs.length, columns: columns() });
    if (!action) return;
    ev.preventDefault();
    if (action.type === "move") select(action.index, { source: "key" });
    else if (action.type === "open") { const a = row.querySelector(".fs-name"); if (a) a.click(); }
    else if (action.type === "preview") { if (onTogglePreview) onTogglePreview(); }
    else if (action.type === "tree") { if (onFocusTree) onFocusTree(); }
  });

  list.addEventListener("click", ev => {
    const row = ev.target.closest && ev.target.closest(".fs-row");
    if (!row) return;
    // A click on a link or button does that control's job; any other click selects the row.
    if (ev.target.closest("a, button")) return;
    select(rows().indexOf(row), { source: "click" });
  });

  list.addEventListener("dblclick", ev => {
    const row = ev.target.closest && ev.target.closest(".fs-row");
    if (!row || ev.target.closest("a, button")) return;
    const a = row.querySelector(".fs-name");
    if (a) a.click();
  });

  // Moving focus into a row by Tab or click makes it the selected one.
  list.addEventListener("focusin", ev => {
    const row = ev.target.closest && ev.target.closest(".fs-row");
    if (!row) return;
    const i = rows().indexOf(row);
    if (i >= 0 && i !== active) select(i, { focus: false, source: "focus" });
  });

  return {
    /** Draw the rows; the row of `ctx.selectedDocId` (if it is on this page) stays active. */
    render(hits, ctx) {
      docs = hits || [];
      lastCtx = ctx;
      view = ctx.view || view;
      list.dataset.view = view;
      if (head) head.dataset.view = view;
      clear(list);
      docs.forEach((d, i) => list.appendChild(buildRow(d, i, { ...ctx, view })));
      const keep = ctx.selectedDocId ? docs.findIndex(d => d.doc_id === ctx.selectedDocId) : -1;
      active = keep >= 0 ? keep : -1;
      setRoving(active >= 0 ? active : -1);
      // With nothing selected the first row is the one the Tab key lands on.
      if (active < 0 && list.firstElementChild) list.firstElementChild.tabIndex = 0;
      return keep;
    },
    renderHead(opts) {
      if (head) buildHead(head, opts);
    },
    /** Switch layout without a new search; rebuilds rows so tiles can pick up thumbnails. */
    setView(mode, ctx) {
      view = mode;
      list.dataset.view = mode;
      if (head) head.dataset.view = mode;
      if (lastCtx && docs.length) {
        const selected = active >= 0 && docs[active] ? docs[active].doc_id : "";
        this.render(docs, { ...lastCtx, ...ctx, view: mode, selectedDocId: selected });
      }
    },
    select,
    count: () => docs.length,
    activeIndex: () => active,
    selectedDoc: () => (active >= 0 ? docs[active] || null : null),
    focusActive() {
      const all = rows();
      const target = all[active >= 0 ? active : 0];
      if (target) target.focus();
    },
    rows,
    columns,
    scopeOfRow: i => (docs[i] ? scopeOfDocParent(docs[i].url_link || docs[i].url) : null),
  };
}
