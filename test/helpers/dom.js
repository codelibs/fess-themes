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
