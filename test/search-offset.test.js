// SPDX-License-Identifier: Apache-2.0
// The search offset travels with the page.
//
// With server-side rank fusion (the default), a deep page (start at or beyond half the fusion
// window) is read from the keyword searcher alone, shifted by an `offset`: how many documents of
// the fused head are not part of that prefix. /api/v2/search returns the offset next to
// record_count and page_count, and accepts it back as a request parameter. For an exact page a
// client has to echo the offset the previous response returned whenever it asks for start > 0.
//
// Every theme's own search.js is driven against the same contract:
//   - the response's offset is read into the state (missing or invalid -> 0),
//   - /search is sent `offset` only when start > 0 and the offset is above 0,
//   - the address bar carries offset= exactly then, so reload, back/forward and a shared link
//     land on the same page,
//   - the prev/next/numbered page links carry the offset of the current query,
//   - a new query or any change that goes back to the first page forgets it.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { readModuleSource } from "./helpers/themes.js";
import { resetDom, mountBody, setLocation } from "./helpers/dom.js";
import {
  SEARCH_FIXTURE, FULL_CFG, SAMPLE_DOCS, makeSearchEnv, installDispatch, settle,
} from "./helpers/searchFlow.js";

const THEMES = [
  "codesearch", "docsearch", "docuforge", "filesearch", "helpdesk", "mosaic",
  "nomadkit", "rawblock", "semanticlens", "storefront", "voicebox",
];
// Themes whose facet sidebar entries reset to the first page when clicked (bootstrap facet DOM).
const FACET_THEMES = ["docsearch", "docuforge", "helpdesk", "nomadkit", "rawblock", "voicebox"];

const cfgOf = (theme) => (theme === "codesearch" ? {} : FULL_CFG);

beforeEach(() => {
  resetDom();
  sessionStorage.clear();
  window.scrollTo = () => {};
});
afterEach(() => setLocation("/"));

/** A page with a previous and a next page, as the server answers it. */
const deepPage = (extra) => makeSearchEnv(SAMPLE_DOCS, {
  page_size: 10, page_number: 2, page_numbers: ["1", "2", "3"], prev_page: true, next_page: true, ...extra,
});

/** Open `url` and run the search it names. */
async function open(theme, url, env) {
  setLocation(url);
  const flow = await loadSearchFlow(theme, cfgOf(theme));
  installDispatch(flow.get, { search: env });
  mountBody(SEARCH_FIXTURE);
  flow.mod.runFromUrl();
  await settle();
  return flow;
}

/** The parameters of every result-list request (filesearch's one-row facet probes excluded). */
const searches = (get) => get.mock.calls.filter((c) => c[0] === "/search" && c[1].num !== 1).map((c) => c[1]);
const lastSearch = (get) => searches(get).at(-1);

/** The page links of the pager as URL parameters; prev and next are the first and the last. */
const linkParams = (anchor) => {
  const href = anchor.getAttribute("href");
  return new URLSearchParams(href.slice(href.indexOf("?") + 1));
};
const prevLink = () => document.querySelector("#pagination li:first-child a");
const nextLink = () => document.querySelector("#pagination li:last-child a");
const urlParams = () => new URLSearchParams(location.search);

