// SPDX-License-Identifier: Apache-2.0
// Result-page cases shared by the themes whose search.js keeps the bootstrap runSearch() contract
// (the #results list, #results-status, #pagination, .favorite-btn), so that one set of cases runs
// against each theme's own copy. A test file calls the define*() functions it needs inside the
// describe it wants; they only register cases.
//
//   defineExecTimeTests  the "(0.06 seconds)" suffix of the status line reads `exec_time`, which the
//                        v2 API sends as a decimal STRING ("0.06"), not a number.
//   defineTitleTests     the document title carries the query literally: String.prototype.replace()
//                        treats `$&` and `$$` in a replacement string as patterns, so "a$&b" used to
//                        come out as "a{0}b - Fess".
//   definePagerTests     the pager links are the URLs of their pages (not "#"), the current page is
//                        marked aria-current="page", every number has an accessible page name, and a
//                        disabled end is not a link. A plain click still pages in place; a modified
//                        one (new tab, new window) is the browser's.
//   defineFavoriteTests  the favorite star never promises what the API cannot do. /api/v2 can add a
//                        favorite (POST .../favorite) but not remove one, so a favorited star is named
//                        "Added to favorites", is aria-disabled and sends nothing on a click, rather
//                        than offering "Remove from favorites".
//
// The theme's real English bundle is loaded (through the real i18n.js init), so the assertions see
// the text a user sees rather than raw i18n keys.
//
// Not a *.test.js file, so Vitest does not collect it as a suite.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadSearchFlow } from "./loadSearch.js";
import { modulePath } from "./themes.js";
import { resetDom, mountBody, setLocation } from "./dom.js";
import { SEARCH_FIXTURE, FULL_CFG, SAMPLE_DOCS, makeSearchEnv, installDispatch, settle } from "./searchFlow.js";

const english = (theme) => JSON.parse(readFileSync(
  join(dirname(dirname(modulePath(theme, "app.js"))), "i18n", "messages.en.json"), "utf8"));

/**
 * Load the theme's search.js with its real i18n.js primed with the English bundle. The i18n module
 * imported here is the instance search.js resolved (same module registry), so initialising it is
 * what makes search.js's t() return English.
 */
export async function loadEnglishFlow(theme, cfg = FULL_CFG) {
  const flow = await loadSearchFlow(theme, cfg);
  const i18n = await import(`../../themes/${theme}/assets/i18n.js`);
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => english(theme) }));
  try {
    await i18n.init("en");
  } finally {
    vi.unstubAllGlobals();
  }
  return flow;
}

function resetEach() {
  beforeEach(() => {
    resetDom();
    window.scrollTo = () => {};
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setLocation("/");
  });
}

export function defineExecTimeTests(theme) {
  describe(`${theme}: the exec time in the results status`, () => {
    resetEach();

    // query_time is deliberately far from every exec_time below, so a suffix that came from the
    // wrong field cannot pass.
    async function statusFor(envExtra) {
      const flow = await loadEnglishFlow(theme);
      installDispatch(flow.get, { search: makeSearchEnv(SAMPLE_DOCS, { query_time: 1000, ...envExtra }) });
      mountBody(SEARCH_FIXTURE);
      flow.mod._state.q = "coffee";
      await flow.mod.runSearch();
      await settle();
      return document.getElementById("results-status").textContent;
    }

    it("reads exec_time sent as a decimal string, as the v2 API sends it", async () => {
      expect(await statusFor({ exec_time: "0.06" })).toContain("(0.06 seconds)");
    });

    it("keeps the two-decimal format for a string with fewer or more digits", async () => {
      expect(await statusFor({ exec_time: "0.1" })).toContain("(0.10 seconds)");
      expect(await statusFor({ exec_time: "0.12345" })).toContain("(0.12 seconds)");
    });

    it("still reads exec_time sent as a number", async () => {
      expect(await statusFor({ exec_time: 0.05 })).toContain("(0.05 seconds)");
    });

    it("falls back to query_time when exec_time is not a number", async () => {
      expect(await statusFor({ exec_time: "soon" })).toContain("(1.00 seconds)");
      expect(await statusFor({ exec_time: "" })).toContain("(1.00 seconds)");
    });

    it("shows no time when neither field is usable", async () => {
      expect(await statusFor({ exec_time: "soon", query_time: undefined })).not.toContain("seconds");
    });

    it("shows no time when exec_time is absent", async () => {
      expect(await statusFor({ exec_time: undefined, query_time: undefined })).not.toContain("seconds");
    });
  });
}

