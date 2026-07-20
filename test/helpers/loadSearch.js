// SPDX-License-Identifier: Apache-2.0
// Config-injection loader for the per-theme search.js modules.
//
// search.js reads its runtime configuration from module state — every result /
// facet renderer starts with `const cfg = api.getConfig() || {}` and pulls
// `cfg.features` / `cfg.facet_views` from there. `getConfig()` is NOT a function
// argument, so a behavioural test cannot drive it by passing a value in; it has
// to make the module's `import * as api from "./api.js"` resolve to an api whose
// getConfig() returns the fixture config.
//
// fess-themes ships no test doubles, so this helper builds one on the fly: it
// mocks the theme's own api.js with vi.doMock (a non-hoisted mock that accepts a
// runtime specifier, unlike vi.mock), spreads the REAL api module so every other
// export keeps working, and overrides only getConfig(). vi.resetModules() before
// each load gives a fresh module graph, so search.js's module-level `state` and
// `attached` guard never leak between cases.
//
// The specifiers are relative to THIS file (test/helpers/), matching how
// search.js's sibling `./api.js` import resolves, so the mock intercepts it.
// Plain relative paths (no ?t= cache-buster) keep the resolved search.js path on
// the coverage include glob — the same instrumentation rule helpers/themes.js
// documents for format.js.

import { vi } from "vitest";

/**
 * Import a theme's own search.js with api.getConfig() stubbed to `config`.
 *
 * @param {string} theme  - theme directory name under themes/
 * @param {object} config - the object api.getConfig() should return
 * @returns {Promise<object>} the theme's search.js module exports
 */
export async function loadSearch(theme, config = {}) {
  vi.resetModules();
  const apiPath = `../../themes/${theme}/assets/api.js`;
  vi.doMock(apiPath, async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, getConfig: () => config };
  });
  const mod = await import(`../../themes/${theme}/assets/search.js`);
  vi.doUnmock(apiPath);
  return mod;
}

/**
 * Load a theme's search.js for a full runSearch()-driven behavioural test.
 *
 * The pure-function loader above stubs only getConfig(), which is all the
 * card/facet unit cases need. Driving runSearch() additionally requires the
 * network surface (api.get / api.post / api.isAuthenticated) and the SPA router
 * (router.navigate) to be controllable doubles: runSearch awaits api.get("/search")
 * and the option/chip/pagination click handlers call api.post / navigate. Those
 * are module-level `import * as api` / `import { navigate }` bindings, not function
 * arguments, so — exactly like getConfig — a test can only drive them by making the
 * module's own `./api.js` / `./router.js` imports resolve to doubles.
 *
 * Returns the module PLUS handles to the freshly-created mocks so a case can stage
 * canned responses (get.mockImplementation / mockRejectedValueOnce) and assert on
 * calls (navigate). Fresh vi.fn()s per call + vi.resetModules() keep search.js's
 * module-level `state`, `attached` guard and abort controllers from leaking between
 * cases. router.js is fully replaced (search.js only imports `navigate` from it, and
 * no other module in the graph imports it), so no real history mutation happens.
 *
 * @param {string} theme  - theme directory name under themes/
 * @param {object} config - the object api.getConfig() should return
 * @returns {Promise<{mod: object, get: Function, post: Function,
 *                     isAuthenticated: Function, navigate: Function}>}
 */
export async function loadSearchFlow(theme, config = {}) {
  vi.resetModules();
  const apiPath = `../../themes/${theme}/assets/api.js`;
  const routerPath = `../../themes/${theme}/assets/router.js`;
  const get = vi.fn(async () => ({}));
  const post = vi.fn(async () => ({}));
  const isAuthenticated = vi.fn(() => false);
  const navigate = vi.fn();
  vi.doMock(apiPath, async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, getConfig: () => config, get, post, isAuthenticated };
  });
  vi.doMock(routerPath, () => ({ navigate }));
  const mod = await import(`../../themes/${theme}/assets/search.js`);
  vi.doUnmock(apiPath);
  vi.doUnmock(routerPath);
  return { mod, get, post, isAuthenticated, navigate };
}
