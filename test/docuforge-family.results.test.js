// SPDX-License-Identifier: Apache-2.0
// docuforge, nomadkit, rawblock, voicebox: what runSearch() leaves on the page. The four themes
// share a byte-identical search.js, so the same cases run against each theme's own copy.
//
//   1. A search the server rejects with HTTP 400 (a query the page accepts but the API does not,
//      e.g. one that is too long) replaces the previous results with the error, the way a fresh
//      load of the same URL looks. It used to leave the previous result cards, pager, status line
//      and facet sidebar on screen under the red banner.
//   2. The "(0.06 seconds)" suffix of the status line reads `exec_time`, which the v2 API sends as
//      a decimal STRING ("0.06"), not a number.
//   3. The document title carries the query literally. String.prototype.replace() treats `$&` and
//      `$$` in a replacement string as patterns, so "a$&b" used to come out as "a{0}b - Fess".
//   4. The pager links are the URLs of their pages (not "#"), the current page is marked
//      aria-current="page", every page number has an accessible page name, and a disabled end (no
//      previous / next page) is not a link. A plain click still pages in place; a modified one
//      (new tab, new window) is the browser's.
//
// The theme's real English bundle is loaded (through the real i18n.js init), so the assertions
// see the text a user sees rather than raw i18n keys.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { modulePath } from "./helpers/themes.js";
import { resetDom, mountBody, setLocation } from "./helpers/dom.js";
import {
  SEARCH_FIXTURE, FULL_CFG, SAMPLE_DOCS, makeSearchEnv, installDispatch, settle,
} from "./helpers/searchFlow.js";

const FAMILY = ["docuforge", "nomadkit", "rawblock", "voicebox"];

const english = (theme) => JSON.parse(readFileSync(
  join(dirname(dirname(modulePath(theme, "app.js"))), "i18n", "messages.en.json"), "utf8"));

/**
 * Load the theme's search.js with its real i18n.js primed with the English bundle. The i18n module
 * imported here is the instance search.js resolved (same module registry), so initialising it is
 * what makes search.js's t() return English.
 */
async function loadEnglishFlow(theme) {
  const flow = await loadSearchFlow(theme, FULL_CFG);
  const i18n = await import(`../themes/${theme}/assets/i18n.js`);
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => english(theme) }));
  try {
    await i18n.init("en");
  } finally {
    vi.unstubAllGlobals();
  }
  return flow;
}

beforeEach(() => {
  resetDom();
  window.scrollTo = () => {};
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(FAMILY)("%s: a search the server rejects with HTTP 400", (theme) => {
  const MESSAGE = "The query is too long (limit 1000 characters).";

  /** Search successfully, then fail the next search with the API's 400 envelope. */
  async function successThenBadRequest() {
    const flow = await loadEnglishFlow(theme);
    installDispatch(flow.get, { search: makeSearchEnv(SAMPLE_DOCS) });
    mountBody(SEARCH_FIXTURE);
    flow.mod._state.q = "coffee";
    await flow.mod.runSearch();
    await settle();
    const $ = (id) => document.getElementById(id);
    // The first search really did put everything on the page; otherwise the assertions after the
    // failure would pass on an empty page.
    expect($("results").children.length).toBe(2);
    expect($("results-status").textContent).not.toBe("");
    expect($("subfooter").classList.contains("d-none")).toBe(false);
    expect($("pagination").children.length).toBeGreaterThan(0);
    expect($("facet-body").children.length).toBeGreaterThan(0);
    expect($("related-queries").classList.contains("d-none")).toBe(false);

    flow.get.mockRejectedValueOnce(Object.assign(new Error(MESSAGE), {
      code: "invalid_request", httpStatus: 400,
    }));
    flow.mod._state.q = "x".repeat(1001);
    await flow.mod.runSearch();
    await settle();
    return { flow, $ };
  }

  it("shows the server's message in the error banner", async () => {
    const { $ } = await successThenBadRequest();
    expect($("search-error").textContent).toBe(MESSAGE);
    expect($("search-error").classList.contains("d-none")).toBe(false);
  });

  it("removes the previous result cards", async () => {
    const { $ } = await successThenBadRequest();
    expect($("results").children.length).toBe(0);
  });

  it("clears the status line", async () => {
    const { $ } = await successThenBadRequest();
    expect($("results-status").textContent).toBe("");
  });

  it("hides and empties the pager", async () => {
    const { $ } = await successThenBadRequest();
    expect($("subfooter").classList.contains("d-none")).toBe(true);
    expect($("pagination").children.length).toBe(0);
  });

  it("empties the facet sidebar, desktop and mobile", async () => {
    const { $ } = await successThenBadRequest();
    expect($("facet-body").children.length).toBe(0);
    expect($("facet-body-mobile").children.length).toBe(0);
  });

  it("drops the related searches of the previous query", async () => {
    const { $ } = await successThenBadRequest();
    expect($("related-queries").classList.contains("d-none")).toBe(true);
    expect($("related-queries").children.length).toBe(0);
    expect($("related-content").classList.contains("d-none")).toBe(true);
  });

  it("does not show the no-results state, which is a different outcome", async () => {
    const { $ } = await successThenBadRequest();
    expect($("empty-state").classList.contains("d-none")).toBe(true);
  });

  it("hides the loading indicator", async () => {
    const { $ } = await successThenBadRequest();
    expect($("search-loading").classList.contains("d-none")).toBe(true);
  });

  it("recovers: the next good search renders its results again", async () => {
    const { flow, $ } = await successThenBadRequest();
    flow.mod._state.q = "coffee";
    await flow.mod.runSearch();
    await settle();
    expect($("results").children.length).toBe(2);
    expect($("search-error").classList.contains("d-none")).toBe(true);
  });
});

describe.each(FAMILY)("%s: the exec time in the results status", (theme) => {
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

describe.each(FAMILY)("%s: the document title", (theme) => {
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

describe.each(FAMILY)("%s: the pager", (theme) => {
  // Page 2 of 3, ten per page: there is a page before and a page after.
  const env = (extra = {}) => makeSearchEnv(SAMPLE_DOCS, {
    page_number: 2, page_numbers: ["1", "2", "3"], prev_page: true, next_page: true, ...extra,
  });
  const $ = (id) => document.getElementById(id);
  const searchParams = (get) => get.mock.calls.filter((c) => c[0] === "/search").map((c) => c[1]);

  afterEach(() => setLocation("/"));

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