describe.each(THEMES)("search offset [%s]", (theme) => {
  it("takes the offset from the response", async () => {
    const { mod } = await open(theme, "/search?q=foo&start=10&offset=37", deepPage({ offset: 41 }));
    expect(mod._state.offset).toBe(41);
  });

  it.each([
    ["missing", undefined],
    ["negative", -3],
    ["fractional", 1.5],
    ["not a number", "x"],
    ["null", null],
  ])("treats a %s offset in the response as 0, replacing the one it asked with", async (_, value) => {
    const { mod } = await open(theme, "/search?q=foo&start=10&offset=37", deepPage({ offset: value }));
    expect(mod._state.offset).toBe(0);
    expect(urlParams().has("offset")).toBe(false);
  });

  it("reads the offset of the address bar", async () => {
    // The response repeats it, as the server does for the offset it was given.
    const { mod } = await open(theme, "/search?q=foo&start=10&offset=37", deepPage({ offset: 37 }));
    expect(mod._state.start).toBe(10);
    expect(mod._state.offset).toBe(37);
  });

  it("sends the offset with a deep page and keeps it in the address bar", async () => {
    const { get } = await open(theme, "/search?q=foo&start=10&offset=37", deepPage({ offset: 37 }));
    expect(lastSearch(get)).toMatchObject({ q: "foo", start: 10, offset: 37 });
    expect(urlParams().get("start")).toBe("10");
    expect(urlParams().get("offset")).toBe("37");
  });

  it("ignores an offset in the address bar that is not a non-negative integer", async () => {
    for (const bad of ["-5", "abc", "1.5", ""]) {
      const { get } = await open(theme, `/search?q=foo&start=10&offset=${bad}`, deepPage());
      expect(lastSearch(get)).not.toHaveProperty("offset");
    }
  });

  it("does not send an offset with the first page, nor keep one in the address bar", async () => {
    const { get } = await open(theme, "/search?q=foo&offset=9", makeSearchEnv(SAMPLE_DOCS, { offset: 9 }));
    expect(lastSearch(get)).toMatchObject({ q: "foo", start: 0 });
    expect(lastSearch(get)).not.toHaveProperty("offset");
    expect(urlParams().has("offset")).toBe(false);
  });

  it("does not send an offset it was never given, and adopts the one the response returns", async () => {
    const { get, mod } = await open(theme, "/search?q=foo&start=10", deepPage({ offset: 37 }));
    expect(lastSearch(get)).not.toHaveProperty("offset");
    expect(mod._state.offset).toBe(37);
    // The address bar and the links follow the response, so a reload or a shared link is exact.
    expect(urlParams().get("start")).toBe("10");
    expect(urlParams().get("offset")).toBe("37");
    expect(linkParams(nextLink()).get("offset")).toBe("37");
  });

  it("does not send an offset when the server returns none", async () => {
    const { get, mod } = await open(theme, "/search?q=foo&start=10", deepPage());
    expect(mod._state.offset).toBe(0);
    expect(lastSearch(get)).not.toHaveProperty("offset");
    expect(urlParams().has("offset")).toBe(false);
    expect(linkParams(nextLink()).has("offset")).toBe(false);
  });

  it("puts the offset of the current query on the next page link", async () => {
    await open(theme, "/search?q=foo&start=10&offset=37", deepPage({ offset: 37 }));
    const params = linkParams(nextLink());
    expect(params.get("start")).toBe("20");
    expect(params.get("offset")).toBe("37");
    expect(params.get("q")).toBe("foo");
  });

  it("leaves the offset off the link back to the first page", async () => {
    await open(theme, "/search?q=foo&start=10&offset=37", deepPage({ offset: 37 }));
    const params = linkParams(prevLink());
    expect(params.get("start") || "0").toBe("0");
    expect(params.has("offset")).toBe(false);
  });

  it("asks for the next page with the offset of the current query", async () => {
    const { get, navigate } = await open(theme, "/search?q=foo&start=10&offset=37", deepPage({ offset: 37 }));
    nextLink().click();
    await settle();
    if (theme === "codesearch") {
      // The address bar drives this theme: the click navigates, and the route runs the search.
      const target = navigate.mock.calls.at(-1)[0];
      const params = new URLSearchParams(target.slice(target.indexOf("?") + 1));
      expect(params.get("start")).toBe("20");
      expect(params.get("offset")).toBe("37");
    } else {
      expect(lastSearch(get)).toMatchObject({ start: 20, offset: 37 });
      expect(urlParams().get("start")).toBe("20");
      expect(urlParams().get("offset")).toBe("37");
    }
  });

  it("drops the offset when paging back to the first page", async () => {
    const { get, navigate } = await open(theme, "/search?q=foo&start=10&offset=37", deepPage({ offset: 37 }));
    prevLink().click();
    await settle();
    if (theme === "codesearch") {
      const target = navigate.mock.calls.at(-1)[0];
      const params = new URLSearchParams(target.slice(target.indexOf("?") + 1));
      expect(params.get("start")).toBe("0");
      expect(params.has("offset")).toBe(false);
    } else {
      expect(lastSearch(get)).toMatchObject({ start: 0 });
      expect(lastSearch(get)).not.toHaveProperty("offset");
      expect(urlParams().has("offset")).toBe(false);
    }
  });

  it("forgets the offset when the search state is reset", async () => {
    const { mod } = await open(theme, "/search?q=foo&start=10&offset=37", deepPage({ offset: 37 }));
    (mod.resetSearchState || mod.clearSearchState)();
    expect(mod._state.start).toBe(0);
    expect(mod._state.offset).toBe(0);
  });

  it("starts a new query from the header box without start= or offset=", async () => {
    const { mod, navigate } = await open(theme, "/search?q=foo&start=10&offset=37", deepPage({ offset: 37 }));
    if (theme === "codesearch") {
      mod.submitQuery("bar");
    } else {
      mod.attach();
      document.getElementById("query").value = "bar";
      document.getElementById("search-form").dispatchEvent(new Event("submit", { cancelable: true }));
    }
    const target = navigate.mock.calls.at(-1)[0];
    const params = new URLSearchParams(target.slice(target.indexOf("?") + 1));
    expect(params.get("q")).toBe("bar");
    expect(params.has("start")).toBe(false);
    expect(params.has("offset")).toBe(false);
  });
});

