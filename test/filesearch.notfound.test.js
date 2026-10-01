// SPDX-License-Identifier: Apache-2.0
// filesearch: an address the SPA does not route shows the not-found page. error.js infers the
// code from the path and answers 500 ("System Error") for a path it does not know, so app.js
// hands it the 404 for the catch-all route. The theme's real index.html and app.js run with
// api and i18n as doubles (t(key) returns the key, so the title is an exact i18n key).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDom, setLocation } from "./helpers/dom.js";
import { bootApp, settle } from "./helpers/loadShell.js";

const THEME = "filesearch";
const META = 'meta[name="x-fess-error-code"]';

let app;

beforeEach(() => {
  resetDom();
  document.head.innerHTML = "";
  window.scrollTo = () => {};
  vi.stubGlobal("bootstrap", { Modal: { getOrCreateInstance: vi.fn(() => ({ show: vi.fn(), hide: vi.fn() })) } });
});
afterEach(() => {
  if (app) app.detach();
  app = undefined;
  vi.unstubAllGlobals();
  vi.resetModules();
  document.head.innerHTML = "";
  setLocation("/");
});

async function boot(path) {
  setLocation(path);
  app = await bootApp(THEME, { features: {}, notifications: {} }, { get: async () => ({}) });
  return app;
}

const title = () => document.querySelector("#error-view .error-title").textContent;
const isHidden = id => document.getElementById(id).hasAttribute("hidden");

describe("filesearch: unknown address", () => {
  it("shows the not-found page, with the address, instead of a system error", async () => {
    await boot("/search/no-such-page");
    expect(isHidden("error-view")).toBe(false);
    expect(title()).toBe("error.title_404");
    expect(document.querySelector("#error-view .error-body").textContent).toBe("error.body_404");
    expect(document.querySelector("#error-view .error-detail dd").textContent).toBe("/search/no-such-page");
  });

  it("is 404 even when a segment of the address looks like another error (/busy would be 429)", async () => {
    await boot("/docs/busy");
    expect(title()).toBe("error.title_404");
  });

  it("leaves no error meta tag behind, so a later navigation routes normally", async () => {
    await boot("/search/no-such-page");
    expect(document.querySelector(META)).toBeNull();
    setLocation("/help");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await settle();
    expect(isHidden("error-view")).toBe(true);
    expect(isHidden("help-view")).toBe(false);
  });

  it("is not used for the /error routes, which still name their own code", async () => {
    await boot("/error/system");
    expect(title()).toBe("error.title_500");
    app.detach();
    await boot("/error/404");
    expect(title()).toBe("error.title_404");
  });

  it("does not override the code the server put in the page", async () => {
    document.head.innerHTML = '<meta name="x-fess-error-code" content="429">';
    await boot("/search/no-such-page");
    expect(title()).toBe("error.title_429");
    expect(document.querySelector(META).getAttribute("content")).toBe("429");
  });
});
