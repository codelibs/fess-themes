// SPDX-License-Identifier: Apache-2.0
// The folder tree on screen: a WAI-ARIA tree (role="tree" / "treeitem", aria-level,
// aria-expanded, aria-selected, roving tabindex) over the model in tree.js, filled from
// treesource.js. The selected node is the folder the result list is scoped to; choosing
// one hands its scope to `onSelect`, and whoever owns the address bar does the rest.
//
// Counts come from facets under the current keyword and filters (see tree.js), so the tree
// reloads when those change and shows "≥n" where a count is only a lower bound.

import { t } from "./i18n.js";
import { el, clear, reveal } from "./dom.js";
import { uiIcon } from "./icons.js";
import { scopeKey, sameScope } from "./scope.js";
import { ancestorScopes } from "./paths.js";
import { treeKey } from "./keynav.js";
import {
  createTree, setRoots, applyFold, ensurePath, mergeSeen, visibleNodes, countLabel, findNode,
  setExpanded, applyClauseCounts,
} from "./tree.js";
import * as defaultSource from "./treesource.js";

let seq = 0;

/**
 * @param {{
 *   root: HTMLElement, status?: HTMLElement, warning?: HTMLElement,
 *   source?: {loadRoots:Function, loadChildren:Function},
 *   getBase: () => object,                 the current search's parameters, without folder or paging
 *   onSelect: (scope:object) => void,
 *   onFocusList?: () => void,
 * }} opts
 */