describe("codesearch numbered pages", () => {
  it("carry the offset of the current query, except page 1", async () => {
    await open("codesearch", "/search?q=foo&start=10&offset=37", deepPage({ offset: 37 }));
    const byText = (text) => [...document.querySelectorAll("#pagination .page-link")].find((a) => a.textContent === text);
    expect(linkParams(byText("3")).get("start")).toBe("20");
    expect(linkParams(byText("3")).get("offset")).toBe("37");
    expect(linkParams(byText("1")).has("offset")).toBe(false);
  });

  it("navigate with the offset of the current query when clicked", async () => {
    const { navigate } = await open("codesearch", "/search?q=foo&start=10&offset=37", deepPage({ offset: 37 }));
    [...document.querySelectorAll("#pagination .page-link")].find((a) => a.textContent === "3").click();
    const target = navigate.mock.calls.at(-1)[0];
    const params = new URLSearchParams(target.slice(target.indexOf("?") + 1));
    expect(params.get("start")).toBe("20");
    expect(params.get("offset")).toBe("37");
  });
});

// A facet click goes back to the first page. Its search is not sent an offset either way (start is
// 0), but the state must not keep the old query's offset if that search fails or is superseded.
describe.each(FACET_THEMES)("a facet click forgets the offset [%s]", (theme) => {
  it("resets start and offset before the new search answers", async () => {
    const { mod, get } = await open(theme, "/search?q=foo&start=10&offset=37", deepPage({ offset: 37 }));
    expect(mod._state.offset).toBe(37);
    get.mockImplementation(async (path) => {
      if (path === "/search") throw new Error("down");
      return {};
    });
    document.querySelector("#facet-body ul li.list-group-item a").click();
    await settle();
    expect(mod._state.start).toBe(0);
    expect(mod._state.offset).toBe(0);
  });
});

// The reset sites are many (new search, facet, chip, related query, similar documents, ...): none
// may set the state back to the first page and leave the offset behind.
describe.each(THEMES)("every return to the first page forgets the offset [%s]", (theme) => {
  const lines = readModuleSource(theme, "search.js").split("\n");

  it("sets state.offset = 0 right after every state.start = 0", () => {
    const sites = lines.map((l, i) => [l, i]).filter(([l]) => /^\s*state\.start = 0;\s*$/.test(l));
    expect(sites.length).toBeGreaterThan(0);
    for (const [, i] of sites) expect(lines[i + 1].trim(), `line ${i + 1}`).toBe("state.offset = 0;");
  });

  it("deletes offset right after every params.delete(\"start\") that starts a new search", () => {
    const sites = lines.map((l, i) => [l, i]).filter(([l]) => /^\s*params\.delete\("start"\);/.test(l));
    expect(sites.length).toBeGreaterThan(0);
    for (const [, i] of sites) expect(lines[i + 1].trim(), `line ${i + 1}`).toBe('params.delete("offset");');
  });
});

// The response of a search can land after the user has moved to another view (chat, advanced
// search, ...): the router only pushes history, and nothing cancels the search. The address bar
// then belongs to that view, so the late offset must not write start=/offset= onto it, nor drop
// its history state. The state still takes the offset.
describe.each(THEMES)("a response that lands after leaving the search view [%s]", (theme) => {
  it("keeps the other view's address bar and history state", async () => {
    setLocation("/search?q=foo&start=10");
    const flow = await loadSearchFlow(theme, cfgOf(theme));
    installDispatch(flow.get, { search: deepPage({ offset: 37 }) });
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const answer = flow.get.getMockImplementation();
    flow.get.mockImplementation(async (path, ...rest) => {
      if (path === "/search") await gate;
      return answer(path, ...rest);
    });
    mountBody(SEARCH_FIXTURE);
    flow.mod.runFromUrl();
    await settle();

    history.pushState({ view: "chat" }, "", "/chat");
    release();
    await settle();

    expect(flow.mod._state.offset).toBe(37);
    expect(location.pathname).toBe("/chat");
    expect(location.search).toBe("");
    expect(history.state).toEqual({ view: "chat" });
  });
});
