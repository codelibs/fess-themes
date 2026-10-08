// SPDX-License-Identifier: Apache-2.0
// The page shell of the themes with a hero home page (mosaic, storefront, semanticlens), for a
// keyboard or screen-reader user. They share a byte-identical app.js and the same index.html
// structure, so one set of cases runs against each theme's own files; the per-theme test files
// (mosaic.shell.test.js ...) call defineShellTests() once each, because compat.js is a classic
// script that installs document-level listeners and so needs a window of its own.
//
//   1. The search options drawer slides in from beyond the right edge. Closed, it must be out of
//      the tab order and the accessibility tree (visibility: hidden); open, its controls are
//      reachable. It closes on Escape, with the focus back on the control that opened it, and
//      opening it moves the focus in (the drawer sits ahead of <main>).
//
// The theme's real index.html, styles.css, compat.js (the Collapse behind the drawer toggles),
// app.js, router.js, search.js and i18n.js (loading the real English bundle) run together; api.js
// is a double. jsdom has no layout, so the drawer is checked by the computed `visibility` the
// stylesheet gives it, not by pixels.
//
// Not a *.test.js file, so Vitest does not collect it as a suite.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { modulePath } from "./themes.js";
import { resetDom, setLocation } from "./dom.js";
import { bootApp, settle } from "./loadShell.js";
import { SAMPLE_DOCS, makeSearchEnv } from "./searchFlow.js";

export function defineShellTests(THEME) {
  const $ = (id) => document.getElementById(id);

  const ENGLISH = JSON.parse(readFileSync(
    join(dirname(dirname(modulePath(THEME, "app.js"))), "i18n", "messages.en.json"), "utf8"));

  /** fetch for the real i18n.js and help.js: the English bundle, an empty help page. */
  const fetchBundles = async (url) => {
    const u = String(url);
    if (u.includes("/i18n/")) return { ok: true, json: async () => ENGLISH };
    if (u.includes("/help/")) return { ok: true, json: async () => ({ sections: [] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const CFG = {
    features: {},
    notifications: {},
    label_options: [{ value: "lblA", name: "Label A" }],
  };

  /** api.get: a guest, a search that finds two documents, nothing else. */
  const answer = async (path) => {
    if (path === "/auth/me") return { authenticated: false };
    if (path === "/search") return makeSearchEnv(SAMPLE_DOCS);
    return {};
  };

  let app;

  beforeAll(() => {
    // compat.js is a classic script that defines window.bootstrap and the click listener of the
    // declarative toggles; run it once in this window.
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    // The hero canvas of the home page needs a 2d context, which jsdom does not provide (it logs
    // "not implemented" instead); the hero treats a missing context as "nothing to draw".
    HTMLCanvasElement.prototype.getContext = () => null;
    (0, eval)(readFileSync(modulePath(THEME, "compat.js"), "utf8"));
    // jsdom has no Element.checkVisibility(), which app.js isRendered() asks the browser: say an
    // element is shown unless it or an ancestor is display:none, or it is visibility:hidden.
    Element.prototype.checkVisibility = function () {
      if (getComputedStyle(this).visibility === "hidden") return false;
      for (let n = this; n; n = n.parentElement) {
        if (getComputedStyle(n).display === "none" || n.hasAttribute("hidden")) return false;
      }
      return true;
    };
  });

  async function boot(url) {
    resetDom();
    document.head.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = readFileSync(modulePath(THEME, "styles.css"), "utf8");
    document.head.appendChild(style);
    window.scrollTo = () => {};
    sessionStorage.clear();
    vi.stubGlobal("fetch", fetchBundles);
    setLocation(url);
    app = await bootApp(THEME, CFG, { get: answer, realI18n: true });
    await settle();
    return app;
  }

  /** Client-side navigation, as a click on an in-app link does it. */
  async function goTo(path) {
    history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
    await settle();
  }

  afterEach(() => {
    if (app) app.detach();
    app = undefined;
    vi.unstubAllGlobals();
    vi.resetModules();
    setLocation("/");
  });

  const visibility = (el) => window.getComputedStyle(el).visibility;
  const isOpen = () => $("searchOptions").classList.contains("show");
  const key = (name, target = document.body, init = {}) => {
    const ev = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(ev);
    return ev;
  };

  describe(`${THEME}: the closed options drawer is out of the tab order`, () => {
    beforeEach(() => boot("/help"));

    it("hides the closed drawer and every control in it", () => {
      expect(isOpen()).toBe(false);
      const panel = $("searchOptions").querySelector(".container");
      expect(visibility(panel)).toBe("hidden");
      for (const id of ["numSearchOption", "sortSearchOption", "langSearchOption", "labelSearchOption",
        "geo-lat", "searchOptionsClearButton", "searchOptionsAdvanceLink"]) {
        expect(visibility($(id))).toBe("hidden");
      }
    });

    it("shows the drawer while it is open and hides it again once closed", () => {
      const panel = $("searchOptions").querySelector(".container");
      $("searchOptionsButton").click();
      expect(isOpen()).toBe(true);
      expect(visibility(panel)).toBe("visible");
      expect(visibility($("numSearchOption"))).toBe("visible");
      $("searchOptionsButton").click();
      expect(isOpen()).toBe(false);
      expect(visibility(panel)).toBe("hidden");
    });

    it("leaves the header search box and its buttons reachable", () => {
      for (const id of ["query", "searchButton", "searchOptionsButton"]) {
        expect(visibility($(id))).toBe("visible");
      }
    });
  });

  describe(`${THEME}: closing the options drawer`, () => {
    beforeEach(() => boot("/help"));

    it("moves the focus into the drawer when a toggle opens it", () => {
      $("searchOptionsButton").focus();
      $("searchOptionsButton").click();
      expect(document.activeElement).toBe($("searchOptions").querySelector(".container"));
    });

    it("closes on Escape and puts the focus back on the control that opened it", () => {
      $("searchOptionsButton").focus();
      $("searchOptionsButton").click();
      expect(isOpen()).toBe(true);
      key("Escape", $("numSearchOption"));
      expect(isOpen()).toBe(false);
      expect($("searchOptionsButton").getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe($("searchOptionsButton"));
    });

    it("returns the focus to an options-bar link that opened it", () => {
      const link = document.createElement("a");
      link.href = "#searchOptions";
      link.setAttribute("data-bs-toggle", "collapse");
      $("options-bar").appendChild(link);
      link.focus();
      link.click();
      expect(isOpen()).toBe(true);
      key("Escape");
      expect(isOpen()).toBe(false);
      expect(document.activeElement).toBe(link);
    });

    it("leaves Escape alone while the drawer is closed", () => {
      const other = $("brand-link");
      other.focus();
      const ev = key("Escape");
      expect(ev.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(other);
    });
  });

}