export function createTreeView({ root, status, warning, source = defaultSource, getBase, onSelect, onFocusList }) {
  const tree = createTree();
  const idPrefix = "fs-tn" + (++seq) + "-";
  let selected = null;           // the scope of the result list
  let focusId = "";              // the node the Tab key lands on
  let baseKey = null;            // what the loaded counts were computed for
  let abort = null;
  let failed = null;             // { retry } while the roots could not be loaded
  let rootsLoaded = false;
  let unavailable = false;

  // The status line shows the most important thing there is to say: a failure, a missing
  // facet, loading, and last that some open folder's list may be incomplete.
  let baseStatus = "";
  const setStatus = (text) => {
    baseStatus = text || "";
    if (status && !failed) status.textContent = baseStatus;
  };
  const refreshStatus = (items) => {
    if (!status || failed) return;
    const partial = items.some(i => i.node.expanded && i.node.loaded && i.node.partial);
    status.textContent = baseStatus || (partial ? t("fs.tree_partial") : "");
  };

  function setWarning(state) {
    if (!warning) return;
    const text = state === "PENDING" ? t("errors.user_permissions_loading")
      : state === "FAILED" ? t("errors.user_permissions_unavailable") : "";
    warning.textContent = text;
    warning.classList.toggle("d-none", !text);
  }

  function nodeEl(id) {
    return Array.from(root.querySelectorAll("[role=treeitem]")).find(n => n.dataset.id === id) || null;
  }

  function render() {
    const hadFocus = root.contains(document.activeElement);
    const items = visibleNodes(tree);
    clear(root);
    if (!focusId || !items.some(i => i.node.id === focusId)) {
      const sel = selected && items.find(i => i.node.id === scopeKey(selected));
      focusId = sel ? sel.node.id : (items[0] ? items[0].node.id : "");
    }
    items.forEach(({ node, level, posInSet, setSize }, i) => {
      const isSelected = !!selected && node.id === scopeKey(selected);
      const canExpand = !node.loaded || node.children.length > 0;
      const item = el("div", {
        className: "fs-node" + (isSelected ? " is-selected" : "") + (node.loading ? " is-loading" : ""),
        attrs: {
          role: "treeitem", id: idPrefix + i, "aria-level": level, "aria-setsize": setSize, "aria-posinset": posInSet,
          "aria-selected": isSelected ? "true" : "false", tabindex: node.id === focusId ? "0" : "-1",
        },
        dataset: { id: node.id },
      });
      if (canExpand) item.setAttribute("aria-expanded", node.expanded ? "true" : "false");
      if (node.loading) item.setAttribute("aria-busy", "true");
      item.style.paddingInlineStart = (0.35 + (level - 1) * 1.05) + "rem";
      const twisty = el("span", { className: "fs-twisty" + (canExpand ? (node.expanded ? " is-open" : "") : " is-leaf"), attrs: { "aria-hidden": "true" } });
      if (canExpand) twisty.appendChild(uiIcon("chevron"));
      item.appendChild(twisty);
      const iconName = node.kind === "host" ? "server" : (node.expanded && node.children.length ? "folder-open" : "folder");
      item.appendChild(el("span", { className: "fs-node-icon" })).appendChild(uiIcon(iconName));
      const label = el("span", { className: "fs-node-label", text: node.label });
      item.appendChild(label);
      if (node.showScheme && node.scheme) item.appendChild(el("span", { className: "fs-node-scheme", text: node.scheme }));
      const count = countLabel(node);
      if (count) {
        const c = el("span", { className: "fs-node-count" + (node.approx ? " is-approx" : ""), text: count });
        if (node.approx) c.title = t("fs.tree_count_approx", { n: Number(node.count).toLocaleString() });
        item.appendChild(c);
      }
      root.appendChild(item);
    });
    refreshStatus(items);
    if (hadFocus) {
      const f = nodeEl(focusId);
      if (f) f.focus({ preventScroll: true });
    }
    root.toggleAttribute("aria-busy", false);
  }

  /** A failed roots load is reported in the status line, with a way to try again. */
  function renderProblem() {
    if (!failed || !status) return;
    clear(status);
    status.appendChild(el("span", { text: t("fs.tree_error") + " " }));
    const retry = el("button", { className: "btn btn-sm btn-light", text: t("fs.tree_retry"), attrs: { type: "button" } });
    retry.addEventListener("click", () => failed.retry());
    status.appendChild(retry);
  }

  /** A chain of folders with a single sub-folder each (a crawl rooted at /data/files) opens in one go, up to this deep. */
  const CHAIN_DEPTH = 8;

  async function expand(node, chain = 0) {
    setExpanded(tree, node, true);
    let only = null;
    if (!node.loaded && !node.loading) {
      node.loading = true;
      render();
      try {
        const out = await source.loadChildren(getBase(), node.scope, { signal: abort ? abort.signal : undefined });
        setWarning(out.permissionState);
        applyFold(tree, node, out.fold);
        if (selected) ensurePath(tree, selected, { expand: false });
        if (!out.available) setStatus(t("fs.tree_unavailable"));
        // A folder that holds nothing but one sub-folder gives the reader nothing to choose: open that one too.
        if (out.fold.children.length === 1 && out.fold.direct === 0 && chain < CHAIN_DEPTH) {
          only = findNode(tree, { type: "url", prefix: out.fold.children[0].prefix });
        }
      } catch (e) {
        node.loading = false;
        if (e && e.name === "AbortError") return;
        setExpanded(tree, node, false);
        setStatus(t("fs.tree_error"));
      }
    }
    render();
    if (only && !only.expanded) await expand(only, chain + 1);
  }

  function collapse(node) {
    setExpanded(tree, node, false);
    render();
  }

  function choose(node) {
    focusId = node.id;
    if (!node.expanded && !node.loaded) expand(node); else render();
    if (onSelect) onSelect(node.scope);
  }

  function focusNode(id) {
    focusId = id;
    render();
    const f = nodeEl(id);
    if (f) { f.focus({ preventScroll: true }); reveal(f); }
  }

  root.addEventListener("click", ev => {
    const item = ev.target.closest("[role=treeitem]");
    if (!item) return;
    const node = tree.index.get(item.dataset.id);
    if (!node) return;
    if (ev.target.closest(".fs-twisty")) {
      focusId = node.id;
      if (node.expanded) collapse(node); else expand(node);
      return;
    }
    choose(node);
  });

  root.addEventListener("keydown", ev => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const items = visibleNodes(tree);
    const index = items.findIndex(i => i.node.id === focusId);
    const action = treeKey({ key: ev.key, items, index });
    if (!action) return;
    ev.preventDefault();
    if (action.type === "focus") focusNode(items[action.index].node.id);
    else if (action.type === "expand") { focusId = items[action.index].node.id; expand(items[action.index].node).then(() => focusNode(focusId)); }
    else if (action.type === "collapse") { focusId = items[action.index].node.id; collapse(items[action.index].node); focusNode(focusId); }
    else if (action.type === "select") choose(items[action.index].node);
    else if (action.type === "list") { if (onFocusList) onFocusList(); }
  });

  async function loadRootsNow(ancestors) {
    if (abort) abort.abort();
    abort = new AbortController();
    const { signal } = abort;
    setStatus(t("fs.tree_loading"));
    root.setAttribute("aria-busy", "true");
    try {
      const out = await source.loadRoots(getBase(), { signal, ancestors });
      if (signal.aborted) return;
      failed = null;
      setWarning(out.permissionState);
      unavailable = !out.available;
      if (out.available) setRoots(tree, out.buckets);
      applyClauseCounts(tree, out.facetQuery);
      rootsLoaded = true;
      setStatus(unavailable ? t("fs.tree_unavailable") : (tree.roots.length === 0 ? t("fs.tree_empty") : ""));
    } catch (e) {
      if (e && e.name === "AbortError") return;
      failed = { retry: () => { baseKey = null; loadRootsNow(ancestors); } };
      setStatus("");
    }
    if (selected) ensurePath(tree, selected);
    render();
    renderProblem();
  }

  /** Reload the folders that are open, in order, under the current base. */
  async function reloadOpen(signal) {
    const open = [...tree.index.values()].filter(n => n.expanded && n.id !== undefined);
    for (const node of open) {
      if (signal.aborted) return;
      try {
        const out = await source.loadChildren(getBase(), node.scope, { signal });
        if (signal.aborted) return;
        applyFold(tree, node, out.fold);
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    if (selected) ensurePath(tree, selected, { expand: false });
    render();
    renderProblem();
  }

  return {
    /**
     * Bring the tree in line with the search that just ran.
     *
     * @param {{key:string, scope:object|null, docs:object[], count?:number, relation?:string}} s
     *   `key` identifies the keyword and filters the counts are for; the tree reloads when it changes
     */
    async sync({ key, scope, docs, count, relation }) {
      const previous = selected ? scopeKey(selected) : "";
      selected = scope || null;
      if (selected) {
        const node = ensurePath(tree, selected);
        // The search itself counted this folder exactly.
        if (typeof count === "number" && relation === "EQUAL_TO") { node.count = count; node.approx = false; }
      }
      mergeSeen(tree, docs);
      if (key !== baseKey) {
        baseKey = key;
        // Counts under a different keyword or filter are stale: keep the shape, refresh the numbers.
        tree.index.forEach(n => { n.loaded = false; });
        await loadRootsNow(selected ? ancestorScopes(selected) : undefined);
        if (abort && !abort.signal.aborted && [...tree.index.values()].some(n => n.expanded)) await reloadOpen(abort.signal);
      } else {
        render();
      }
      // Choosing a folder opens it, so its subfolders are in view.
      if (selected && scopeKey(selected) !== previous) {
        const node = findNode(tree, selected);
        if (node) await expand(node);
      }
      renderProblem();
    },
    /** First load on the home view (no search ran). */
    async loadHome() {
      selected = null;
      if (rootsLoaded && baseKey === "home") { render(); return; }
      baseKey = "home";
      await loadRootsNow();
    },
    setSelected(scope) { selected = scope || null; render(); },
    focus() {
      const f = nodeEl(focusId) || root.querySelector("[role=treeitem]");
      if (f) f.focus();
    },
    /** The scope of the selected node, for tests and callers that need it. */
    selected: () => selected,
    nodeCount: () => tree.index.size,
    tree,
    sameSelected: (scope) => sameScope(selected, scope),
  };
}
