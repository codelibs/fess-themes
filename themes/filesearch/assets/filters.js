// SPDX-License-Identifier: Apache-2.0
// File type, modified date and size filters as ex_q clauses, and the whole ex_q list of a
// search: the folder scope first, then the filters. Everything the UI selects travels in
// the address bar as `ex_q`, so back/forward and shared links reproduce it; classifyExQ()
// is the way back from the URL to the stores the UI reads.
//
// Facet semantics worth knowing: Fess counts a facet within the narrowed search (it has no
// post-filter), so choosing a value drives its siblings to zero; the date windows are
// cumulative (24 hours is inside a week) while the size ranges are disjoint. ex_q clauses
// AND, so a second file type goes into one OR group. Pure module: no DOM, no network.

import { scopeClause, parseScopeClause } from "./scope.js";

/** Modified-date windows on last_modified (cumulative). */
export const DATE_PRESETS = [
  { id: "1d", labelKey: "fs.date_1d", clause: "last_modified:[now/d-1d TO *]" },
  { id: "1w", labelKey: "fs.date_1w", clause: "last_modified:[now/d-7d TO *]" },
  { id: "1m", labelKey: "fs.date_1m", clause: "last_modified:[now/d-1M TO *]" },
  { id: "1y", labelKey: "fs.date_1y", clause: "last_modified:[now/d-1y TO *]" },
];

/** Size ranges on content_length, in bytes (disjoint). */
export const SIZE_PRESETS = [
  { id: "xs", labelKey: "fs.size_xs", clause: "content_length:[0 TO 9999]" },
  { id: "s", labelKey: "fs.size_s", clause: "content_length:[10000 TO 99999]" },
  { id: "m", labelKey: "fs.size_m", clause: "content_length:[100000 TO 999999]" },
  { id: "l", labelKey: "fs.size_l", clause: "content_length:[1000000 TO 9999999]" },
  { id: "xl", labelKey: "fs.size_xl", clause: "content_length:[10000000 TO *]" },
];

export function presetFor(presets, clause) {
  return presets.find(p => p.clause === clause) || null;
}

/** Every preset clause: asked for as facet.query in the search request, so each gets a count. */
export function facetQueryClauses() {
  return [...DATE_PRESETS, ...SIZE_PRESETS].map(p => p.clause);
}

const TYPE_NAME = /^[A-Za-z0-9_]+$/;
const SINGLE = /^filetype:([A-Za-z0-9_]+)$/;
const GROUP = /^\((filetype:[A-Za-z0-9_]+(?: OR filetype:[A-Za-z0-9_]+)*)\)$/;

/** One clause for a set of file types: a term, or an OR group for several; "" for none. */
export function filetypeClause(values) {
  const types = [...new Set((values || []).filter(v => typeof v === "string" && TYPE_NAME.test(v)))];
  if (types.length === 0) return "";
  if (types.length === 1) return "filetype:" + types[0];
  return "(" + types.map(v => "filetype:" + v).join(" OR ") + ")";
}

/** The file types a clause written by filetypeClause names, or null. */
export function parseFiletypeClause(clause) {
  if (typeof clause !== "string") return null;
  const single = SINGLE.exec(clause);
  if (single) return [single[1]];
  const group = GROUP.exec(clause);
  if (group) return group[1].split(" OR ").map(part => part.slice("filetype:".length));
  return null;
}

/**
 * The ex_q list of a search.
 *
 * @param {{scope?:object|null, facets?:Object<string,string[]>, facetQueries?:string[], exQ?:string[]}} s
 * @param {{withScope?:boolean}} [opts] withScope=false leaves the folder out (the tree
 *   counts every folder under the same filters)
 */
export function composeExQ({ scope = null, facets = {}, facetQueries = [], exQ = [] } = {}, { withScope = true } = {}) {
  const clauses = [];
  if (withScope) {
    const c = scopeClause(scope);
    if (c) clauses.push(c);
  }
  for (const [field, values] of Object.entries(facets || {})) {
    if (!Array.isArray(values)) continue;
    if (field === "filetype") {
      const c = filetypeClause(values);
      if (c) clauses.push(c);
    } else {
      values.forEach(v => clauses.push(field + ":" + v));
    }
  }
  clauses.push(...(facetQueries || []), ...(exQ || []));
  return clauses;
}

/** The stores the UI reads, from the ex_q values of a URL. The reverse of composeExQ. */
export function classifyExQ(clauses) {
  const out = { scope: null, facets: {}, facetQueries: [], exQ: [] };
  const presetClauses = new Set(facetQueryClauses());
  for (const clause of new Set(clauses || [])) {
    if (!clause) continue;
    const scope = out.scope ? null : parseScopeClause(clause);
    const types = parseFiletypeClause(clause);
    if (scope) {
      out.scope = scope;
    } else if (types) {
      const list = (out.facets.filetype = out.facets.filetype || []);
      types.forEach(t => { if (!list.includes(t)) list.push(t); });
    } else if (presetClauses.has(clause)) {
      out.facetQueries.push(clause);
    } else if (clause.startsWith("label:") && clause.length > "label:".length) {
      (out.facets.label = out.facets.label || []).push(clause.slice("label:".length));
    } else {
      out.exQ.push(clause);
    }
  }
  return out;
}

/**
 * The rows of one filter group to draw, with their counts. A count of 0 and a missing
 * count mean opposite things ("nothing matches" and "the server never said"; the v2 payload
 * omits facet_query when the search produced no aggregations), so a group takes counts and
 * zero-suppression together or neither: counted, a zero row is hidden unless it is active
 * (it could never be switched off otherwise); uncounted, every row stays, without a count.
 *
 * @param {{id:string,clause:string}[]} rows
 * @param {Map<string,number>|undefined} counts clause -> count
 * @param {Set<string>} active clauses currently selected
 */
export function visibleRows(rows, counts, active) {
  const counted = counts instanceof Map && rows.length > 0 && rows.every(r => counts.has(r.clause));
  const out = rows.map(r => ({ ...r, count: counted ? Number(counts.get(r.clause)) || 0 : null, active: active.has(r.clause) }));
  return counted ? out.filter(r => r.count > 0 || r.active) : out;
}
