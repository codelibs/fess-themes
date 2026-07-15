// SPDX-License-Identifier: Apache-2.0
// FAQ-specific pure helpers for the HelpDesk theme.
//
// DOM-free on purpose: scripts/test-helpdesk-helpers.mjs imports this under
// plain node (no browser, no jsdom). Keep DOM work in search.js/app.js.

/**
 * The inline FAQ answer, as an HTML string safe to assign to innerHTML.
 *
 * Returned VERBATIM. content_description is already innerHTML-safe: the v2 path
 * (SearchHandler -> SearchHelper -> DefaultSearcher:246 -> ViewHelper
 * .getContentDescription -> escapeHighlight) runs LaFunctions.h() over the whole
 * body and then restores only query.highlight.tag.pre/post, i.e. <strong>.
 *
 * Deliberately NOT routed through format.js renderHighlightedSnippet(): that
 * escapes again, so a server-sent &amp; becomes &amp;amp; and renders as a
 * literal "&amp;". The theme this was forked from has that exact bug at
 * assets/search.js:218; this theme shows far more of the field, so it would
 * be far more visible.
 *
 * There is no digest fallback: getContentDescription() iterates hl_content AND
 * digest and only returns "" when both are blank, so `|| hit.digest` is dead code.
 *
 * How much text arrives is SERVER config, not theme config — see the theme
 * README. The defaults yield a ~120-character teaser, and
 * query.highlight.boundary.position.detect=true additionally chops everything
 * before the first match's clause.
 *
 * @param {object|null} hit - one entry of the /api/v2/search `data` array
 * @returns {string} HTML string (safe for innerHTML), or "" when unavailable
 */
export function answerHtml(hit) {
  if (!hit) return "";
  return hit.content_description || "";
}

/**
 * Whether a cached copy of the source page exists.
 *
 * has_cache is the STRING "true" (Constants.TRUE), not a boolean: the field is
 * not declared in fess_indices/fess/doc.json and is dynamically mapped. A bare
 * `if (hit.has_cache)` is a latent bug — "false" is truthy.
 *
 * @param {object|null} hit
 * @returns {boolean}
 */
export function hasCache(hit) {
  if (!hit) return false;
  return hit.has_cache === "true" || hit.has_cache === true;
}

/**
 * Href for the full original page, or null when there is no cache.
 *
 * Forwards hq (the highlight terms), which is the ONLY query parameter
 * /api/v2/cache accepts (CacheHandler.java:155). queryId is a /thumbnail/ thing
 * and is ignored here — sending it instead of hq silently loses highlighting.
 *
 * A plain link to the existing /cache/ route rather than an inline iframe:
 * cache.js exposes only a route-bound attach() that reads docId from
 * location.search and hard-targets #cache-view. There is no per-docId render
 * seam, and the sandboxed-iframe security model is not worth reworking.
 *
 * @param {object|null} hit
 * @param {string|null} highlightParams - state.highlightParams, e.g. "&hq=a&hq=b"
 * @param {string} q - the raw query, used when highlightParams is absent
 * @returns {string|null}
 */
export function cacheHref(hit, highlightParams, q) {
  if (!hasCache(hit) || !hit.doc_id) return null;
  const hl = highlightParams || ("&hq=" + encodeURIComponent(q || ""));
  return "/cache/?docId=" + encodeURIComponent(hit.doc_id) + hl;
}

/**
 * Featured-answer ("best bet") HTML snippets from a search response.
 *
 * related_contents is admin-authored RAW HTML from /admin/relatedcontent/ and is
 * NOT escaped by core — callers MUST pass each entry through
 * format.js sanitizeHtml() before it reaches the live DOM.
 *
 * @param {object|null} env - the unwrapped /api/v2/search envelope
 * @returns {string[]}
 */
export function bestBets(env) {
  if (!env || !Array.isArray(env.related_contents)) return [];
  return env.related_contents.filter(s => typeof s === "string" && s.trim() !== "");
}
