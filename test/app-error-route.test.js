// SPDX-License-Identifier: Apache-2.0
// app.js and the server-injected error meta tag (JSP retirement, error-page parity):
// ErrorPageServlet now renders the active theme IN PLACE, at the URL that failed, with
// the real HTTP status and an x-fess-error-code meta tag — instead of redirecting to a
// bootstrap page with ?url=. router.dispatch() otherwise takes the first predicate that
// matches location.pathname, so a failing URL the SPA also routes itself (e.g. a 429 at
// "/" or "/search" from LoadControlFilter) used to reach the search UI instead of the
// error view, with the wrong status rendered and the meta tag ignored. The login gate had
// the mirror defect: a gated path (login.required on) showed the login prompt instead of
// the error page to an anonymous visitor.
//
// Each case boots a theme's real app.js, with its real auth.js, router.js and search.js,
// against its shipped index.html; api.js, router.redirect() and the Bootstrap modal are
// doubles — same technique as app-auth.test.js. detach() removes the listeners a boot
// added, so a theme booted earlier never answers the events a later case sends.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { themes } from "./helpers/themes.js";
import { resetDom, setLocation } from "./helpers/dom.js";
import { bootApp, settle } from "./helpers/loadShell.js";

/** api.get: /auth/me reports `user` (a guest when null); every other endpoint answers {}. */
const answerMe = (user) => async (path) =>
  path === "/auth/me" ? (user ? { authenticated: true, user } : { authenticated: false }) : {};
const searched = (get) => get.mock.calls.some((c) => c[0] === "/search");

const isHidden = (id) => document.getElementById(id).hasAttribute("hidden");

let app;
let show;

beforeEach(() => {
  resetDom();
  document.head.innerHTML = "";
  window.scrollTo = () => {};
  show = vi.fn();
  vi.stubGlobal("bootstrap", { Modal: { getOrCreateInstance: vi.fn(() => ({ show, hide: vi.fn() })) } });
});
afterEach(() => {
  if (app) app.detach();
  app = undefined;
  vi.unstubAllGlobals();
  vi.resetModules();
  document.head.innerHTML = "";
  setLocation("/");
});

describe.each(themes)("%s: app.js error-meta route", (theme) => {
  async function boot(config, user) {
    app = await bootApp(theme, { features: {}, notifications: {}, ...config }, { get: answerMe(user) });
    return app;
  }

  it("shows the error view instead of the routed view at a path the SPA routes", async () => {
    document.head.innerHTML = '<meta name="x-fess-error-code" content="429">';
    setLocation("/search?q=foo");
    const { get } = await boot({}, null);

    // The error-meta route must win over the /search route registered after it: the
    // search route's handler (which would call search.runFromUrl -> api.get("/search"))
    // never runs.
    expect(searched(get)).toBe(false);
    expect(isHidden("error-view")).toBe(false);
    expect(isHidden("results-view")).toBe(true);
    // The rendered code comes from the meta tag ("429"), not from path inference
    // (codeFromPath("/search") would default to "500") — pins that the meta-driven
    // branch, not some other fallback route, produced this render.
    expect(document.querySelector("#error-view .error-title").textContent).toBe("error.title_429");
  });

  it("routes normally again on a later client-side navigation to the same URL", async () => {
    document.head.innerHTML = '<meta name="x-fess-error-code" content="429">';
    setLocation("/search?q=foo");
    const { get } = await boot({}, null);
    expect(isHidden("error-view")).toBe(false);

    // The meta element is never removed (error.js still reads it) — a later dispatch
    // (e.g. browser back/forward) must consume the latch and route "/search" normally
    // instead of showing the error view forever.
    get.mockClear();
    window.dispatchEvent(new PopStateEvent("popstate"));
    await settle();

    expect(searched(get)).toBe(true);
    expect(isHidden("results-view")).toBe(false);
    expect(isHidden("error-view")).toBe(true);
  });

  it("shows the error view instead of the login prompt on a login-gated path", async () => {
    document.head.innerHTML = '<meta name="x-fess-error-code" content="429">';
    setLocation("/search?q=foo");
    const { get } = await boot({ login_required: true }, null);

    // An anonymous visitor on a gated path (login.required, no session) must still see
    // the error page — a login prompt can never be satisfied by the failing request.
    expect(show).not.toHaveBeenCalled();
    expect(searched(get)).toBe(false);
    expect(isHidden("error-view")).toBe(false);
    expect(isHidden("results-view")).toBe(true);
  });
});
