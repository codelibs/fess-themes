// SPDX-License-Identifier: Apache-2.0
// docsearch: a search the server rejects with HTTP 400 replaces the previous results.
//
// The router moves between searches without a page load. When the next query is invalid (a sort the
// server does not know, start=-5), the error banner used to go up while the previous query's result
// cards, status line, facet sidebar, filter chips and pager stayed under it as if they answered the
// new query. A direct load of the same URL shows only the banner; so does a search after the fix.
// A failure that is not the query's (network, server) keeps what is on screen, as before.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { resetDom } from "./helpers/dom.js";
import { mountIndexBody } from "./helpers/themes.js";
import {
  FULL_CFG, SAMPLE_DOCS, makeSearchEnv, installDispatch, settle,
} from "./helpers/searchFlow.js";

const THEME = "docsearch";
const $ = (id) => document.getElementById(id);
const MESSAGE = "start must be non-negative, got: -5";

beforeEach(() => {
  resetDom();
  document.head.innerHTML = "";
  sessionStorage.clear();
  window.scrollTo = () => {};
});

afterEach(() => {
  vi.resetModules();
  document.head.innerHTML = "";
});

/** Search successfully (with a filter on), check the page is full, then fail the next search with the API's 400. */
async function successThenBadRequest() {
  const flow = await loadSearchFlow(THEME, FULL_CFG);
  installDispatch(flow.get, {
    search: makeSearchEnv(SAMPLE_DOCS),
    relatedQueries: ["rq1"],
    content: "<p>Featured answer</p>",
  });
  mountIndexBody(THEME);
  flow.mod._state.q = "password reset";
  flow.mod._state.fields = { label: ["lblA"] };
  await flow.mod.runSearch();
  await settle();
  // The first search really did fill the page; otherwise the assertions after the failure
  // would pass on an empty page.
  expect($("results").children.length).toBe(2);
  expect($("results-status").textContent).not.toBe("");
  expect($("queryId").value).toBe("qid-1");
  expect($("facet-body").children.length).toBeGreaterThan(0);
  expect($("facet-body-mobile").children.length).toBeGreaterThan(0);
  expect($("subfooter").classList.contains("d-none")).toBe(false);
  expect($("pagination").children.length).toBeGreaterThan(0);
  expect($("related-queries").classList.contains("d-none")).toBe(false);
  expect($("related-content").classList.contains("d-none")).toBe(false);
  expect($("active-chips").children.length).toBeGreaterThan(0);
  expect($("current-filters").children.length).toBeGreaterThan(0);
  expect($("options-bar").children.length).toBeGreaterThan(0);

  flow.get.mockRejectedValueOnce(Object.assign(new Error(MESSAGE), {
    code: "invalid_request", httpStatus: 400,
  }));
  flow.mod._state.start = -5;
  await flow.mod.runSearch();
  await settle();
  return flow;
}

describe("docsearch: a search the server rejects with HTTP 400", () => {
  it("shows the server's message in the error banner", async () => {
    await successThenBadRequest();
    expect($("search-error").textContent).toBe(MESSAGE);
    expect($("search-error").classList.contains("d-none")).toBe(false);
  });

  it("removes the previous result cards and the identifiers of that response", async () => {
    await successThenBadRequest();
    expect($("results").children.length).toBe(0);
    expect($("queryId").value).toBe("");
  });

  it("clears the status line", async () => {
    await successThenBadRequest();
    expect($("results-status").textContent).toBe("");
  });

  it("empties the facet sidebar, desktop and mobile, and hides the mobile filter button", async () => {
    await successThenBadRequest();
    expect($("facet-body").children.length).toBe(0);
    expect($("facet-body").classList.contains("d-md-block")).toBe(false);
    expect($("facet-body-mobile").children.length).toBe(0);
    expect($("facet-toggle-wrap").classList.contains("d-none")).toBe(true);
  });

  it("hides and empties the pager", async () => {
    await successThenBadRequest();
    expect($("subfooter").classList.contains("d-none")).toBe(true);
    expect($("pagination").children.length).toBe(0);
  });

  it("drops the filter chips, the current-selection badges and the options bar of the previous query", async () => {
    await successThenBadRequest();
    expect($("active-chips").children.length).toBe(0);
    expect($("active-chips").classList.contains("d-none")).toBe(true);
    expect($("current-filters").children.length).toBe(0);
    expect($("options-bar").children.length).toBe(0);
  });

  it("drops the related searches and the related content of the previous query", async () => {
    await successThenBadRequest();
    expect($("related-queries").classList.contains("d-none")).toBe(true);
    expect($("related-queries").children.length).toBe(0);
    expect($("related-content").classList.contains("d-none")).toBe(true);
    expect($("related-content").children.length).toBe(0);
  });

  it("does not show the no-results state, which is a different outcome", async () => {
    await successThenBadRequest();
    expect($("empty-state").classList.contains("d-none")).toBe(true);
  });

  it("recovers: the next good search renders its results again", async () => {
    const flow = await successThenBadRequest();
    flow.mod._state.q = "password";
    flow.mod._state.start = 0;
    await flow.mod.runSearch();
    await settle();
    expect($("results").children.length).toBe(2);
    expect($("search-error").classList.contains("d-none")).toBe(true);
    expect($("facet-body").children.length).toBeGreaterThan(0);
    expect($("subfooter").classList.contains("d-none")).toBe(false);
    expect($("options-bar").children.length).toBeGreaterThan(0);
  });

  it("keeps the previous results when the failure is not the query's (a network error)", async () => {
    const flow = await loadSearchFlow(THEME, FULL_CFG);
    installDispatch(flow.get);
    mountIndexBody(THEME);
    flow.mod._state.q = "password";
    await flow.mod.runSearch();
    await settle();
    flow.get.mockRejectedValueOnce(Object.assign(new Error("net"), { name: "NetworkError" }));
    await flow.mod.runSearch();
    await settle();
    expect($("search-error").classList.contains("d-none")).toBe(false);
    expect($("results").children.length).toBe(2);
  });
});
