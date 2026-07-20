// SPDX-License-Identifier: Apache-2.0
// Minimal jsdom helpers shared by the fess-themes JS tests.
//
// Not a *.test.js file, so Vitest does not collect it as a suite.

/**
 * Serialise a DocumentFragment (what sanitizeHtml returns) into an HTML string
 * by appending it to a detached <div> — exactly how the theme's chat/search
 * callers append the sanitized fragment into the live DOM. Asserting on the
 * serialised markup is how a test observes what the user would actually see.
 *
 * @param {DocumentFragment|Node} fragment
 * @returns {string} the resulting innerHTML
 */
export function serializeFragment(fragment) {
  const host = document.createElement("div");
  host.appendChild(fragment);
  return host.innerHTML;
}

/**
 * Append a fragment to a detached container element and return the container,
 * so a test can query it (querySelector) rather than string-match the markup.
 *
 * @param {DocumentFragment|Node} fragment
 * @returns {HTMLElement} the detached container
 */
export function mountFragment(fragment) {
  const host = document.createElement("div");
  host.appendChild(fragment);
  return host;
}

/**
 * Replace document.body's markup with `html` and return the live body, so a
 * runSearch-driven test can build the container scaffold the render machinery
 * reaches for (#results, #facet-body, #pagination, …) and then assert on what it
 * rendered into the live document. Mirrors the bootstrap reference harness.
 *
 * @param {string} html
 * @returns {HTMLElement} document.body
 */
export function mountBody(html) {
  document.body.innerHTML = html;
  return document.body;
}

/**
 * Reset the shared jsdom document between cases: empty <body>, drop the title.
 * The asset modules mutate document.title and the body, so a clean slate keeps
 * cases order-independent.
 */
export function resetDom() {
  document.body.innerHTML = "";
  document.title = "";
}

/**
 * Point window.location at `url` without a real navigation (jsdom history API),
 * so runFromUrl()/attach() see the query string a test wants to exercise.
 *
 * @param {string} url - a path+query such as "/search?q=foo"
 */
export function setLocation(url) {
  window.history.replaceState(null, "", url);
}