export function defineTitleTests(theme) {
  describe(`${theme}: the document title of a search`, () => {
    resetEach();

    async function titleFor(q) {
      const flow = await loadEnglishFlow(theme);
      installDispatch(flow.get, { search: makeSearchEnv(SAMPLE_DOCS) });
      mountBody(SEARCH_FIXTURE);
      flow.mod._state.q = q;
      await flow.mod.runSearch();
      await settle();
      return document.title;
    }

    it("is the query followed by the site name", async () => {
      expect(await titleFor("coffee")).toBe("coffee - Fess");
    });

    // Each of these is a special replacement pattern for String.prototype.replace().
    it.each([
      ["$&", "a$&b"],
      ["$$", "x$$y"],
      ["$`", "c$`d"],
      ["$'", "e$'f"],
      ["$1", "g$1h"],
      ["a placeholder", "{0} and {1}"],
    ])("inserts a query containing %s literally", async (_name, q) => {
      expect(await titleFor(q)).toBe(q + " - Fess");
    });
  });
}

export function definePagerTests(theme) {
  describe(`${theme}: the pager`, () => {
    resetEach();

    // Page 2 of 3, ten per page: there is a page before and a page after.
    const env = (extra = {}) => makeSearchEnv(SAMPLE_DOCS, {
      page_number: 2, page_numbers: ["1", "2", "3"], prev_page: true, next_page: true, ...extra,
    });
    const $ = (id) => document.getElementById(id);
    const searchParams = (get) => get.mock.calls.filter((c) => c[0] === "/search").map((c) => c[1]);

    async function onPage2(extra) {
      setLocation("/search?q=foo&num=10&start=10");
      const flow = await loadEnglishFlow(theme);
      installDispatch(flow.get, { search: env(extra) });
      mountBody(SEARCH_FIXTURE);
      flow.mod.runFromUrl();
      await settle();
      return flow;
    }

    const links = () => [...$("pagination").querySelectorAll("a.page-link")];
    const numbered = () => links().filter((a) => /^\d+$/.test(a.textContent));
    // Whether the page's own handler took the click (preventDefault) or left it to the browser.
    // The listener on document runs after it and then cancels the click itself: jsdom cannot
    // navigate, and says so on the console.
    const click = (a, init = {}) => {
      const outcome = {};
      const spy = (ev) => { outcome.defaultPrevented = ev.defaultPrevented; ev.preventDefault(); };
      document.addEventListener("click", spy);
      a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }));
      document.removeEventListener("click", spy);
      return outcome;
    };

    it("links each page number to the URL of that page, not to #", async () => {
      await onPage2();
      expect(numbered().map((a) => a.getAttribute("href"))).toEqual([
        "/search?q=foo&num=10",
        "/search?q=foo&num=10&start=10",
        "/search?q=foo&num=10&start=20",
      ]);
    });

    it("links previous and next to the pages before and after", async () => {
      await onPage2();
      const [prev, , , , next] = links();
      expect(prev.getAttribute("href")).toBe("/search?q=foo&num=10");
      expect(next.getAttribute("href")).toBe("/search?q=foo&num=10&start=20");
    });

    it("marks the current page, and only it, with aria-current", async () => {
      await onPage2();
      const current = links().filter((a) => a.getAttribute("aria-current") === "page");
      expect(current.map((a) => a.textContent)).toEqual(["2"]);
      expect(current[0].closest("li").classList.contains("active")).toBe(true);
    });

    it("gives every page number an accessible page name", async () => {
      await onPage2();
      expect(numbered().map((a) => a.getAttribute("aria-label"))).toEqual(["Page 1", "Page 2", "Page 3"]);
    });

    it("opens a page in place on a plain click", async () => {
      const flow = await onPage2();
      const ev = click(numbered()[2]);
      await settle();
      expect(ev.defaultPrevented).toBe(true);
      expect(searchParams(flow.get).at(-1).start).toBe(20);
      expect(new URLSearchParams(location.search).get("start")).toBe("20");
    });

    it("leaves a click with Ctrl, Meta or Shift to the browser", async () => {
      const flow = await onPage2();
      const searches = searchParams(flow.get).length;
      for (const modifier of ["ctrlKey", "metaKey", "shiftKey"]) {
        expect(click(numbered()[2], { [modifier]: true }).defaultPrevented).toBe(false);
      }
      await settle();
      expect(searchParams(flow.get).length).toBe(searches);
    });

    it("does not make a link of a disabled end", async () => {
      await onPage2({ page_number: 1, prev_page: false });
      const [prev] = links();
      expect(prev.hasAttribute("href")).toBe(false);
      expect(prev.getAttribute("aria-disabled")).toBe("true");
      expect(prev.closest("li").classList.contains("disabled")).toBe(true);
      // the other end still is one
      expect(links().at(-1).getAttribute("href")).toContain("start=");
    });
  });
}

