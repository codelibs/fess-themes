// SPDX-License-Identifier: Apache-2.0
// Config-injection loaders for the per-theme shell modules (app.js / auth.js /
// profile.js).
//
// Same technique as loadSearch.js: both modules read their runtime configuration
// from `api.getConfig()` and reach the network through `import * as api from
// "./api.js"` — module-level bindings, not function arguments — so a behavioural
// test can only drive them by making that sibling import resolve to a double.
// vi.doMock (non-hoisted, accepts a runtime specifier) spreads the REAL api module
// and overrides only what a test needs to control; vi.resetModules() before each
// load gives a fresh module graph so module-level state never leaks between cases.
//
// The specifiers are relative to THIS file (test/helpers/), matching how the
// modules' own `./api.js` import resolves, so the mock intercepts it. Plain
// relative paths (no ?t= cache-buster) keep the resolved paths on the coverage
// include globs — see the note in helpers/themes.js.
//
// Not a *.test.js file, so Vitest does not collect it as a suite.

import { vi } from "vitest";
import { mountIndexBody } from "./themes.js";

/** Yield a macrotask so the modules' fire-and-forget async work settles. */
export const settle = () => new Promise((r) => setTimeout(r));

/**
 * Import a theme's own auth.js with the api surface stubbed.
 *
 * i18n.js is left REAL: it never fetched (init() is not called here), so its
 * message table is empty and t(key) returns the key itself — which makes the
 * message auth.js writes into #login-error deterministic and assertable.
 *
 * @param {string} theme  - theme directory name under themes/
 * @param {object} config - the object api.getConfig() should return
 * @returns {Promise<{mod: object, get: Function, post: Function}>}
 */
export async function loadAuth(theme, config = {}) {
  vi.resetModules();
  const apiPath = `../../themes/${theme}/assets/api.js`;
  // /auth/me answers HTTP 200 with {authenticated:false} for an anonymous visitor.
  const get = vi.fn(async () => ({ authenticated: false }));
  const post = vi.fn(async () => ({}));
  vi.doMock(apiPath, async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, getConfig: () => config, get, post, setCsrfToken: vi.fn() };
  });
  const mod = await import(`../../themes/${theme}/assets/auth.js`);
  vi.doUnmock(apiPath);
  return { mod, get, post };
}

/**
 * Import a theme's own profile.js with the api + router surfaces stubbed.
 *
 * Unlike the bootstrap reference copy in the `fess` repo, the ten shipped copies
 * keep `localizePasswordError()` module-private — `attach()` is profile.js's only
 * export. So the password-error mapping can only be observed the way a user meets
 * it: mount #profile-view, let attach() build the real form, submit it, and read
 * what lands in #profile-error. api.post drives the rejection; router.navigate is
 * replaced so the success path can never mutate history.
 *
 * i18n.js stays REAL (never init()'d), so t(key) returns the key itself and the
 * rendered message is an exact, assertable i18n key.
 *
 * @param {string} theme - theme directory name under themes/
 * @returns {Promise<{mod: object, post: Function, navigate: Function}>}
 */
export async function loadProfile(theme) {
  vi.resetModules();
  const apiPath = `../../themes/${theme}/assets/api.js`;
  const routerPath = `../../themes/${theme}/assets/router.js`;
  const post = vi.fn(async () => ({}));
  const navigate = vi.fn();
  vi.doMock(apiPath, async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, post };
  });
  vi.doMock(routerPath, () => ({ navigate }));
  const mod = await import(`../../themes/${theme}/assets/profile.js`);
  vi.doUnmock(apiPath);
  vi.doUnmock(routerPath);
  return { mod, post, navigate };
}

/**
 * Mount a theme's shipped index.html body and boot its app.js against it.
 *
 * app.js is the SPA entry: it runs main() at import time (document.readyState is
 * "complete" under jsdom, so the DOMContentLoaded branch is skipped), which is the
 * only way renderNotifications() — a module-private function — is ever reached.
 * Booting it for real is therefore the only way to observe what a visitor sees in
 * #home-notification / #results-notification, so the DOM must be in place first.
 *
 * api.init() is stubbed to a no-op and getConfig() returns `config`, standing in
 * for the /api/v2/ui/config payload. i18n.init() is stubbed too — the real one
 * fetches /themes/<name>/i18n/messages.<locale>.json, which would make the suite
 * depend on a network round trip failing fast. Everything else in both modules
 * (including t()) stays real.
 *
 * @param {string} theme  - theme directory name under themes/
 * @param {object} config - the object api.getConfig() should return
 * @returns {Promise<{mod: object, get: Function, post: Function}>}
 */
export async function bootApp(theme, config = {}) {
  vi.resetModules();
  const apiPath = `../../themes/${theme}/assets/api.js`;
  const i18nPath = `../../themes/${theme}/assets/i18n.js`;
  const get = vi.fn(async () => ({ authenticated: false }));
  const post = vi.fn(async () => ({}));
  vi.doMock(apiPath, async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      init: vi.fn(async () => {}),
      getConfig: () => config,
      get,
      post,
      isAuthenticated: () => false,
      setCsrfToken: vi.fn(),
    };
  });
  vi.doMock(i18nPath, async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, init: vi.fn(async () => {}) };
  });
  mountIndexBody(theme);
  const mod = await import(`../../themes/${theme}/assets/app.js`);
  vi.doUnmock(apiPath);
  vi.doUnmock(i18nPath);
  await settle();
  return { mod, get, post };
}
