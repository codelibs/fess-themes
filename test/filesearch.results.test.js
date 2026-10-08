// SPDX-License-Identifier: Apache-2.0
// filesearch: what runSearch() leaves on the page.
//
//   - the document title carries the query literally (`$&`, `$$`)
//   - the status line's "(0.06 seconds)" reads `exec_time` (a decimal string on the v2 API)
//   - a search the server rejects with HTTP 400 (a query the page accepts but the API does not)
//     replaces the previous results with the error, the way a fresh load of the same URL looks.
//     It used to leave the previous rows, pager and filter counts on screen under the red banner.
//
// The title, exec time and pager cases come from helpers/resultsContract.js, shared with the other themes that
// keep the bootstrap runSearch() contract; the failed-search cases run against the theme's own index.html.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { resetDom, setLocation } from "./helpers/dom.js";
import { mountIndexBody } from "./helpers/themes.js";
import { FULL_CFG, SAMPLE_DOCS, makeSearchEnv, settle } from "./helpers/searchFlow.js";
import { defineExecTimeTests, defineTitleTests } from "./helpers/resultsContract.js";

const THEME = "filesearch";

defineExecTimeTests(THEME);
defineTitleTests(THEME);

describe(`${THEME}: a search the server rejects with HTTP 400`, () => {
  const MESSAGE = "The query is too long (limit 1000 characters).";
  const CFG = { ...FULL_CFG, features: { ...FULL_CFG.features, thumbnail_enabled: false } };
  const $ = (id) => document.getElementById(id);

  beforeEach(() => {
    resetDom();
    sessionStorage.clear();
    localStorage.clear();
    window.scrollTo = () => {};
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => { setLocation("/"); vi.restoreAllMocks(); });

  /** Search successfully (a page 2 of 3, so there is a pager), then fail the next search with the API's 400 envelope. */
  async function successThenBadRequest() {
    setLocation("/search?q=coffee");
    const flow = await loadSearchFlow(THEME, CFG);
    flow.get.mockImplementation(async (path) => {
      if (path === "/search") {
        return makeSearchEnv(SAMPLE_DOCS, {
          page_number: 2, page_numbers: ["1", "2", "3"], prev_page: true, next_page: true,
          facet_field: [{ name: "filetype", result: [{ value: "html", count: 5 }, { value: "pdf", count: 3 }] }],
        });
      }
      return path === "/related-queries" ? { queries: ["rq1"] } : {};
    });
    mountIndexBody(THEME);
    flow.mod.attach();
    flow.mod.runFromUrl();
    await settle();
    // The first search really did put everything on the page; otherwise the assertions after the
    // failure would pass on an empty page.
    expect(document.querySelectorAll("#results .fs-row").length).toBe(2);
    expect($("results-status").textContent).not.toBe("");
    expect($("subfooter").classList.contains("d-none")).toBe(false);
    expect($("pagination").children.length).toBeGreaterThan(0);
    expect($("fs-filters").children.length).toBeGreaterThan(0);
    expect($("related-queries").classList.contains("d-none")).toBe(false);
    // and the first row is selected in the preview pane
    document.querySelector("#results .fs-row .fs-c-name").click();
    expect($("fs-preview").dataset.hasDoc).toBe("1");

    flow.get.mockImplementation(async (path) => {
      if (path === "/search") throw Object.assign(new Error(MESSAGE), { code: "invalid_request", httpStatus: 400 });
      return {};
    });
    flow.mod._state.q = "x".repeat(1001);
    await flow.mod.runSearch();
    await settle();
    return flow;
  }

  it("shows the server's message in the error banner", async () => {
    await successThenBadRequest();
    expect($("search-error").textContent).toBe(MESSAGE);
    expect($("search-error").classList.contains("d-none")).toBe(false);
  });

  it("removes the previous result rows and the preview of one of them", async () => {
    await successThenBadRequest();
    expect(document.querySelectorAll("#results .fs-row").length).toBe(0);
    expect($("fs-preview").dataset.hasDoc).toBe("0");
  });

  it("clears the status line", async () => {
    await successThenBadRequest();
    expect($("results-status").textContent).toBe("");
  });

  it("hides and empties the pager", async () => {
    await successThenBadRequest();
    expect($("subfooter").classList.contains("d-none")).toBe(true);
    expect($("pagination").children.length).toBe(0);
  });

  it("empties the filter panel and its count", async () => {
    await successThenBadRequest();
    expect($("fs-filters").children.length).toBe(0);
    expect($("fs-filter-count").classList.contains("d-none")).toBe(true);
  });

  it("drops the related searches of the previous query", async () => {
    await successThenBadRequest();
    expect($("related-queries").classList.contains("d-none")).toBe(true);
    expect($("related-queries").children.length).toBe(0);
  });

  it("does not show the no-results state, which is a different outcome", async () => {
    await successThenBadRequest();
    expect($("empty-state").classList.contains("d-none")).toBe(true);
  });

  it("hides the loading indicator", async () => {
    await successThenBadRequest();
    expect($("search-loading").classList.contains("d-none")).toBe(true);
  });

  it("recovers: the next good search renders its results again", async () => {
    const flow = await successThenBadRequest();
    flow.get.mockImplementation(async (path) => (path === "/search" ? makeSearchEnv(SAMPLE_DOCS) : {}));
    flow.mod._state.q = "coffee";
    await flow.mod.runSearch();
    await settle();
    expect(document.querySelectorAll("#results .fs-row").length).toBe(2);
    expect($("search-error").classList.contains("d-none")).toBe(true);
  });
});
