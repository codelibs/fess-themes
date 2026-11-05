// SPDX-License-Identifier: Apache-2.0
// The folder tree's configured roots. An administrator can pass `filesearch.roots` to the
// theme (Admin > System > General > Theme Settings, served as `theme_settings` by
// GET /api/v2/ui/config on Fess 15.10+): one or more URL prefixes separated by "|". When it
// is set, the tree starts at those folders instead of at the sources.
//
//   filesearch.roots=smb://srv/share/Main Repository/Documents/|file:/data/docs/
//
// A prefix is only ever used the way a folder the user clicked is: as a `url:<prefix>*`
// scope clause (scope.js), never as markup and never as a link. "|" separates because a
// URL may hold a space (smb: paths are stored decoded), so white space cannot.
// Pure module: no DOM, no network.

import { scopeFromPrefix, parseUrl, ancestorScopes, MAX_CLAUSE_LENGTH } from "./paths.js";
import { scopeClause, scopeKey } from "./scope.js";

/** The theme setting that names the roots. */
export const ROOTS_KEY = "filesearch.roots";

/** The most roots the tree takes, and the longest one (Fess itself caps a setting value at 1000 characters). */
export const MAX_ROOTS = 20;
export const MAX_ROOT_LENGTH = 500;

/**
 * Every root is counted by its own `facet.query` in the request that loads the tree, and that
 * request is a GET whose line the server refuses above its header limit (8 KB by default; the
 * tree then sticks on its retry button). The count of roots and their length do not bound
 * that: percent-encoding costs a Japanese letter about 9 bytes. So the roots are also held to
 * a budget of ENCODED bytes, measured the way api.js builds the query string
 * (`new URLSearchParams()` + `append("facet.query", clause)`, "&" included). Roots are taken in
 * the order written until the next one does not fit. A tree request carries the roots plus the
 * counts of a selected folder's ancestors; together they stay within QUERY_BUDGET, leaving the
 * rest of the line to the keyword and the filters.
 */
export const ROOTS_QUERY_BUDGET = 2048;
export const QUERY_BUDGET = 3072;

/** Bytes a `facet.query` clause adds to the request line, as api.js encodes it. */
export function queryBytes(clause) {
  return new URLSearchParams([["facet.query", clause]]).toString().length + 1;
}

const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * `theme_settings` of a /ui/config answer, as a plain object of strings. Fess 15.9 and
 * earlier send none, and a value that is not a string is not a setting: both read as "unset".
 *
 * @param {object|null|undefined} config the /ui/config envelope (api.getConfig())
 * @returns {Record<string,string>}
 */
export function themeSettings(config) {
  const raw = config && config.theme_settings;
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * The folder scopes a `filesearch.roots` value names, in the order written.
 *
 * An item is dropped when it is empty, longer than MAX_ROOT_LENGTH, holds a control
 * character, is not a URL (`scheme:...`), or would make an ex_q clause the API refuses
 * (MAX_CLAUSE_LENGTH). A root that names the same scope as an earlier one is dropped
 * (`smb://srv/`, `smb1://srv/` and `file:////srv/` are all the source `srv`), and so is a root
 * inside another root, a source included, because the outer one already holds it and the
 * tree keeps one node per scope. Then the first MAX_ROOTS roots that fit ROOTS_QUERY_BUDGET are
 * kept, in the order written. A prefix without a trailing "/" gets one, as every folder scope
 * has. A prefix with no folder in it ("smb://srv/") is the whole source and becomes a host
 * scope. The prefix is taken as written: it must match the `url` field as stored.
 *
 * @param {unknown} value
 * @returns {({type:"host",host:string}|{type:"url",prefix:string})[]}
 */
export function parseRoots(value) {
  if (typeof value !== "string") return [];
  const found = new Map();
  for (const piece of value.split("|")) {
    const item = piece.trim();
    if (item === "" || item.length > MAX_ROOT_LENGTH || CONTROL.test(item) || !parseUrl(item)) continue;
    const scope = scopeFromPrefix(item);
    if (scopeClause(scope).length > MAX_CLAUSE_LENGTH) continue;
    if (!found.has(scopeKey(scope))) found.set(scopeKey(scope), scope);
  }
  const scopes = [...found.values()].filter(scope =>
    !ancestorScopes(scope).some(a => scopeKey(a) !== scopeKey(scope) && found.has(scopeKey(a))));
  const kept = [];
  let bytes = 0;
  for (const scope of scopes) {
    bytes += queryBytes(scopeClause(scope));
    if (kept.length >= MAX_ROOTS || bytes > ROOTS_QUERY_BUDGET) break;
    kept.push(scope);
  }
  return kept;
}

/** The roots the administrator configured; none when the setting is absent. */
export function configuredRoots(config) {
  return parseRoots(themeSettings(config)[ROOTS_KEY]);
}

/** Identity of a set of roots, so a cache can tell when the configuration changed. */
export function rootsSignature(roots) {
  return (roots || []).map(scopeKey).join("\n");
}
