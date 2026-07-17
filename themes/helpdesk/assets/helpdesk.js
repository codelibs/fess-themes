// SPDX-License-Identifier: Apache-2.0
// FAQ-specific pure helpers for the HelpDesk theme.
//
// DOM-free on purpose, so these helpers can be imported and unit-tested under
// plain node (no browser, no jsdom). Keep DOM work in search.js/app.js.

/**
 * The inline FAQ answer, as an HTML string safe to assign to innerHTML.
 *
 * Returned VERBATIM. content_description is already innerHTML-safe: the v2 path
 * (SearchHandler -> SearchHelper -> DefaultSearcher:246 -> ViewHelper
 * .getContentDescription -> escapeHighlight) runs LaFunctions.h() over the whole
 * body and then restores only query.highlight.tag.pre/post, i.e. <strong>.
 *
 * Not routed through format.js renderHighlightedSnippet(): that helper parses
 * with a <template>, and this module is DOM-free by contract (see the file
 * header), so it cannot call it. It also used to escape a second time — a
 * server-sent &amp; came back as &amp;amp; and rendered as a literal "&amp;" —
 * which is the original reason this returns verbatim. That double-escape is
 * fixed now, so search.js may wrap this value in renderHighlightedSnippet() at
 * the innerHTML boundary if client-side sanitizing is ever wanted here.
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
 * The result-card title, as an HTML string safe to assign to innerHTML.
 *
 * Returned VERBATIM, symmetric with answerHtml() above. content_title is
 * innerHTML-safe for exactly the same reason content_description is: the v2
 * path (SearchHandler -> SearchHelper -> DefaultSearcher:245 -> ViewHelper
 * .getContentTitle -> escapeHighlight) runs the identical LaFunctions.h() +
 * <strong>-splice logic that DefaultSearcher:246 runs for the description.
 *
 * Not routed through format.js renderHighlightedSnippet() for the same reason
 * as answerHtml(): this module is DOM-free and that helper needs a <template>.
 * The double-escape it used to cause — a server-sent &#039; (or &amp;/&#034;)
 * doubled into a literal entity in the H3 heading — is fixed. That mattered
 * most here: in a FAQ theme the title IS the question, so apostrophes
 * ("What's", "Don't") made it the common case rather than an edge case.
 *
 * @param {object|null} hit - one entry of the /api/v2/search `data` array
 * @returns {string} HTML string (safe for innerHTML), or "" when unavailable
 */
export function titleHtml(hit) {
  if (!hit) return "";
  return hit.content_title || "";
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
 * Plain-text title for a result document, for use in aria-label and other
 * text-only contexts. Strips server-injected highlight markup (<strong>/<em>)
 * from content_title, then decodes the closed set of HTML entities
 * LaFunctions.escape() emits (&amp; &lt; &gt; &#034; &#039;) so the accessible
 * name matches the visible title instead of reading raw entities to a
 * screen-reader user.
 *
 * Decoding happens ONLY on the content_title branch. The d.title / d.url
 * fallback (used when content_title is absent) are raw, unescaped indexed
 * fields the server does NOT escape, so they must never be decoded — and,
 * for the same reason, this does a targeted string replace rather than the
 * usual `div.innerHTML = raw; div.textContent` idiom: that idiom cannot tell
 * an escaped content_title apart from a raw title/url fallback, so it would
 * parse attacker-influenced markup on the fallback path.
 *
 * @param {object|null} d - result document object
 * @returns {string}
 */
export function plainTitle(d) {
  if (!d) return "";
  const fromContentTitle = !!d.content_title;
  const raw = d.content_title || d.title || d.url || "";
  const stripped = String(raw).replace(/<\/?(?:strong|em)>/g, "");
  if (!fromContentTitle) return stripped;
  // Decode &amp; LAST: decoding it first would turn a literal "&amp;#039;"
  // (an escaped ampersand followed by the literal text "#039;") into "'",
  // silently corrupting the source text.
  return stripped
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#034;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&");
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
