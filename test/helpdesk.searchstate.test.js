// SPDX-License-Identifier: Apache-2.0
// helpdesk: what the previous search leaves behind when the next one starts or fails.
//
//   1. The header search box starts a fresh search. The options drawer's category select
//      always shows the categories of the search on screen, so a category that arrived with
//      the URL (a home category tile, a shared link) used to be copied from the drawer into
//      the next query. Only the categories the user picked in the drawer ride along.
//   2. A related-searches chip is a link to its own search URL, like the popular words, not
//      a search run behind the address bar's back.
//   3. A search the server rejects with HTTP 400 replaces the previous results with the
//      error banner instead of leaving the previous query's answers under it.
//
// Cases 1 and 3 load the theme's search.js against its shipped index.html; case 2 boots
// the theme's app.js with its real router, so a click on the chip goes where it would for
// a visitor.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { bootApp } from "./helpers/loadShell.js";
import { resetDom, setLocation } from "./helpers/dom.js";
import { mountIndexBody } from "./helpers/themes.js";
import {
  FULL_CFG, SAMPLE_DOCS, makeSearchEnv, installDispatch, settle,
} from "./helpers/searchFlow.js";

const THEME = "helpdesk";
const $ = (id) => document.getElementById(id);

let app;

beforeEach(() => {
  resetDom();
  document.head.innerHTML = "";
  sessionStorage.clear();
  window.scrollTo = () => {};
});

afterEach(() => {
  if (app) app.detach();
  app = undefined;
  vi.resetModules();
  document.head.innerHTML = "";
  setLocation("/");
});