export function defineFavoriteTests(theme) {
  describe(`${theme}: the favorite star (the API can add a favorite, never remove one)`, () => {
    resetEach();

    const CFG = { ...FULL_CFG, features: { ...FULL_CFG.features, user_favorite: true } };
    const DOCS = [
      { doc_id: "d1", title: "One", url: "https://e.com/1", favorite_count: 2 },
      { doc_id: "d2", title: "Two", url: "https://e.com/2", favorite_count: 0 },
    ];
    const star = (i) => document.querySelectorAll("#results > li")[i].querySelector(".favorite-btn");

    /** Signed in; the server already lists `favorites` (doc ids) as favorites. */
    async function bootFavorites(favorites = []) {
      const flow = await loadEnglishFlow(theme, CFG);
      flow.isAuthenticated.mockReturnValue(true);
      installDispatch(flow.get, { search: makeSearchEnv(DOCS), favorites });
      mountBody(SEARCH_FIXTURE);
      flow.mod._state.q = "foo";
      await flow.mod.runSearch();
      await settle();
      return flow;
    }

    it("an unfavorited star offers to add, and is pressed and named a favorite once the add succeeded", async () => {
      const flow = await bootFavorites();
      flow.post.mockResolvedValue({ favorite: true, count: 3 });
      expect(star(0).getAttribute("aria-pressed")).toBe("false");
      expect(star(0).getAttribute("aria-label")).toBe("Add to favorites");
      expect(star(0).hasAttribute("aria-disabled")).toBe(false);
      star(0).click();
      await settle();
      expect(flow.post).toHaveBeenCalledTimes(1);
      expect(flow.post.mock.calls[0][0]).toBe("/documents/d1/favorite");
      expect(star(0).getAttribute("aria-pressed")).toBe("true");
      expect(star(0).getAttribute("aria-label")).toBe("Added to favorites");
      expect(star(0).title).toBe("Added to favorites");
      expect(star(0).getAttribute("aria-disabled")).toBe("true");
      expect(star(0).querySelector(".favorite-count").textContent).toBe("3");
    });

    it("a favorited star never offers removal, and a click on it sends nothing", async () => {
      const flow = await bootFavorites(["d1"]);
      expect(star(0).getAttribute("aria-pressed")).toBe("true");
      expect(star(0).getAttribute("aria-label")).toBe("Added to favorites");
      expect(star(0).getAttribute("aria-label")).not.toBe("Remove from favorites");
      expect(star(0).getAttribute("aria-disabled")).toBe("true");
      star(0).click();
      star(0).click();
      await settle();
      expect(flow.post).not.toHaveBeenCalled();
      expect(star(0).getAttribute("aria-pressed")).toBe("true");
      // the other row is unaffected
      expect(star(1).getAttribute("aria-pressed")).toBe("false");
    });

    it("stays unpressed when the add did not happen", async () => {
      const flow = await bootFavorites();
      flow.post.mockResolvedValue({ favorite: false, count: 0 });
      star(0).click();
      await settle();
      expect(star(0).getAttribute("aria-pressed")).toBe("false");
      expect(star(0).getAttribute("aria-label")).toBe("Add to favorites");
      expect(star(0).hasAttribute("aria-disabled")).toBe(false);
    });

    it("a click as a guest is refused by the server and leaves the star as it was", async () => {
      const flow = await bootFavorites();
      flow.post.mockRejectedValue(Object.assign(new Error("login"), { code: "auth_required", httpStatus: 401 }));
      star(0).click();
      await settle();
      expect(star(0).getAttribute("aria-pressed")).toBe("false");
      expect(star(0).getAttribute("aria-label")).toBe("Add to favorites");
    });
  });
}
