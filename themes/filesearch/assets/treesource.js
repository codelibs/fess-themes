// SPDX-License-Identifier: Apache-2.0
// Where the folder tree's data comes from. Fess has no hierarchy endpoint, so for now the
// answers are assembled from facets (see tree.js):
//
//   loadRoots(base, ...)           facet.field=host      -> the sources
//   loadChildren(base, scope, ...) ex_q=<scope> + facet.field=url, folded into folders
//
// `base` is the parameter set of the search the user is looking at, minus the folder scope
// and the paging, so every count in the tree is a count under the current keyword and
// filters. This file is the whole boundary: a server-side hierarchical facet would replace
// these two functions and nothing above them.

import * as api from "./api.js";
import { scopeClause, withBrowseAll } from "./scope.js";
import { foldUrls } from "./tree.js";

/** The most values one facet returns (query.facet.fields.size.max). */
export const FACET_SIZE = 1000;

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
    "facet.field": ["url"], "facet.size": FACET_SIZE,
  };
  delete params.sort;
  return params;
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
export async function loadChildren(base, scope, { signal } = {}) {
  const env = await api.get("/search", childrenParams(base, scope), { signal });
  const buckets = facetResult(env, "url");
  const fold = foldUrls(scope, buckets || [], { total: env.record_count, relation: env.record_count_relation });
  return { available: buckets !== null, fold, permissionState: env.permission_state };
}