describe("helpdesk: the header search box and the drawer's categories", () => {
  /** The category page a home tile opens, with the drawer filled from it as on screen. */
  async function onCategoryPage() {
    const flow = await loadSearchFlow(THEME, FULL_CFG);
    installDispatch(flow.get);
    mountIndexBody(THEME);
    flow.mod.attach();
    setLocation("/search?q=&fields.label=lblA");
    flow.mod.runFromUrl();
    await settle();
    return flow;
  }

  /** Type `q` in the header box, press Enter, and return the params of the URL it opens. */
  function searchFor(flow, q) {
    $("query").value = q;
    $("search-form").dispatchEvent(new Event("submit", { cancelable: true }));
    const target = flow.navigate.mock.calls.at(-1)[0];
    return new URLSearchParams(target.slice(target.indexOf("?") + 1));
  }

  const drawerLabels = () => [...$("labelSearchOption").selectedOptions].map((o) => o.value);

  /** What the user does in the drawer: select exactly `values` (a change event, as a click fires). */
  function pickInDrawer(values) {
    for (const o of $("labelSearchOption").options) o.selected = values.includes(o.value);
    $("labelSearchOption").dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("shows the tile's category in the drawer, which is why it used to ride along", async () => {
    await onCategoryPage();
    expect(drawerLabels()).toEqual(["lblA"]);
  });

  it("does not carry a category that came with the URL into a new query", async () => {
    const flow = await onCategoryPage();
    const params = searchFor(flow, "password reset");
    expect(params.get("q")).toBe("password reset");
    expect(params.has("fields.label")).toBe(false);
  });

  it("does not carry it into a second query either, after the drawer was filled again", async () => {
    const flow = await onCategoryPage();
    pickInDrawer(["lblB"]);
    searchFor(flow, "first");
    // The search for "first" arrives with the picked category in its URL; the drawer is
    // filled from it again, and that is not a new pick.
    setLocation("/search?q=first&fields.label=lblB");
    flow.mod.runFromUrl();
    await settle();
    expect(drawerLabels()).toEqual(["lblB"]);
    const params = searchFor(flow, "second");
    expect(params.has("fields.label")).toBe(false);
  });

  it("carries the categories the user picked in the drawer", async () => {
    const flow = await onCategoryPage();
    pickInDrawer(["lblB"]);
    expect(searchFor(flow, "password reset").getAll("fields.label")).toEqual(["lblB"]);
  });

  it("carries several picked categories, including the one the page already had", async () => {
    const flow = await onCategoryPage();
    pickInDrawer(["lblA", "lblB"]);
    expect(searchFor(flow, "password reset").getAll("fields.label")).toEqual(["lblA", "lblB"]);
  });

  it("searches every category when the user unselected the page's category in the drawer", async () => {
    const flow = await onCategoryPage();
    pickInDrawer([]);
    expect(searchFor(flow, "password reset").has("fields.label")).toBe(false);
  });

  it("does not carry a sidebar facet selection either (not a regression: it never did)", async () => {
    const flow = await loadSearchFlow(THEME, FULL_CFG);
    installDispatch(flow.get);
    mountIndexBody(THEME);
    flow.mod.attach();
    setLocation("/search?q=password&ex_q=label%3AlblB");
    flow.mod.runFromUrl();
    await settle();
    const params = searchFor(flow, "refund");
    expect(params.has("ex_q")).toBe(false);
    expect(params.has("fields.label")).toBe(false);
  });
});

describe("helpdesk: a related-searches chip", () => {
  async function onResults() {
    // Fess inserts <base href> into index.html; a relative href resolves against it.
    document.head.innerHTML = '<base href="/">';
    setLocation("/search?q=password");
    const env = makeSearchEnv(SAMPLE_DOCS, { related_query: ["password reset"] });
    app = await bootApp(THEME, { ...FULL_CFG, notifications: {} }, {
      get: async (path) => (path === "/search" ? env : path === "/auth/me" ? { authenticated: false } : {}),
    });
    await settle();
    const chip = document.querySelector("#related-queries a");
    expect(chip.textContent).toBe("password reset");
    return { ...app, chip };
  }

  const lastSearch = (get) => get.mock.calls.filter((c) => c[0] === "/search").at(-1)[1];

  it("links to the search URL of its query, which opens in a new tab as such", async () => {
    const { chip } = await onResults();
    expect(chip.pathname).toBe("/search");
    expect(new URLSearchParams(chip.search).get("q")).toBe("password reset");
  });

  it("puts the query in the address bar when clicked, so reload, share and Back keep it", async () => {
    const { chip, get } = await onResults();
    chip.click();
    await settle();
    expect(location.pathname).toBe("/search");
    expect(new URLSearchParams(location.search).get("q")).toBe("password reset");
    expect(lastSearch(get).q).toBe("password reset");
    expect($("query").value).toBe("password reset");
  });

  it("runs the search once", async () => {
    const { chip, get } = await onResults();
    get.mockClear();
    chip.click();
    await settle();
    expect(get.mock.calls.filter((c) => c[0] === "/search")).toHaveLength(1);
  });

  it("leaves the filters of the previous query behind, like any new query", async () => {
    document.head.innerHTML = '<base href="/">';
    setLocation("/search?q=password&ex_q=label%3AlblB");
    const env = makeSearchEnv(SAMPLE_DOCS, { related_query: ["password reset"] });
    app = await bootApp(THEME, { ...FULL_CFG, notifications: {} }, {
      get: async (path) => (path === "/search" ? env : path === "/auth/me" ? { authenticated: false } : {}),
    });
    await settle();
    document.querySelector("#related-queries a").click();
    await settle();
    expect(new URLSearchParams(location.search).has("ex_q")).toBe(false);
    expect(Object.keys(lastSearch(app.get))).not.toContain("ex_q");
  });
});

describe("helpdesk: a search the server rejects with HTTP 400", () => {
  const MESSAGE = "start must be non-negative, got: -1";

  /** Search successfully, then fail the next search with the API's 400 envelope. */
  async function successThenBadRequest() {
    const flow = await loadSearchFlow(THEME, FULL_CFG);
    installDispatch(flow.get, {
      search: makeSearchEnv(SAMPLE_DOCS, {
        related_query: ["rq1"],
        related_contents: ["<p>Featured answer</p>"],
      }),
    });
    mountIndexBody(THEME);
    flow.mod._state.q = "password reset";
    await flow.mod.runSearch();
    await settle();
    // The first search really did fill the page; otherwise the assertions after the
    // failure would pass on an empty page.
    expect($("results").children.length).toBe(2);
    expect($("results-status").textContent).not.toBe("");
    expect($("best-bet-body").textContent).toContain("Featured answer");
    expect($("related-content").classList.contains("d-none")).toBe(false);
    expect($("facet-body").children.length).toBeGreaterThan(0);
    expect($("facet-body-mobile").children.length).toBeGreaterThan(0);
    expect($("subfooter").classList.contains("d-none")).toBe(false);
    expect($("related-queries").classList.contains("d-none")).toBe(false);

    flow.get.mockRejectedValueOnce(Object.assign(new Error(MESSAGE), {
      code: "invalid_request", httpStatus: 400,
    }));
    flow.mod._state.q = "a";
    flow.mod._state.start = -1;
    await flow.mod.runSearch();
    await settle();
    return flow;
  }

  it("shows the server's message in the error banner", async () => {
    await successThenBadRequest();
    expect($("search-error").textContent).toBe(MESSAGE);
    expect($("search-error").classList.contains("d-none")).toBe(false);
  });

  it("removes the previous result cards", async () => {
    await successThenBadRequest();
    expect($("results").children.length).toBe(0);
  });

  it("clears the status line", async () => {
    await successThenBadRequest();
    expect($("results-status").textContent).toBe("");
  });

  it("hides the featured answer", async () => {
    await successThenBadRequest();
    expect($("best-bet-body").children.length).toBe(0);
    expect($("related-content").classList.contains("d-none")).toBe(true);
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

  it("drops the related searches of the previous query", async () => {
    await successThenBadRequest();
    expect($("related-queries").classList.contains("d-none")).toBe(true);
    expect($("related-queries").children.length).toBe(0);
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
    expect($("best-bet-body").textContent).toContain("Featured answer");
    expect($("facet-body").children.length).toBeGreaterThan(0);
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
