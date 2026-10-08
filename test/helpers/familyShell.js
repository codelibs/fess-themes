// SPDX-License-Identifier: Apache-2.0
// The page-shell contract of the four themes forked from docuforge (docuforge, nomadkit, rawblock,
// voicebox), for a keyboard or screen-reader user. They share byte-identical app.js, search.js
// and index.html structure, so one set of cases runs against each theme's own files; the per-theme
// test files (docuforge.shell.test.js ...) call defineShellTests() once each, because compat.js is
// a classic script that installs document-level listeners and so needs a window of its own.
//
//   1. The search options drawer slides in from beyond the right edge. Closed, it must be out of
//      the tab order and the accessibility tree (visibility: hidden); open, its controls are
//      reachable. It closes on Escape, with the focus back on the control that opened it, and
//      opening it moves the focus in (the drawer sits ahead of <main>).
//   2. "/" focuses the search box, as the Help page says.
//   3. Every route names itself in document.title, not only the search route.
//   4. The header search button has an accessible name.
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

  describe(`${THEME}: the / shortcut`, () => {
    it("focuses the header search box where it is shown", async () => {
      await boot("/help");
      const ev = key("/");
      expect(ev.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe($("query"));
    });

    it("focuses the home search box, where the header box is hidden", async () => {
      await boot("/");
      const ev = key("/");
      expect(ev.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe($("contentQuery"));
    });

    it("does not take the key typed into a field", async () => {
      await boot("/help");
      $("query").focus();
      const ev = key("/", $("query"));
      expect(ev.defaultPrevented).toBe(false);
    });

    it("does not take a key with Ctrl, Meta or Alt", async () => {
      await boot("/help");
      const focused = document.activeElement; // the view root, where showView() put the focus
      for (const modifier of ["ctrlKey", "metaKey", "altKey"]) {
        const ev = key("/", document.body, { [modifier]: true });
        expect(ev.defaultPrevented).toBe(false);
      }
      expect(document.activeElement).toBe(focused);
      expect(document.activeElement).not.toBe($("query"));
    });

    it("takes it with Shift, which is how some keyboard layouts type a slash", async () => {
      await boot("/help");
      expect(key("/", document.body, { shiftKey: true }).defaultPrevented).toBe(true);
    });

    it("does not take the key of an IME conversion", async () => {
      await boot("/help");
      expect(key("/", document.body, { isComposing: true }).defaultPrevented).toBe(false);
    });

    it("leaves the key alone while the options drawer is open", async () => {
      await boot("/help");
      $("searchOptionsButton").click();
      expect(isOpen()).toBe(true);
      const ev = key("/", document.activeElement);
      expect(ev.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe($("searchOptions").querySelector(".container"));
    });

    it("leaves the key alone on a page with no search box", async () => {
      await boot("/search/advance");
      expect(key("/").defaultPrevented).toBe(false);
    });
  });

  describe(`${THEME}: the tab title names every page`, () => {
    it("is the site title on the home page", async () => {
      await boot("/");
      expect(document.title).toBe("Fess Search");
    });

    it("is the query on a search", async () => {
      await boot("/search?q=password+reset");
      expect(document.title).toBe("password reset - Fess");
    });

    it("changes from the search's to the Help page's when the visitor opens Help", async () => {
      await boot("/search?q=password+reset");
      await goTo("/help");
      expect(document.title).toBe("Help - Fess");
    });

    it("is the Help page's when the page is opened directly", async () => {
      await boot("/help");
      expect(document.title).toBe("Help - Fess");
    });

    it("changes to the advanced search page's", async () => {
      await boot("/search?q=password+reset");
      await goTo("/search/advance");
      expect(document.title).toBe("Advanced Search - Fess");
      await goTo("/advance");
      expect(document.title).toBe("Advanced Search - Fess");
    });

    it("changes to the password page's and the cache page's", async () => {
      await boot("/search?q=password+reset");
      await goTo("/profile");
      expect(document.title).toBe("Change Password - Fess");
      await goTo("/cache/?docId=d1");
      expect(document.title).toBe("Cached page - Fess");
    });

    it("changes to the chat page's, which the bundle gives as a whole title", async () => {
      await boot("/search?q=password+reset");
      await goTo("/chat");
      expect(document.title).toBe("Chat");
    });

    it("changes to the error the error page shows", async () => {
      await boot("/search?q=password+reset");
      await goTo("/error/404");
      expect($("error-view").querySelector(".error-title").textContent).toBe("Page Not Found.");
      expect(document.title).toBe("Page Not Found. - Fess");
    });

    it("is the error's when /error/notfound is opened directly", async () => {
      await boot("/error/notfound");
      const shown = $("error-view").querySelector(".error-title").textContent;
      expect(shown).not.toBe("");
      expect(document.title).toBe(shown + " - Fess");
    });

    it("changes to the error the unknown-address page shows", async () => {
      await boot("/search?q=password+reset");
      await goTo("/no/such/page");
      const shown = $("error-view").querySelector(".error-title").textContent;
      expect(shown).not.toBe("");
      expect(document.title).toBe(shown + " - Fess");
    });

    it("returns to the site title when the visitor goes home", async () => {
      await boot("/search?q=password+reset");
      await goTo("/");
      expect(document.title).toBe("Fess Search");
    });

    it("gives every route a different title", async () => {
      const titles = [];
      for (const url of ["/", "/search?q=paging", "/help", "/advance", "/error/notfound", "/profile"]) {
        await boot(url);
        titles.push(document.title);
        if (app) app.detach();
        vi.unstubAllGlobals();
        vi.resetModules();
      }
      expect(new Set(titles).size).toBe(titles.length);
    });
  });

  describe(`${THEME}: the header search button`, () => {
    it("has an accessible name, in the visitor's language", async () => {
      await boot("/help");
      const name = $("searchButton").querySelector(".visually-hidden");
      expect(name).not.toBeNull();
      expect(name.textContent).toBe("Search");
      expect($("searchButton").querySelector("i").getAttribute("aria-hidden")).toBe("true");
    });
  });
}
