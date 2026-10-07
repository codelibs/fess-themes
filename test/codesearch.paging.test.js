// SPDX-License-Identifier: Apache-2.0
// codesearch: the pager steps by the page size the server served.
//
// /search?num=500 is capped by the server (page_size_max, 100 by default) and the answer
// says so in page_size. The page links used to step by the num that was asked for, so with a
// few hundred hits page 2 was start=500: an empty page behind a pager that showed pages 1 to 3.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { resetDom, mountBody, setLocation } from "./helpers/dom.js";
import { SEARCH_FIXTURE, SAMPLE_DOCS, makeSearchEnv, installDispatch, settle } from "./helpers/searchFlow.js";

beforeEach(() => {
  resetDom();
  window.scrollTo = () => {};
});
afterEach(() => setLocation("/"));

/** A page of an unfinished result list, as the server answers it. */
const page = (extra) => makeSearchEnv(SAMPLE_DOCS, {
  page_size: 100, page_number: 1, page_numbers: ["1", "2", "3"], next_page: true, prev_page: false, ...extra,
});

/** Open `url`, run the search it names, and return the pager's page-number and arrow links. */
async function open(url, env) {
  setLocation(url);
  const flow = await loadSearchFlow("codesearch", {});
  installDispatch(flow.get, { search: env });
  mountBody(SEARCH_FIXTURE);
  flow.mod.runFromUrl();
  await settle();
  const links = [...document.querySelectorAll("#pagination .page-link")];
  const byText = (text) => links.find((a) => a.textContent === text);
  return { ...flow, prev: byText("‹"), next: byText("›"), numbered: (n) => byText(String(n)) };
}

/** The search the pager navigated to, as URL parameters. */
const lastNavigation = (navigate) => new URLSearchParams(navigate.mock.calls.at(-1)[0].split("?")[1]);

describe("codesearch pager: a num above the server's cap", () => {
  it("starts page 2 where the served page ends", async () => {
    const { numbered, navigate } = await open("/search?q=foo&num=500", page());
    numbered(2).click();
    expect(lastNavigation(navigate).get("start")).toBe("100");
  });

  it("starts page 3 two served pages in", async () => {
    const { numbered, navigate } = await open("/search?q=foo&num=500", page());
    numbered(3).click();
    expect(lastNavigation(navigate).get("start")).toBe("200");
  });

  it("steps the next arrow by the served size", async () => {
    const { next, navigate } = await open("/search?q=foo&num=500", page());
    next.click();
    expect(lastNavigation(navigate).get("start")).toBe("100");
  });

  it("steps the previous arrow back by the served size", async () => {
    const { prev, navigate } = await open("/search?q=foo&num=500&start=200", page({ page_number: 3, prev_page: true }));
    prev.click();
    expect(lastNavigation(navigate).get("start")).toBe("100");
  });

  it("writes the served size into the URL it navigates to", async () => {
    const { numbered, navigate } = await open("/search?q=foo&num=500", page());
    numbered(2).click();
    const params = lastNavigation(navigate);
    expect(params.get("num")).toBe("100");
    expect(params.get("q")).toBe("foo");
  });

  it("asks the server for what the URL says, and pages by what came back", async () => {
    const { get } = await open("/search?q=foo&num=500", page());
    expect(get.mock.calls.find((c) => c[0] === "/search")[1]).toMatchObject({ num: 500, start: 0 });
  });
});

describe("codesearch pager: a page size the server served as asked", () => {
  it("keeps the size the URL asks for", async () => {
    const { numbered, navigate } = await open("/search?q=foo&num=50", page({ page_size: 50 }));
    numbered(2).click();
    const params = lastNavigation(navigate);
    expect(params.get("start")).toBe("50");
    expect(params.get("num")).toBe("50");
  });

  it("adds no num when the URL has none", async () => {
    const { next, navigate } = await open("/search?q=foo", page({ page_size: 20 }));
    next.click();
    const params = lastNavigation(navigate);
    expect(params.get("start")).toBe("20");
    expect(params.has("num")).toBe(false);
  });

  it("falls back to the size asked for when the answer names none", async () => {
    const env = page();
    delete env.page_size;
    const { numbered, navigate } = await open("/search?q=foo&num=50", env);
    numbered(2).click();
    expect(lastNavigation(navigate).get("start")).toBe("50");
  });

  it("does not take a size larger than the one asked for", async () => {
    const { numbered, navigate } = await open("/search?q=foo&num=10", page({ page_size: 100 }));
    numbered(2).click();
    expect(lastNavigation(navigate).get("start")).toBe("10");
  });
});
