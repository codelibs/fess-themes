// SPDX-License-Identifier: Apache-2.0
// The folder tree as data. Fess has no folder hierarchy to ask for, so the tree is
// assembled from what facets give back:
//
//   roots      the `host` facet: one source per host
//   children   a `url` facet narrowed to a node's subtree, folded into the next level
//              of folders by foldUrls()
//   seen       folders the current result page's documents sit in, merged in as they
//              appear (their count is unknown, so none is shown)
//
// Counts are exact when a fold saw every document under the node and a lower bound
// ("≥") otherwise: the url facet returns at most facet.size values, so a big subtree is
// only sampled. The data source that fills the tree lives in treesource.js; a future
// server-side hierarchical facet replaces that file, not this one.
// Pure module: no DOM, no network.

import { scopeClause, scopeKey } from "./scope.js";
import { parseUrl, folderPrefix, decodeSegment, ancestorScopes, scopeOfDocParent } from "./paths.js";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const byLabel = (a, b) => collator.compare(a.label, b.label) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Fold the buckets of a `url` facet into the folders directly under `base`.
 *
 * @param {{type:"host",host:string}|{type:"url",prefix:string}} base the node being expanded
 * @param {{value:string,count:number}[]} buckets facet.field=url answer
 * @param {{total?:number, relation?:string}} [meta] hits the request matched (record_count)
 * @returns {{children: {prefix:string,label:string,count:number,scheme:string,showScheme:boolean}[],
 *            direct:number, total:number, exact:boolean}}
 *   `exact` is true only when the buckets account for every matched hit: otherwise the
 *   facet was truncated and every count is a lower bound.
 */
export function foldUrls(base, buckets, meta = {}) {
  const basePrefixDepth = base.type === "url" ? (parseUrl(base.prefix) || { dirSegments: [] }).dirSegments.length : 0;
  const children = new Map();
  let direct = 0;
  let total = 0;
  let sumAll = 0;
  for (const bucket of buckets || []) {
    const count = Number(bucket && bucket.count) || 0;
    sumAll += count;
    const p = parseUrl(bucket && bucket.value);
    if (!p) continue;
    if (base.type === "url" ? !bucket.value.startsWith(base.prefix) : p.host !== base.host) continue;
    total += count;
    if (p.dirSegments.length <= basePrefixDepth) { direct += count; continue; }
    const prefix = folderPrefix(p, basePrefixDepth + 1);
    const label = decodeSegment(p.dirSegments[basePrefixDepth]);
    const child = children.get(prefix) || { prefix, label, count: 0, scheme: p.scheme, showScheme: false };
    child.count += count;
    children.set(prefix, child);
  }
  const list = [...children.values()].sort((a, b) => byLabel({ label: a.label, id: a.prefix }, { label: b.label, id: b.prefix }));
  const seen = new Map();
  for (const c of list) seen.set(c.label, (seen.get(c.label) || 0) + 1);
  for (const c of list) c.showScheme = seen.get(c.label) > 1;
  const relationOk = meta.relation == null || meta.relation === "EQUAL_TO";
  const exact = typeof meta.total === "number" && relationOk && sumAll >= meta.total;
  return { children: list, direct, total, exact };
}

/** "" for an unknown count, "12" when exact, "≥12" when it is only a lower bound. */
export function countLabel(node, locale) {
  if (!node || node.count == null) return "";
  const n = Number(node.count).toLocaleString(locale);
  return (node.approx ? "≥" : "") + n;
}

// ─── model ───────────────────────────────────────────────────────────────────────

export function createTree() {
  return { roots: [], index: new Map() };
}

function labelOf(scope) {
  if (scope.type === "host") return scope.host;
  const p = parseUrl(scope.prefix);
  const last = p && p.dirSegments[p.dirSegments.length - 1];
  return last == null ? scope.prefix : decodeSegment(last);
}

function makeNode(scope, parent) {
  return {
    id: scopeKey(scope), scope, kind: scope.type, label: labelOf(scope),
    scheme: "", showScheme: false,
    count: null, approx: false, partial: false,
    loaded: false, expanded: false, loading: false, seen: false,
    children: [], parent: parent || null,
  };
}

function forget(tree, node) {
  tree.index.delete(node.id);
  node.children.forEach(c => forget(tree, c));
}

/** The node for a scope, or null. */
export function findNode(tree, scope) {
  if (!scope) return null;
  return tree.index.get(scopeKey(scope)) || null;
}

