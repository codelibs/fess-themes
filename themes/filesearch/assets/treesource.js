// SPDX-License-Identifier: Apache-2.0
// Where the folder tree's data comes from. Fess has no hierarchy endpoint, so for now the
// answers are assembled from facets (see tree.js):
//
//   loadRoots(base, ...)           facet.field=host      -> the sources
//   loadChildren(base, scope, ...) ex_q=<scope> + facet.field=url, folded into folders
//   loadChildren(..., {browse})    the same folders found one at a time (see discoverChildren)
//
// `base` is the parameter set of the search the user is looking at, minus the folder scope
// and the paging, so every count in the tree is a count under the current keyword and
// filters. This file is the whole boundary: a server-side hierarchical facet would replace
// these two functions and nothing above them.

import * as api from "./api.js";
import { scopeClause, withBrowseAll } from "./scope.js";
import { foldUrls } from "./tree.js";
import { MAX_CLAUSE_LENGTH } from "./paths.js";

/** The most sources one request lists (the server clamps it to query.facet.fields.size.max). */
export const FACET_SIZE = 1000;

/**
 * The most URLs one folder request asks for. Fess clamps it to query.facet.fields.size.max
 * (default 1000), so the default is unchanged and an administrator who raises that setting
 * gets a tree that sees that many documents per folder. 65535 is OpenSearch's default
 * search.max_buckets, the most a terms aggregation may ask for.
 */
export const CHILDREN_FACET_SIZE = 65535;

function facetResult(env, name) {
  const entry = ((env && env.facet_field) || []).find(f => f && f.name === name);
  return entry ? (entry.result || []) : null;
}

/** Request for the sources, plus exact counts for the ancestors of the selected folder. */
export function rootsParams(base, ancestors) {
  const params = {
    ...base, start: 0, num: 1,
    "facet.field": ["host"], "facet.size": FACET_SIZE,
  };
  delete params.sort;
  if (ancestors && ancestors.length > 0) params["facet.query"] = ancestors.map(scopeClause);
  return withBrowseAll(params);
}

/** Request for the folders inside `scope`. */
export function childrenParams(base, scope) {
  const params = {
    ...base,
    ex_q: [...(base.ex_q || []), scopeClause(scope)],
    start: 0, num: 1,
    "facet.field": ["url"], "facet.size": CHILDREN_FACET_SIZE,
  };
  delete params.sort;
  return params;
}

/** The most requests one folder may spend finding its sub-folders in browse mode. */
export const MAX_PROBES = 300;

/** The smallest string above every string that starts with `prefix` (a folder prefix, ending in "/"). */
export function afterFolder(prefix) {
  return prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
}

/** ex_q clause for the urls from `value` on (`inclusive`) or strictly after it. The value is quoted so spaces survive. */
export function urlFromClause(value, inclusive) {
  const quoted = '"' + String(value).replace(/[\\"]/g, "\\$&") + '"';
  return "url:" + (inclusive ? "[" : "{") + quoted + " TO *]";
}

/** Request for the first url inside `scope` (and, with `from`, not before it), in url order. */
export function probeParams(base, scope, from, size) {
  const params = childrenParams(base, scope);
  params["facet.size"] = size;
  params["facet.sort"] = "term.asc";
  if (from) params.ex_q = [...params.ex_q, urlFromClause(from.value, from.inclusive)];
  return params;
}

/** Where the next probe starts: after the folder the url sits in, or just after the url itself. */
function resumePoint(scope, bucket) {
  const child = foldUrls(scope, [bucket]).children[0];
  return child ? { value: afterFolder(child.prefix), inclusive: true } : { value: bucket.value, inclusive: false };
}

/**
 * The folders inside `scope` without counting documents, for a folder too big to count.
 * A url facet is one bucket per document, so a folder of 100,000 files cannot be folded in
 * one answer. Instead: ask for the first 1000 urls in url order; if that is not the whole
 * folder, keep asking for the single first url after the last folder found, which names
 * the next folder, until nothing is left. One request per further folder, at most MAX_PROBES.
 *
 * @returns {Promise<{available:boolean, fold:object, permissionState:string}>} the fold has
 *   no counts; `exact` is false only when the search for folders was cut short
 */
async function discoverChildren(base, scope, signal) {
  const env = await api.get("/search", probeParams(base, scope, null, FACET_SIZE), { signal });
  const buckets = facetResult(env, "url");
  if (buckets === null) return { available: false, fold: foldUrls(scope, [], {}), permissionState: env.permission_state };
  const seen = [...buckets];
  let exact = foldUrls(scope, buckets, { total: env.record_count, relation: env.record_count_relation }).exact;
  let from = exact || buckets.length === 0 ? null : resumePoint(scope, buckets[buckets.length - 1]);
  for (let probes = 0; from; probes++) {
    if (probes >= MAX_PROBES || urlFromClause(from.value, from.inclusive).length > MAX_CLAUSE_LENGTH) { exact = false; break; }
    const next = facetResult(await api.get("/search", probeParams(base, scope, from, 1), { signal }), "url") || [];
    if (next.length === 0) { exact = true; break; }
    seen.push(next[0]);
    from = resumePoint(scope, next[0]);
  }
  const fold = foldUrls(scope, seen, {});
  fold.children.forEach(c => { c.count = null; });
  return { available: true, fold: { ...fold, exact }, permissionState: env.permission_state };
}

/**
 * @returns {Promise<{available:boolean, buckets:{value:string,count:number}[],
 *   facetQuery:{value:string,count:number}[], permissionState:string}>} `available` is false
 *   when the answer has no host facet at all (as under some rank-fusion searches): that is
 *   "unknown", not "no sources".
 */
export async function loadRoots(base, { signal, ancestors } = {}) {
  const env = await api.get("/search", rootsParams(base, ancestors), { signal });
  const buckets = facetResult(env, "host");
  return {
    available: buckets !== null,
    buckets: buckets || [],
    facetQuery: env.facet_query,
    permissionState: env.permission_state,
  };
}

/** @returns {Promise<{available:boolean, fold:object, permissionState:string}>} */
export async function loadChildren(base, scope, { signal, browse } = {}) {
  if (browse) return discoverChildren(base, scope, signal);
  const env = await api.get("/search", childrenParams(base, scope), { signal });
  const buckets = facetResult(env, "url");
  const fold = foldUrls(scope, buckets || [], { total: env.record_count, relation: env.record_count_relation });
  return { available: buckets !== null, fold, permissionState: env.permission_state };
}
