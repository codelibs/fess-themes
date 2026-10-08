// SPDX-License-Identifier: Apache-2.0
// codesearch: what runSearch() leaves on the page.
//
//   1. The summary's "(0.06 seconds)" reads `exec_time`, which the v2 API sends as a decimal
//      STRING ("0.06"), not a number.
//   2. The document title carries the query literally. String.prototype.replace() treats `$&` and
//      `$$` in a replacement string as patterns, so "a$&b" used to come out as "a{0}b - Fess".
//   3. The pager links are the URLs of their pages (not "#"), the current page is marked
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
import { SEARCH_FIXTURE, FULL_CFG, SAMPLE_DOCS, makeSearchEnv, installDispatch, settle } from "./helpers/searchFlow.js";

const THEME = "codesearch";
const $ = (id) => document.getElementById(id);

const ENGLISH = JSON.parse(readFileSync(
  join(dirname(dirname(modulePath(THEME, "app.js"))), "i18n", "messages.en.json"), "utf8"));

/** The theme's search.js with its real i18n.js primed with the English bundle. */
async function loadEnglishFlow(cfg = FULL_CFG) {
  const flow = await loadSearchFlow(THEME, cfg);
  const i18n = await import(`../themes/${THEME}/assets/i18n.js`);
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ENGLISH }));
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
  setLocation("/");
});

describe("codesearch: the exec time in the summary", () => {
  // query_time is deliberately far from every exec_time below, so a suffix that came from the
  // wrong field cannot pass.
  async function summaryFor(envExtra) {
    const flow = await loadEnglishFlow();
    installDispatch(flow.get, { search: makeSearchEnv(SAMPLE_DOCS, { query_time: 1000, ...envExtra }) });
    mountBody(SEARCH_FIXTURE);
    flow.mod._state.q = "coffee";
    await flow.mod.runSearch();
    await settle();
    return $("result-summary").textContent;
  }

  it("reads exec_time sent as a decimal string, as the v2 API sends it", async () => {
    expect(await summaryFor({ exec_time: "0.06" })).toContain("(0.06 seconds)");
  });

  it("keeps the two-decimal format for a string with fewer or more digits", async () => {
    expect(await summaryFor({ exec_time: "0.1" })).toContain("(0.10 seconds)");
    expect(await summaryFor({ exec_time: "0.12345" })).toContain("(0.12 seconds)");
  });

  it("still reads exec_time sent as a number", async () => {
    expect(await summaryFor({ exec_time: 0.05 })).toContain("(0.05 seconds)");
  });

  it("falls back to query_time when exec_time is not a number", async () => {
    expect(await summaryFor({ exec_time: "soon" })).toContain("(1.00 seconds)");
    expect(await summaryFor({ exec_time: "" })).toContain("(1.00 seconds)");
  });

  it("shows no time when neither field is usable", async () => {
    expect(await summaryFor({ exec_time: "soon", query_time: undefined })).not.toContain("seconds");
  });
});


describe("codesearch: the document title of a search", () => {
  async function titleFor(q) {
    const flow = await loadEnglishFlow();
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


describe("codesearch: the pager", () => {
  // Page 2 of 3, ten per page: there is a page before and a page after.
  const env = (extra = {}) => makeSearchEnv(SAMPLE_DOCS, {
    page_number: 2, page_numbers: ["1", "2", "3"], prev_page: true, next_page: true, ...extra,
  });

  async function onPage2(extra) {
    setLocation("/search?q=foo&num=10&start=10");
    const flow = await loadEnglishFlow();
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
      "search?q=foo&num=10&start=0",
      "search?q=foo&num=10&start=10",
      "search?q=foo&num=10&start=20",
    ]);
  });

  it("links previous and next to the pages before and after", async () => {
    await onPage2();
    const all = links();
    expect(all[0].getAttribute("href")).toBe("search?q=foo&num=10&start=0");
    expect(all.at(-1).getAttribute("href")).toBe("search?q=foo&num=10&start=20");
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
    expect(links()[0].getAttribute("aria-label")).toBe("Previous");
    expect(links().at(-1).getAttribute("aria-label")).toBe("Next");
  });

  it("opens a page in place on a plain click", async () => {
    const flow = await onPage2();
    const ev = click(numbered()[2]);
    expect(ev.defaultPrevented).toBe(true);
    expect(new URLSearchParams(flow.navigate.mock.calls.at(-1)[0].split("?")[1]).get("start")).toBe("20");
  });

  it("leaves a click with Ctrl, Meta or Shift to the browser", async () => {
    const flow = await onPage2();
    for (const modifier of ["ctrlKey", "metaKey", "shiftKey"]) {
      expect(click(numbered()[2], { [modifier]: true }).defaultPrevented).toBe(false);
    }
    expect(flow.navigate).not.toHaveBeenCalled();
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