export function setExpanded(tree, node, expanded) {
  node.expanded = !!expanded;
}

/**
 * Replace the roots with the sources of a `host` facet answer. A source that is still
 * listed keeps its node (and so its expansion and children); one that is not is dropped.
 */
export function setRoots(tree, buckets) {
  const keep = new Set();
  const roots = [];
  for (const bucket of buckets || []) {
    if (!bucket || !bucket.value) continue;
    const scope = { type: "host", host: String(bucket.value) };
    let node = tree.index.get(scopeKey(scope));
    if (!node) {
      node = makeNode(scope, null);
      tree.index.set(node.id, node);
    }
    node.count = Number(bucket.count) || 0;
    node.approx = false;
    keep.add(node.id);
    roots.push(node);
  }
  for (const old of tree.roots) if (!keep.has(old.id)) forget(tree, old);
  tree.roots = roots.sort(byLabel);
}

/**
 * Give `node` the children a url-facet fold found. Folders already known keep their state;
 * a folder the fold no longer lists is dropped when the fold was exact (it is empty under
 * the current filters) but kept when it was only a sample and the result page showed it.
 */
export function applyFold(tree, node, fold) {
  const keepIds = new Set();
  const next = [];
  for (const entry of fold.children) {
    const scope = { type: "url", prefix: entry.prefix };
    let child = tree.index.get(scopeKey(scope));
    if (!child) {
      child = makeNode(scope, node);
      tree.index.set(child.id, child);
    }
    child.parent = node;
    child.label = entry.label;
    child.scheme = entry.scheme;
    child.showScheme = entry.showScheme;
    child.count = entry.count;
    child.approx = !fold.exact;
    keepIds.add(child.id);
    next.push(child);
  }
  for (const old of node.children) {
    if (keepIds.has(old.id)) continue;
    if (!fold.exact && old.seen) next.push(old);
    else forget(tree, old);
  }
  node.children = next.sort(byLabel);
  // A fold that did not see every document may have missed whole folders, not just counts.
  node.partial = !fold.exact;
  node.loaded = true;
  node.loading = false;
}

function insertSorted(list, node) {
  list.push(node);
  list.sort(byLabel);
}

/**
 * The node for `scope`, creating it and every ancestor that is missing (their counts stay
 * unknown). Ancestors are expanded unless `expand` is false.
 */
export function ensurePath(tree, scope, { expand = true, seen = false } = {}) {
  if (!scope) return null;
  const chain = ancestorScopes(scope);
  let parent = null;
  let node = null;
  chain.forEach((s, i) => {
    const key = scopeKey(s);
    node = tree.index.get(key);
    if (!node) {
      node = makeNode(s, parent);
      tree.index.set(key, node);
      insertSorted(parent ? parent.children : tree.roots, node);
    }
    if (seen && i > 0) node.seen = true;
    if (expand && i < chain.length - 1) node.expanded = true;
    parent = node;
  });
  return node;
}

/** Add the folders the given result documents sit in (uncounted, unexpanded, marked seen). */
export function mergeSeen(tree, docs) {
  for (const doc of docs || []) {
    const scope = doc && scopeOfDocParent(doc.url_link || doc.url);
    if (!scope || scope.type !== "url") continue;
    ensurePath(tree, scope, { expand: false, seen: true });
  }
}

/**
 * Apply exact counts from `facet.query` answers: `value` is the ex_q clause of a scope.
 * Used for the ancestors of a deep-linked folder, which the url fold never counts.
 */
export function applyClauseCounts(tree, facetQuery) {
  if (!Array.isArray(facetQuery)) return;
  const byClause = new Map(facetQuery.map(f => [f.value, Number(f.count)]));
  for (const node of tree.index.values()) {
    const clause = scopeClause(node.scope);
    if (byClause.has(clause) && !Number.isNaN(byClause.get(clause))) {
      node.count = byClause.get(clause);
      node.approx = false;
    }
  }
}

/** The part of the tree that is on screen, in order, with the numbers ARIA wants. */
export function visibleNodes(tree) {
  const out = [];
  const walk = (nodes, level) => {
    nodes.forEach((node, i) => {
      out.push({ node, level, posInSet: i + 1, setSize: nodes.length });
      if (node.expanded && node.children.length > 0) walk(node.children, level + 1);
    });
  };
  walk(tree.roots, 1);
  return out;
}
