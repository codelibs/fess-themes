// SPDX-License-Identifier: Apache-2.0
// Folder scope for the file-search UI: the folder (or source host) the result list is
// narrowed to, and how that scope travels as an ex_q clause in the address bar.
//
// A scope is either
//   { type: "host", host }    a whole source, matched on the keyword field `host`
//   { type: "url", prefix }   a folder subtree, matched as a prefix of the keyword field `url`
//
// The clause is carried as one `ex_q` value, so reload, back/forward and a shared link
// land on the same folder (search.js syncUrlParams / runFromUrl round-trip any ex_q).
// Pure module: no DOM, no network.

/** Characters that mean something to the Fess query parser; a backslash makes them literal. */
const SPECIAL = /[\\+\-!():^[\]"{}~*?|&/\s]/g;
const IS_SPECIAL = /[\\+\-!():^[\]"{}~*?|&/\s]/;

/** Escape `value` so the query parser reads it as one literal term. */
export function escapeTerm(value) {
  return String(value == null ? "" : value).replace(SPECIAL, "\\$&");
}

/** Inverse of {@link escapeTerm}. */
export function unescapeTerm(value) {
  return String(value == null ? "" : value).replace(/\\([\s\S])/g, "$1");
}

/**
 * True when every special character in `text` is backslash-escaped, i.e. the text is a
 * single literal term as {@link escapeTerm} writes it.
 */
function isEscapedTerm(text) {
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") { i++; continue; }
    if (IS_SPECIAL.test(c)) return false;
  }
  return true;
}

/** The ex_q clause for a scope; "" when there is no (usable) scope. */
export function scopeClause(scope) {
  if (!scope) return "";
  if (scope.type === "host") return scope.host ? "host:" + escapeTerm(scope.host) : "";
  if (scope.type === "url") return scope.prefix ? "url:" + escapeTerm(scope.prefix) + "*" : "";
  return "";
}

/** The scope an ex_q clause names, or null when the clause is some other filter. */
export function parseScopeClause(clause) {
  if (typeof clause !== "string") return null;
  if (clause.startsWith("url:")) {
    const rest = clause.slice(4);
    if (!rest.endsWith("*")) return null;
    const body = rest.slice(0, -1);
    // The final * is a wildcard only if no backslash escapes it (an even run of them).
    const trailing = body.length - body.replace(/\\+$/, "").length;
    if (trailing % 2 === 1) return null;
    if (!body || !isEscapedTerm(body)) return null;
    return { type: "url", prefix: unescapeTerm(body) };
  }
  if (clause.startsWith("host:")) {
    const body = clause.slice(5);
    if (!body || !isEscapedTerm(body)) return null;
    return { type: "host", host: unescapeTerm(body) };
  }
  return null;
}

/** A stable identity for a scope ("" for none): tree node ids and equality use it. */
export function scopeKey(scope) {
  if (!scope) return "";
  if (scope.type === "host") return "host:" + scope.host;
  if (scope.type === "url") return "url:" + scope.prefix;
  return "";
}

export function sameScope(a, b) {
  return scopeKey(a) === scopeKey(b);
}

// ─── Browsing without a keyword ──────────────────────────────────────────────────
// The tree and the home view must list the sources before the user has typed anything,
// and Fess answers a request with no condition at all as "nothing to search". This is
// the one place that decides which request means "every indexed document". It is
// isolated so the answer can change without touching a caller; the clause below is the
// current candidate and its behaviour against a live server is an open question
// (README "Known limits").

/** The ex_q clause that matches every document carrying a url. */
export const BROWSE_ALL_CLAUSE = "url:*";

/** Request parameters that match every indexed document. */
export function browseAllQuery() {
  return { q: "", ex_q: [BROWSE_ALL_CLAUSE] };
}

/** True when a /search parameter set carries any condition Fess would search on. */
export function hasCondition(params) {
  if (!params) return false;
  if (typeof params.q === "string" && params.q.trim() !== "") return true;
  const exQ = params.ex_q;
  if (Array.isArray(exQ) ? exQ.some(Boolean) : !!exQ) return true;
  return Object.keys(params).some(key =>
    (key.startsWith("fields.") || key.startsWith("as.")) && [].concat(params[key]).some(Boolean));
}

/**
 * `params`, plus the match-all clause when it would otherwise carry no condition. Returns
 * the same object when it already has one; never mutates its argument.
 */
export function withBrowseAll(params) {
  if (hasCondition(params)) return params;
  return { ...params, ex_q: [...browseAllQuery().ex_q] };
}
