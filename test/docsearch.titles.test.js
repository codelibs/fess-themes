// SPDX-License-Identifier: Apache-2.0
// docsearch: the tab title names every page (WCAG 2.4.2). The search route sets its own title
// (the query); the other routes used to leave whatever the page loaded with, so Help, Advanced
// Search and an error page were all "Fess Search", and moving from a search to Help kept the
// search's title.
//
// The theme's real index.html, compat.js, app.js, router.js, search.js and i18n.js (loading the real
// English bundle) run together; api.js is a double.

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { modulePath } from "./helpers/themes.js";
import { resetDom, setLocation } from "./helpers/dom.js";
import { bootApp, settle } from "./helpers/loadShell.js";
import { SAMPLE_DOCS, makeSearchEnv } from "./helpers/searchFlow.js";

const THEME = "docsearch";

const ENGLISH = JSON.parse(readFileSync(
  join(dirname(dirname(modulePath(THEME, "app.js"))), "i18n", "messages.en.json"), "utf8"));

/** fetch for the real i18n.js and help.js: the English bundle, an empty help page. */
const fetchBundles = async (url) => {
  const u = String(url);
  if (u.includes("/i18n/")) return { ok: true, json: async () => ENGLISH };
  if (u.includes("/help/")) return { ok: true, json: async () => ({ sections: [] }) };
  return { ok: false, status: 404, json: async () => ({}) };
};

/** api.get: a guest, a search that finds two documents, nothing else. */
const answer = async (path) => {
  if (path === "/auth/me") return { authenticated: false };
  if (path === "/search") return makeSearchEnv(SAMPLE_DOCS);
  return {};
};

let app;

beforeAll(() => {
  // compat.js is a classic script that defines window.bootstrap; run it once in this window.
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  (0, eval)(readFileSync(modulePath(THEME, "compat.js"), "utf8"));
});

async function boot(url) {
  resetDom();
  document.head.innerHTML = "";
  window.scrollTo = () => {};
  sessionStorage.clear();
  localStorage.clear();
  vi.stubGlobal("fetch", fetchBundles);
  setLocation(url);
  app = await bootApp(THEME, { features: {}, notifications: {} }, { get: answer, realI18n: true });
  await settle();
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

describe("docsearch: the tab title names every page", () => {
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
    expect(document.querySelector("#error-view .error-title").textContent).toBe("Page Not Found.");
    expect(document.title).toBe("Page Not Found. - Fess");
  });

  it("is the error's when /error/notfound is opened directly", async () => {
    await boot("/error/notfound");
    const shown = document.querySelector("#error-view .error-title").textContent;
    expect(shown).not.toBe("");
    expect(document.title).toBe(shown + " - Fess");
  });

  it("changes to the error the unknown-address page shows", async () => {
    await boot("/search?q=password+reset");
    await goTo("/no/such/page");
    const shown = document.querySelector("#error-view .error-title").textContent;
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
      app = undefined;
      vi.unstubAllGlobals();
      vi.resetModules();
    }
    expect(new Set(titles).size).toBe(titles.length);
  });
});
