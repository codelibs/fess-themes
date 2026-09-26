// SPDX-License-Identifier: Apache-2.0
// Behavioural coverage for the per-theme search.js runSearch() pipeline.
//
// The companion search.test.js unit-tests only the functions this PR reapplied
// (copy button, plainTitle, facet renderers), which leaves the ~2k-line render
// pipeline — runSearch, renderResults, renderPagination, renderFacets, the chip /
// current-filter / options-bar renderers and the auxiliary loaders — unexercised
// (~9% aggregate). These cases drive runSearch() end to end with a mocked api + a
// superset DOM scaffold (helpers/searchFlow.js), asserting on the rendered DOM.
//
// Every theme's search.js is derived from the bootstrap theme, so nine of the ten
// share one runSearch contract (Bootstrap "d-none" visibility, #results-status,
// renderResultsStatus / renderCurrentFilters / renderOptionsBar, the same endpoint
// sequence). codesearch diverges (its own renderSummary, the `hidden` attribute,
// a #query-input header, a two-arg buildResultCard), so it gets its own block.
// storefront draws product tiles and mosaic/semanticlens use renderFilterGroups
// instead of renderFacetQueryViews, so the facet-shape assertions are scoped to the
// six themes that keep the bootstrap facet DOM.
//
// i18n.t() returns its key unchanged (messages are empty without init()), so the
// exact-string assertions below match raw i18n keys.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { resetDom, mountBody, setLocation } from "./helpers/dom.js";
import { mountIndexBody } from "./helpers/themes.js";
import {
  SEARCH_FIXTURE, FULL_CFG, SAMPLE_DOCS, makeSearchEnv,
  installDispatch, settle, searchCalls,
} from "./helpers/searchFlow.js";

// Themes that keep the bootstrap runSearch contract (d-none visibility, #results-status).
const DNONE_THEMES = [
  "docsearch", "docuforge", "helpdesk", "mosaic",
  "nomadkit", "rawblock", "semanticlens", "storefront", "voicebox",
];
// Themes that keep the bootstrap facet DOM (renderFacetQueryViews → ul.list-group)
// and a #result <li> card the chip/current-filter renderers were written against.
const STD_THEMES = [
  "docsearch", "docuforge", "helpdesk", "nomadkit", "rawblock", "voicebox",
];

beforeEach(() => {
  resetDom();
  sessionStorage.clear();
  // renderPagination / facet click handlers scroll to top; jsdom has no scrollTo.
  window.scrollTo = () => {};
});
afterEach(() => setLocation("/"));

// ─── Shared runSearch pipeline across the nine bootstrap-contract themes ─────────

describe.each(DNONE_THEMES)("runSearch pipeline [%s]", (theme) => {
  async function boot(overrides, cfg = FULL_CFG) {
    const flow = await loadSearchFlow(theme, cfg);
    installDispatch(flow.get, overrides);
    mountBody(SEARCH_FIXTURE);
    flow.mod._state.q = "foo";
    return flow;
  }

  it("renders one card per hit and clears the loading + error indicators", async () => {
    const { mod } = await boot();
    await mod.runSearch();
    await settle();

    expect(document.getElementById("results").children.length).toBe(SAMPLE_DOCS.length);
    expect(document.getElementById("results").textContent).toContain("Doc One");
    expect(document.getElementById("results").textContent).toContain("Doc Two");
    expect(document.getElementById("empty-state").classList.contains("d-none")).toBe(true);
    expect(document.getElementById("search-loading").classList.contains("d-none")).toBe(true);
    expect(document.getElementById("search-error").classList.contains("d-none")).toBe(true);
  });

  it("populates the results-status banner and the hidden queryId/rt fields", async () => {
    const { mod } = await boot();
    await mod.runSearch();
    await settle();
    expect(document.getElementById("results-status").textContent.length).toBeGreaterThan(0);
    expect(document.getElementById("queryId").value).toBe("qid-1");
    expect(document.getElementById("rt").value).toBe("1700000000000");
  });

  it("requests /search with the label facet field and an abort signal", async () => {
    const { mod, get } = await boot();
    await mod.runSearch();
    await settle();
    const call = get.mock.calls.find((c) => c[0] === "/search");
    expect(call).toBeTruthy();
    // All nine send q/start/num and request the label field facet. (mosaic and
    // semanticlens no longer request facet.query counts, so that param is STD-only.)
    expect(call[1]).toMatchObject({
      q: "foo", start: 0, num: 10,
      "facet.field": ["label"],
    });
    expect(call[2]).toHaveProperty("signal");
  });

  it("dispatches fess:search:after with the envelope", async () => {
    const { mod } = await boot();
    let detail = null;
    const onAfter = (e) => { detail = e.detail; };
    document.addEventListener("fess:search:after", onAfter);
    await mod.runSearch();
    await settle();
    document.removeEventListener("fess:search:after", onAfter);
    expect(detail).not.toBeNull();
    expect(detail.query_id).toBe("qid-1");
  });

  it("shows the timeout warning when the search timed out", async () => {
    const { mod } = await boot({ search: makeSearchEnv(SAMPLE_DOCS, { partial: true, timed_out: true }) });
    await mod.runSearch();
    await settle();
    const warn = document.getElementById("results-warning");
    expect(warn.classList.contains("d-none")).toBe(false);
    expect(warn.textContent).toBe("labels.process_time_is_exceeded");
  });

  it("does not call a shard failure a timeout", async () => {
    const { mod } = await boot({ search: makeSearchEnv(SAMPLE_DOCS, { partial: true, shard_failed: true }) });
    await mod.runSearch();
    await settle();
    const warn = document.getElementById("results-warning");
    expect(warn.classList.contains("d-none")).toBe(false);
    expect(warn.textContent).toBe("labels.search_partially_failed");
  });

  it("shows both warnings when a timeout and a shard failure coincide", async () => {
    const { mod } = await boot({ search: makeSearchEnv(SAMPLE_DOCS, { partial: true, timed_out: true, shard_failed: true }) });
    await mod.runSearch();
    await settle();
    expect(document.getElementById("results-warning").textContent)
      .toBe("labels.process_time_is_exceeded labels.search_partially_failed");
  });

  it("does not call a partial result a timeout when no cause is given", async () => {
    const { mod } = await boot({ search: makeSearchEnv(SAMPLE_DOCS, { partial: true }) });
    await mod.runSearch();
    await settle();
    const warn = document.getElementById("results-warning");
    expect(warn.classList.contains("d-none")).toBe(false);
    expect(warn.textContent).toBe("labels.search_partially_failed");
  });

  it("hides the partial-results warning when the result is complete", async () => {
    const { mod } = await boot();
    document.getElementById("results-warning").classList.remove("d-none");
    await mod.runSearch();
    await settle();
    expect(document.getElementById("results-warning").classList.contains("d-none")).toBe(true);
  });

  it("renders zero-result state: empty shown, results list and status cleared", async () => {
    const { mod } = await boot({ search: makeSearchEnv([]) });
    await mod.runSearch();
    await settle();
    expect(document.getElementById("results").children.length).toBe(0);
    expect(document.getElementById("empty-state").classList.contains("d-none")).toBe(false);
    expect(document.getElementById("empty-did-not-match").textContent).toBe("search.did_not_match");
    expect(document.getElementById("results-status").textContent).toBe("");
  });

  it("shows error.server in the visible banner for a generic failure", async () => {
    const { mod, get } = await boot();
    get.mockRejectedValueOnce(new Error("boom"));
    await mod.runSearch();
    const errBox = document.getElementById("search-error");
    expect(errBox.textContent).toBe("error.server");
    expect(errBox.classList.contains("d-none")).toBe(false);
    expect(document.getElementById("search-loading").classList.contains("d-none")).toBe(true);
  });

  it("surfaces the invalid_request message verbatim", async () => {
    const { mod, get } = await boot();
    get.mockRejectedValueOnce(Object.assign(new Error("bad query"), { code: "invalid_request" }));
    await mod.runSearch();
    const errBox = document.getElementById("search-error");
    expect(errBox.textContent).toBe("bad query");
    expect(errBox.classList.contains("d-none")).toBe(false);
  });

  it("shows error.network for a NetworkError", async () => {
    const { mod, get } = await boot();
    get.mockRejectedValueOnce(Object.assign(new Error("net"), { name: "NetworkError" }));
    await mod.runSearch();
    expect(document.getElementById("search-error").textContent).toBe("error.network");
  });

  it("swallows an AbortError without showing the error banner", async () => {
    const { mod, get } = await boot();
    get.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await mod.runSearch();
    const errBox = document.getElementById("search-error");
    expect(errBox.classList.contains("d-none")).toBe(true);
    expect(errBox.textContent).toBe("");
  });

  it("hydrates state from a full URL and issues the search via runFromUrl", async () => {
    const { mod, get, navigate } = await boot();
    setLocation("/search?q=bar&start=20&num=50&sort=x");
    mod.runFromUrl();
    await settle();
    expect(mod._state.q).toBe("bar");
    expect(mod._state.start).toBe(20);
    expect(mod._state.num).toBe(50);
    expect(navigate).not.toHaveBeenCalled();
    const call = get.mock.calls.find((c) => c[0] === "/search");
    expect(call).toBeTruthy();
    expect(call[1]).toMatchObject({ q: "bar", start: 20, num: 50, sort: "x" });
  });

  it("returns home via navigate for a query-less URL", async () => {
    const { mod, get, navigate } = await boot();
    setLocation("/search?num=10");
    mod.runFromUrl();
    await settle();
    expect(navigate).toHaveBeenCalledWith("./", { replace: true });
    expect(get.mock.calls.some((c) => c[0] === "/search")).toBe(false);
  });

  it("re-runs the current search on refresh()", async () => {
    const { mod, get } = await boot();
    mod.refresh();
    await settle();
    expect(get.mock.calls.some((c) => c[0] === "/search")).toBe(true);
    expect(document.getElementById("results").children.length).toBe(SAMPLE_DOCS.length);
  });
});

// ─── Facet / pagination / chip DOM on the six bootstrap-facet themes ─────────────

describe.each(STD_THEMES)("runSearch facet & pagination render [%s]", (theme) => {
  async function boot(overrides, cfg = FULL_CFG) {
    const flow = await loadSearchFlow(theme, cfg);
    installDispatch(flow.get, overrides);
    mountBody(SEARCH_FIXTURE);
    flow.mod._state.q = "foo";
    return flow;
  }

  it("renders the label facet group and the filetype query view, suppressing zero counts", async () => {
    const { mod } = await boot();
    await mod.runSearch();
    await settle();
    const body = document.getElementById("facet-body");
    expect(body.classList.contains("d-md-block")).toBe(true);
    const groups = body.querySelectorAll("ul.list-group");
    expect(groups.length).toBe(2); // label field + filetype query view
    expect(body.textContent).toContain("Label A");
    expect(body.textContent).toContain("Label B");
    expect(body.textContent).not.toContain("lblZ");            // zero count suppressed
    expect(body.textContent).toContain("labels.facet_filetype_html");
    expect(body.textContent).not.toContain("labels.facet_filetype_pdf"); // count 0
    // No active filter → clear button hidden.
    expect(document.getElementById("facet-clear").classList.contains("d-none")).toBe(true);
  });

  it("mirrors the facet groups into the mobile offcanvas", async () => {
    const { mod } = await boot();
    await mod.runSearch();
    await settle();
    expect(document.getElementById("facet-body-mobile").querySelectorAll("ul.list-group").length).toBe(2);
  });

  it("renders pagination: disabled prev, five numbered pages, enabled next", async () => {
    const { mod } = await boot();
    await mod.runSearch();
    await settle();
    expect(document.getElementById("subfooter").classList.contains("d-none")).toBe(false);
    const items = document.querySelectorAll("#pagination > li");
    expect(items.length).toBe(7); // prev + 5 + next
    expect(items[0].className).toContain("disabled");                 // prev
    expect(items[items.length - 1].className).not.toContain("disabled"); // next
  });

  it("requests facet.query counts for the configured facet-query views", async () => {
    const { mod, get } = await boot();
    await mod.runSearch();
    await settle();
    const call = get.mock.calls.find((c) => c[0] === "/search");
    expect(call[1]["facet.query"]).toEqual(["filetype:html", "filetype:pdf"]);
  });

  it("renders related queries", async () => {
    const { mod } = await boot();
    await mod.runSearch();
    await settle();
    const rq = document.getElementById("related-queries");
    expect(rq.classList.contains("d-none")).toBe(false);
    expect(rq.textContent).toContain("rq1");
  });

  it("hides the facet sidebar and pagination on a zero-result search", async () => {
    const { mod } = await boot({ search: makeSearchEnv([]) });
    await mod.runSearch();
    await settle();
    expect(document.getElementById("facet-body").classList.contains("d-md-block")).toBe(false);
    expect(document.getElementById("facet-toggle-wrap").classList.contains("d-none")).toBe(true);
    expect(document.getElementById("subfooter").classList.contains("d-none")).toBe(true);
  });

  it("re-runs the search and toggles a facet value when a facet entry is clicked", async () => {
    const { mod, get } = await boot();
    await mod.runSearch();
    await settle();
    const before = searchCalls(get);
    document.querySelector("#facet-body ul li.list-group-item a").click();
    await settle();
    expect(searchCalls(get)).toBe(before + 1);
    expect(mod._state.facets.label).toContain("lblA");
    expect(mod._state.start).toBe(0);
  });

  it("advances the page offset and re-runs when the next link is clicked", async () => {
    const { mod, get } = await boot({
      search: makeSearchEnv(SAMPLE_DOCS, { prev_page: true, next_page: true, page_number: 2 }),
    });
    mod._state.start = 10;
    await mod.runSearch();
    await settle();
    const before = searchCalls(get);
    document.querySelector("#pagination li:last-child a").click();
    await settle();
    expect(searchCalls(get)).toBe(before + 1);
    expect(mod._state.start).toBe(20);
  });
});

// ─── start= in the address bar (JSP parity: the paging links carried start=) ─────

describe.each(DNONE_THEMES)("page offset in the URL [%s]", (theme) => {
  async function boot(overrides) {
    const flow = await loadSearchFlow(theme, FULL_CFG);
    installDispatch(flow.get, overrides);
    mountBody(SEARCH_FIXTURE);
    flow.mod._state.q = "foo";
    return flow;
  }

  it("pushes the page offset into the URL without re-dispatching the route", async () => {
    setLocation("/search?q=foo&start=10&num=10");
    const { mod, get, navigate } = await boot({
      search: makeSearchEnv(SAMPLE_DOCS, { prev_page: true, next_page: true, page_number: 2 }),
    });
    mod._state.start = 10;
    await mod.runSearch();
    await settle();
    const before = searchCalls(get);
    const historyLength = history.length;
    document.querySelector("#pagination li:last-child a").click();
    await settle();
    const params = new URLSearchParams(location.search);
    expect(location.pathname).toBe("/search");
    expect(params.get("start")).toBe("20");
    expect(params.get("q")).toBe("foo");
    expect(history.length).toBe(historyLength + 1);
    // One fetch: the URL is pushed directly, not via navigate() -> runFromUrl(),
    // which would also clear the in-memory facet selections.
    expect(navigate).not.toHaveBeenCalled();
    expect(searchCalls(get)).toBe(before + 1);
  });

  it("corrects a stale start= in place when a search runs from the first page", async () => {
    setLocation("/search?q=foo&start=20");
    const { mod } = await boot();
    const historyLength = history.length;
    mod._state.start = 0;
    await mod.runSearch();
    await settle();
    expect(location.search).toBe("?q=foo");
    // A filter change is not a new page in history.
    expect(history.length).toBe(historyLength);
  });
});

describe.each(STD_THEMES)("page offset in the URL on a facet click [%s]", (theme) => {
  it("drops start from the URL when a facet click resets to the first page", async () => {
    setLocation("/search?q=foo&start=20");
    const flow = await loadSearchFlow(theme, FULL_CFG);
    installDispatch(flow.get);
    mountBody(SEARCH_FIXTURE);
    flow.mod._state.q = "foo";
    flow.mod._state.start = 20;
    await flow.mod.runSearch();
    await settle();
    const historyLength = history.length;
    document.querySelector("#facet-body ul li.list-group-item a").click();
    await settle();
    expect(flow.mod._state.start).toBe(0);
    expect(location.search).toBe("?q=foo&ex_q=label%3AlblA");
    expect(history.length).toBe(historyLength);
  });
});

// ─── Search-options drawer keeps the URL's filters ──────────────────────────────
// Changing the sort from the drawer's Search button must not drop the ex_q clauses the
// results were narrowed by (a sidebar label facet, a facet query view).

describe.each(DNONE_THEMES)("search-options drawer Search [%s]", (theme) => {
  it("keeps the URL's ex_q clauses when the sort is changed", async () => {
    setLocation("/search?q=fess&ex_q=label%3AlblA&ex_q=filetype%3Ahtml&start=20");
    const flow = await loadSearchFlow(theme, FULL_CFG);
    installDispatch(flow.get);
    mountBody(SEARCH_FIXTURE + '<div id="searchOptions"><button type="submit">go</button></div>');
    flow.mod.attach();
    await settle();
    document.getElementById("home-view").setAttribute("hidden", "");
    document.getElementById("query").value = "fess";
    document.getElementById("sortSearchOption").value = "last_modified.desc";
    flow.navigate.mockClear();
    document.querySelector('#searchOptions button[type="submit"]').click();
    const target = flow.navigate.mock.calls.at(-1)[0];
    const params = new URLSearchParams(target.slice(target.indexOf("?") + 1));
    expect(params.get("q")).toBe("fess");
    expect(params.get("sort")).toBe("last_modified.desc");
    expect(params.getAll("ex_q")).toEqual(["label:lblA", "filetype:html"]);
    expect(params.has("start")).toBe(false);
  });
});

// ─── Facet selections in the URL ────────────────────────────────────────────────
// A sidebar facet click writes its ex_q clause to the address bar, so a reload, a shared
// link, Back from a result, or the drawer's Search button (which copies the URL's ex_q)
// keeps the filter; runFromUrl() sorts the URL's clauses back into the facet stores so
// the restored selection renders active and a click removes it again.

describe.each(DNONE_THEMES)("facet selections in the URL [%s]", (theme) => {
  const lastSearch = (get) => get.mock.calls.filter((c) => c[0] === "/search").at(-1)[1];
  const labelFacet = (text) =>
    [...document.querySelectorAll("#facet-body ul.list-group li.list-group-item")]
      .find((li) => li.textContent.startsWith(text));

  it("keeps a clicked label facet through the drawer's Search and a reload", async () => {
    setLocation("/search?q=fess");
    const flow = await loadSearchFlow(theme, FULL_CFG);
    installDispatch(flow.get);
    mountBody(SEARCH_FIXTURE + '<div id="searchOptions"><button type="submit">go</button></div>');
    flow.mod.attach();
    flow.mod.runFromUrl();
    await settle();
    document.getElementById("home-view").setAttribute("hidden", "");

    labelFacet("Label A").querySelector("a").click();
    await settle();
    expect(lastSearch(flow.get)["ex_q"]).toEqual(["label:lblA"]);
    expect(new URLSearchParams(location.search).getAll("ex_q")).toEqual(["label:lblA"]);

    // Change the sort in the drawer and press its Search button.
    document.getElementById("sortSearchOption").value = "last_modified.desc";
    flow.navigate.mockClear();
    document.querySelector('#searchOptions button[type="submit"]').click();
    const target = flow.navigate.mock.calls.at(-1)[0];
    const params = new URLSearchParams(target.slice(target.indexOf("?") + 1));
    expect(params.get("sort")).toBe("last_modified.desc");
    expect(params.getAll("ex_q")).toEqual(["label:lblA"]);

    // The router lands on that URL: the facet is still applied and shown active.
    setLocation("/" + target);
    flow.mod.runFromUrl();
    await settle();
    expect(flow.mod._state.facets).toEqual({ label: ["lblA"] });
    expect(flow.mod._state.exQ).toEqual([]);
    expect(lastSearch(flow.get)).toMatchObject({ sort: "last_modified.desc", ex_q: ["label:lblA"] });
    expect(labelFacet("Label A").classList.contains("active")).toBe(true);

    // Clicking the restored facet removes it from the request and the URL.
    labelFacet("Label A").querySelector("a").click();
    await settle();
    expect(lastSearch(flow.get)).not.toHaveProperty("ex_q");
    expect(new URLSearchParams(location.search).has("ex_q")).toBe(false);
  });

  it("sorts the URL's ex_q clauses back into the facet stores", async () => {
    setLocation("/search?q=foo&ex_q=label%3AlblB&ex_q=filetype%3Ahtml"
      + "&ex_q=timestamp%3A%5Bnow%2Fd-1d+TO+*%5D&ex_q=label%3AlblB");
    const flow = await loadSearchFlow(theme, { ...FULL_CFG, filetype_options: [{ value: "pdf" }] });
    installDispatch(flow.get);
    mountBody(SEARCH_FIXTURE);
    flow.mod.runFromUrl();
    await settle();
    expect(flow.mod._state.facets).toEqual({ label: ["lblB"] });
    expect(flow.mod._state.facetQueries).toEqual(["filetype:html"]);
    expect(flow.mod._state.exQ).toEqual(["timestamp:[now/d-1d TO *]"]);
    expect(labelFacet("Label B").classList.contains("active")).toBe(true);
    expect(flow.navigate).not.toHaveBeenCalled();
  });

  it("runs a search for a URL carrying only a facet selection", async () => {
    setLocation("/search?ex_q=label%3AlblA");
    const flow = await loadSearchFlow(theme, FULL_CFG);
    installDispatch(flow.get);
    mountBody(SEARCH_FIXTURE);
    flow.mod.runFromUrl();
    await settle();
    expect(flow.navigate).not.toHaveBeenCalled();
    expect(lastSearch(flow.get)["ex_q"]).toEqual(["label:lblA"]);
  });
});

describe.each(STD_THEMES)("facet query views in the URL [%s]", (theme) => {
  it("writes a facet query view to the URL and restores it as active", async () => {
    setLocation("/search?q=foo");
    const flow = await loadSearchFlow(theme, FULL_CFG);
    installDispatch(flow.get);
    mountBody(SEARCH_FIXTURE);
    flow.mod.runFromUrl();
    await settle();
    const row = () => [...document.querySelectorAll("#facet-body li.list-group-item")]
      .find((li) => li.textContent.startsWith("labels.facet_filetype_html"));
    row().querySelector("a").click();
    await settle();
    expect(new URLSearchParams(location.search).getAll("ex_q")).toEqual(["filetype:html"]);

    flow.mod.runFromUrl();
    await settle();
    expect(flow.mod._state.facetQueries).toEqual(["filetype:html"]);
    expect(flow.mod._state.exQ).toEqual([]);
    expect(row().classList.contains("active")).toBe(true);
  });
});

// mosaic, semanticlens and storefront draw File type from filetype_options, not facet_views.
describe.each(["mosaic", "semanticlens", "storefront"])("filter groups in the URL [%s]", (theme) => {
  it("writes a File type option to the URL and restores it as active", async () => {
    setLocation("/search?q=foo");
    const cfg = { ...FULL_CFG, filetype_options: [{ value: "pdf" }] };
    const flow = await loadSearchFlow(theme, cfg);
    installDispatch(flow.get, {
      search: makeSearchEnv(SAMPLE_DOCS, { facet_query: [{ value: "filetype:pdf", count: 4 }] }),
    });
    mountBody(SEARCH_FIXTURE);
    flow.mod.runFromUrl();
    await settle();
    const row = () => [...document.querySelectorAll("#facet-body .filter-group .filter-opt")]
      .find((li) => li.querySelector(".filter-opt__label")?.textContent === "pdf");
    row().click();
    await settle();
    expect(new URLSearchParams(location.search).getAll("ex_q")).toEqual(["filetype:pdf"]);

    flow.mod.runFromUrl();
    await settle();
    expect(flow.mod._state.facetQueries).toEqual(["filetype:pdf"]);
    expect(flow.mod._state.exQ).toEqual([]);
    expect(row().classList.contains("is-active")).toBe(true);
  });
});

// ─── /go/ click-log order: the 0-based position on the page (JSP parity) ─────────
// searchResults.jsp sent ${s.index} — the 0-based loop index within the page, the
// same value as the link's data-order — and GoAction stores it as ClickLog.order.

const orderOf = (a) => new URL(a.getAttribute("href"), "http://localhost/").searchParams.get("order");

describe.each(DNONE_THEMES)("/go/ click-log order [%s]", (theme) => {
  it("sends the 0-based position on the page, the same value as data-order", async () => {
    const flow = await loadSearchFlow(theme, FULL_CFG);
    installDispatch(flow.get);
    mountBody(SEARCH_FIXTURE);
    flow.mod._state.q = "foo";
    // mosaic defaults to its gallery grid, whose tiles open the lightbox instead.
    if (theme === "mosaic") flow.mod._state.viewMode = "list";
    // A later page: the order is the position on this page, not the overall rank.
    flow.mod._state.start = 10;
    await flow.mod.runSearch();
    await settle();

    const cards = [...document.getElementById("results").children];
    expect(cards.length).toBe(SAMPLE_DOCS.length);
    cards.forEach((card, i) => {
      const links = [...card.querySelectorAll('a[href^="go/"]')];
      expect(links.length).toBeGreaterThan(0);
      for (const a of links) {
        expect(orderOf(a)).toBe(String(i));
        if (a.hasAttribute("data-order")) expect(a.getAttribute("data-order")).toBe(String(i));
      }
    });
  });
});

describe("/go/ click-log order [mosaic lightbox]", () => {
  it("sends the tile's 0-based position from the lightbox's open-original link", async () => {
    const flow = await loadSearchFlow("mosaic", FULL_CFG);
    installDispatch(flow.get);
    mountBody(SEARCH_FIXTURE);
    // The lightbox markup mosaic's index.html ships.
    document.getElementById("lightbox").innerHTML =
      '<button class="lightbox__close" data-lb="close"></button>' +
      '<button class="lightbox__nav lightbox__prev" data-lb="prev"></button>' +
      '<figure class="lightbox__figure"><img class="lightbox__img" alt="">' +
      '<figcaption class="lightbox__meta"></figcaption></figure>' +
      '<button class="lightbox__nav lightbox__next" data-lb="next"></button>';
    flow.mod._state.q = "foo";
    flow.mod.attach();
    await flow.mod.runSearch();
    await settle();

    const tiles = [...document.querySelectorAll("#results .tile")];
    expect(tiles.length).toBe(SAMPLE_DOCS.length);
    tiles[1].click();
    const a = document.querySelector("#lightbox .lightbox__link");
    expect(orderOf(a)).toBe("1");
  });
});

describe("/go/ click-log order [codesearch]", () => {
  it("sends the 0-based position for a file-system result routed through /go/", async () => {
    const flow = await loadSearchFlow("codesearch", FULL_CFG);
    const fileDoc = (id) => ({ doc_id: id, title: id, content_title: id, url: `file:///share/${id}.txt` });
    installDispatch(flow.get, { search: makeSearchEnv([fileDoc("f1"), fileDoc("f2")]) });
    mountBody(SEARCH_FIXTURE);
    flow.mod._state.q = "foo";
    await flow.mod.runSearch();
    await settle();

    const links = [...document.querySelectorAll('#results a[href^="go/"]')];
    expect(links.map(orderOf)).toEqual(["0", "1"]);
  });
});

// ─── Related content via the /related-content endpoint (STD minus helpdesk) ──────
// helpdesk reads related queries/content off the search envelope instead of the
// standalone endpoints, so the endpoint-driven content path is the other five.
const ENDPOINT_RELATED_THEMES = STD_THEMES.filter((t) => t !== "helpdesk");

describe.each(ENDPOINT_RELATED_THEMES)("runSearch related content [%s]", (theme) => {
  it("fetches and renders sanitized related content", async () => {
    const flow = await loadSearchFlow(theme, FULL_CFG);
    installDispatch(flow.get);
    mountBody(SEARCH_FIXTURE);
    flow.mod._state.q = "foo";
    await flow.mod.runSearch();
    await settle();
    const rc = document.getElementById("related-content");
    expect(rc.classList.contains("d-none")).toBe(false);
    expect(rc.textContent).toContain("related");
    // and the endpoint was actually hit
    expect(flow.get.mock.calls.some((c) => c[0] === "/related-content")).toBe(true);
  });
});

// ─── Active filters: chips, current-filter badges and the reset control (STD) ────

describe.each(STD_THEMES)("runSearch active filters [%s]", (theme) => {
  async function bootFiltered() {
    const flow = await loadSearchFlow(theme, FULL_CFG);
    installDispatch(flow.get, { search: makeSearchEnv([{ doc_id: "d1", title: "T", url: "https://e.com/1" }]) });
    mountBody(SEARCH_FIXTURE);
    const s = flow.mod._state;
    s.q = "foo";
    s.sort = "last_modified.desc";
    s.num = 50;
    s.lang = ["ja"];
    s.fields = { label: ["lblB"] };
    s.facets = { label: ["lblA"] };
    s.facetQueries = ["filetype:html"];
    return flow;
  }

  it("renders an active chip per applied filter", async () => {
    const { mod } = await bootFiltered();
    await mod.runSearch();
    await settle();
    const chips = document.getElementById("active-chips");
    expect(chips.classList.contains("d-none")).toBe(false);
    const text = chips.textContent;
    expect(text).toContain("lblA");
    expect(text).toContain("lblB");
  });

  it("removes a filter and re-runs when a chip remove button is clicked", async () => {
    const { mod, get } = await bootFiltered();
    await mod.runSearch();
    await settle();
    const before = searchCalls(get);
    document.querySelector("#active-chips .active-chip-remove").click();
    await settle();
    expect(searchCalls(get)).toBe(before + 1);
  });

  it("renders current-filters badges for sort, non-default num, lang and label", async () => {
    const { mod } = await bootFiltered();
    await mod.runSearch();
    await settle();
    const badges = document.querySelectorAll("#current-filters > li");
    expect(badges.length).toBe(4);
    const text = document.getElementById("current-filters").textContent;
    expect(text).toContain("labels.search_result_sort_last_modified_desc");
    expect(text).toContain("labels.lang_ja");
    expect(text).toContain("Label B");
  });

  it("renders a facet-reset link that clears filters and re-runs when clicked", async () => {
    const { mod, get } = await bootFiltered();
    await mod.runSearch();
    await settle();
    // These themes reset filters via a .facet-reset link at the foot of the sidebar
    // (rendered only when a filter is active), not the bootstrap #facet-clear button.
    const reset = document.querySelector("#facet-body .facet-reset");
    expect(reset).not.toBeNull();
    const before = searchCalls(get);
    reset.click();
    await settle();
    expect(searchCalls(get)).toBe(before + 1);
    expect(mod._state.facets).toEqual({});
    expect(mod._state.facetQueries).toEqual([]);
  });

  it("marks the active facet entries with the active class", async () => {
    const { mod } = await bootFiltered();
    await mod.runSearch();
    await settle();
    const active = document.querySelectorAll("#facet-body li.list-group-item.active");
    expect(active.length).toBeGreaterThanOrEqual(2); // lblA facet + filetype:html query view
  });
});

// ─── Favorites + similar docs (STD, feature-gated) ───────────────────────────────

describe.each(STD_THEMES)("runSearch favorites & similar docs [%s]", (theme) => {
  it("renders the favorite star, syncs favorited state and toggles on click", async () => {
    const cfg = { ...FULL_CFG, features: { ...FULL_CFG.features, user_favorite: true } };
    const flow = await loadSearchFlow(theme, cfg);
    flow.isAuthenticated.mockReturnValue(true);
    installDispatch(flow.get, {
      search: makeSearchEnv([{ doc_id: "d1", title: "T", url: "https://e.com/1", favorite_count: 2 }]),
      favorites: ["d1"],
    });
    flow.post.mockResolvedValue({ favorite: false, count: 1 });
    mountBody(SEARCH_FIXTURE);
    flow.mod._state.q = "foo";
    await flow.mod.runSearch();
    await settle();

    const btn = document.querySelector(".favorite-btn");
    expect(btn).not.toBeNull();
    expect(btn.getAttribute("aria-pressed")).toBe("true"); // syncFavorites flipped it on
    btn.click();
    await settle();
    const call = flow.post.mock.calls.find((c) => c[0].includes("/documents/d1/favorite"));
    expect(call).toBeTruthy();
  });

  it("shows the similar-doc banner when state.sdh is set and clears it on close", async () => {
    const flow = await loadSearchFlow(theme, FULL_CFG);
    installDispatch(flow.get, { search: makeSearchEnv([{ doc_id: "d1", title: "T", url: "https://e.com/1" }]) });
    mountBody(SEARCH_FIXTURE);
    flow.mod._state.q = "foo";
    flow.mod._state.sdh = "hash-1";
    await flow.mod.runSearch();
    await settle();
    const banner = document.getElementById("similar-doc-banner");
    expect(banner.textContent).toContain("labels.similar_doc_result_status");
    const before = searchCalls(flow.get);
    banner.querySelector("button.btn-close").click();
    await settle();
    expect(flow.mod._state.sdh).toBe("");
    expect(searchCalls(flow.get)).toBe(before + 1);
  });
});

// ─── codesearch: its own renderSummary / `hidden` / two-arg card contract ─────────

describe("runSearch pipeline [codesearch]", () => {
  async function boot(overrides, cfg = FULL_CFG) {
    const flow = await loadSearchFlow("codesearch", cfg);
    installDispatch(flow.get, overrides);
    mountBody(SEARCH_FIXTURE);
    flow.mod._state.q = "foo";
    return flow;
  }

  it("renders one card per hit and fills the result summary", async () => {
    const { mod } = await boot();
    await mod.runSearch();
    await settle();
    expect(document.getElementById("results").children.length).toBe(SAMPLE_DOCS.length);
    expect(document.getElementById("results").textContent).toContain("Doc One");
    expect(document.getElementById("result-summary").textContent.length).toBeGreaterThan(0);
    expect(document.getElementById("empty-state").hidden).toBe(true);
  });

  it("requests /search with the codesearch facet fields and dispatches fess:search:after", async () => {
    const { mod, get } = await boot();
    let fired = false;
    const onAfter = () => { fired = true; };
    document.addEventListener("fess:search:after", onAfter);
    await mod.runSearch();
    await settle();
    document.removeEventListener("fess:search:after", onAfter);
    const call = get.mock.calls.find((c) => c[0] === "/search");
    expect(call[1]).toMatchObject({ q: "foo", start: 0 }); // codesearch defaults num to 20
    expect(call[1]["facet.field"]).toContain("repository");
    expect(fired).toBe(true);
  });

  it("opens the first facet group and every group holding a checked value", async () => {
    const facet_field = [
      { name: "repository", result: [{ value: "fess", count: 3 }] },
      { name: "filetype", result: [{ value: "java", count: 2 }, { value: "js", count: 1 }] },
      { name: "organization", result: [{ value: "codelibs", count: 3 }] },
    ];
    const { mod } = await boot({ search: makeSearchEnv(SAMPLE_DOCS, { facet_field }) });
    document.getElementById("query-input").value = "foo lang:java";
    await mod.runSearch();
    await settle();
    const groups = [...document.querySelectorAll("#facet-rail details.facet-group")];
    expect(groups.map((d) => d.open)).toEqual([true, true, false]);
    const checked = [...groups[1].querySelectorAll(".facet-check")].map((c) => c.checked);
    expect(checked).toEqual([true, false]);
  });

  it("renders the zero-result empty state via the hidden attribute", async () => {
    const { mod } = await boot({ search: makeSearchEnv([]) });
    await mod.runSearch();
    await settle();
    expect(document.getElementById("results").children.length).toBe(0);
    expect(document.getElementById("empty-state").hidden).toBe(false);
  });

  it("shows error.server in the banner and clears results on a generic failure", async () => {
    const { mod, get } = await boot();
    get.mockRejectedValueOnce(new Error("boom"));
    await mod.runSearch();
    const errBox = document.getElementById("search-error");
    expect(errBox.textContent).toBe("error.server");
    expect(errBox.hidden).toBe(false);
    expect(document.getElementById("results").children.length).toBe(0);
  });

  it("hydrates state from a full URL and issues the search via runFromUrl", async () => {
    const { mod, get, navigate } = await boot();
    setLocation("/search?q=bar&start=20&num=50&sort=x");
    mod.runFromUrl();
    await settle();
    expect(mod._state.q).toBe("bar");
    expect(mod._state.start).toBe(20);
    expect(navigate).not.toHaveBeenCalled();
    expect(get.mock.calls.some((c) => c[0] === "/search")).toBe(true);
  });
});

// ─── Type-ahead suggest across every theme (attachSuggest) ───────────────────────
// attachSuggest shares one contract across the ten themes: a 150ms debounce, a
// GET /suggest-words with { q, num, fn }, and a role="option" item per suggestion
// with aria-expanded on the input. Only the dropdown/item CSS class names differ
// (codesearch uses visually-hidden/suggest-item vs the others' d-none/list-group-item),
// so the assertions target the class-agnostic surface.
const ALL_THEMES = [...DNONE_THEMES, "codesearch"];

describe.each(ALL_THEMES)("attachSuggest [%s]", (theme) => {
  afterEach(() => vi.useRealTimers());

  function mountSuggest() {
    mountBody('<form><input id="sg"><ul id="sgd" class="d-none visually-hidden"></ul></form>');
    return { input: document.getElementById("sg"), dd: document.getElementById("sgd") };
  }

  it("renders one role=option item per suggestion after the debounce and marks aria-expanded", async () => {
    vi.useFakeTimers();
    const { mod, get } = await loadSearchFlow(theme, {});
    get.mockResolvedValue({ suggest_words: [{ text: "sug1" }, { text: "sug2" }] });
    const { input, dd } = mountSuggest();
    mod.attachSuggest(input, dd);
    input.value = "he";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(150);

    const items = dd.querySelectorAll('[role="option"]');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("sug1");
    expect(items[0].id).toBe("sg-suggest-0");
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  it("requests /suggest-words with the debounced query and default fields", async () => {
    vi.useFakeTimers();
    const { mod, get } = await loadSearchFlow(theme, {});
    get.mockResolvedValue({ suggest_words: [{ text: "x" }] });
    const { input, dd } = mountSuggest();
    mod.attachSuggest(input, dd);
    input.value = "  foo  ";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(150);
    const call = get.mock.calls.find((c) => c[0] === "/suggest-words");
    expect(call).toBeTruthy();
    expect(call[1]).toMatchObject({ q: "foo", num: 10, fn: ["_default", "content", "title"] });
  });

  it("does not query and stays collapsed for an empty input", async () => {
    vi.useFakeTimers();
    const { mod, get } = await loadSearchFlow(theme, {});
    get.mockResolvedValue({ suggest_words: [{ text: "x" }] });
    const { input, dd } = mountSuggest();
    mod.attachSuggest(input, dd);
    input.value = "";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(150);
    expect(dd.querySelectorAll('[role="option"]').length).toBe(0);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(get.mock.calls.some((c) => c[0] === "/suggest-words")).toBe(false);
  });

  it("fills the input on mousedown-select", async () => {
    vi.useFakeTimers();
    const { mod, get } = await loadSearchFlow(theme, {});
    get.mockResolvedValue({ suggest_words: [{ text: "picked" }] });
    const { input, dd } = mountSuggest();
    mod.attachSuggest(input, dd);
    input.value = "pi";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(150);
    dd.querySelector('[role="option"]').dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(input.value).toBe("picked");
  });

  it("is a no-op when input or dropdown is missing", async () => {
    const { mod } = await loadSearchFlow(theme, {});
    expect(() => mod.attachSuggest(null, document.createElement("ul"))).not.toThrow();
    expect(() => mod.attachSuggest(document.createElement("input"), null)).not.toThrow();
  });
});

// ─── codesearch header suggest, driven through attach() ─────────────────────────
// The block above exercises attachSuggest directly; nothing there routes through
// attach(), so reverting the wiring left the whole suite green. These cases mount
// the SHIPPED index.html body (not the superset fixture) and call attach(), so the
// markup contract — the <ul> living inside <form id="search-bar"> so choose()'s
// input.form lookup finds the form, and the combobox ARIA on #query-input — is
// pinned together with the behaviour.
//
// codesearch is the only theme that keeps facets INSIDE the query string
// (the facet checkboxes call addQualifier() back into #query-input), so the two
// query-shaping cases below are codesearch-specific by construction.
describe("codesearch header suggest via attach()", () => {
  afterEach(() => vi.useRealTimers());

  const KEY = (key) => new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });

  async function boot(suggestWords = [{ text: "sug1" }, { text: "sug2" }]) {
    const flow = await loadSearchFlow("codesearch", FULL_CFG);
    installDispatch(flow.get, { suggestWords });
    mountIndexBody("codesearch");
    flow.mod.attach();
    return {
      ...flow,
      input: document.getElementById("query-input"),
      dd: document.getElementById("header-suggest-dropdown"),
    };
  }

  /** Type `value` into the header box and let the 150ms debounce fire. */
  async function type(input, value) {
    input.value = value;
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(150);
  }

  const suggestCalls = (get) => get.mock.calls.filter((c) => c[0] === "/suggest-words");

  it("ships the dropdown inside #search-bar with the combobox ARIA on the input", () => {
    mountIndexBody("codesearch");
    const dd = document.getElementById("header-suggest-dropdown");
    const input = document.getElementById("query-input");
    // choose() submits via input.form, which only resolves inside the <form>.
    expect(dd.closest("form").id).toBe("search-bar");
    expect(dd.getAttribute("role")).toBe("listbox");
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-controls")).toBe("header-suggest-dropdown");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("attach() wires suggest to #query-input and renders one option per word", async () => {
    vi.useFakeTimers();
    const { input, dd } = await boot();
    await type(input, "he");
    const items = dd.querySelectorAll('[role="option"]');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("sug1");
    expect(dd.classList.contains("visually-hidden")).toBe(false);
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  it("sends only the free-text terms, not the facet qualifiers, to /suggest-words", async () => {
    vi.useFakeTimers();
    const { input, get } = await boot();
    // What runFromUrl() puts in the box once a facet checkbox is ticked.
    await type(input, "foo repository:fess -filetype:pdf ba");
    expect(suggestCalls(get)[0][1]).toMatchObject({ q: "foo ba" });
  });

  it("keeps the active qualifiers when a suggestion replaces the terms", async () => {
    vi.useFakeTimers();
    const { input, dd } = await boot([{ text: "foobar" }]);
    await type(input, "foo repository:fess");
    dd.querySelector('[role="option"]')
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(input.value).toBe("foobar repository:fess");
  });

  it("collapses the dropdown on submit and cancels the request the keystroke queued", async () => {
    vi.useFakeTimers();
    const { input, dd, get, navigate } = await boot();
    input.value = "he";
    input.dispatchEvent(new Event("input"));
    // Enter before the 150ms debounce elapses — the ordinary fast-typing case.
    await vi.advanceTimersByTimeAsync(20);
    document.getElementById("search-bar").dispatchEvent(new Event("submit", { cancelable: true }));
    expect(navigate).toHaveBeenCalled();
    // The queued request must never fire, and the dropdown must stay collapsed
    // once the debounce interval has fully elapsed.
    await vi.advanceTimersByTimeAsync(500);
    expect(suggestCalls(get).length).toBe(0);
    expect(dd.classList.contains("visually-hidden")).toBe(true);
  });

  it("stays collapsed when a route change lands before the debounce fires", async () => {
    vi.useFakeTimers();
    const { input, dd, get } = await boot();
    input.value = "he";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(20);
    document.dispatchEvent(new CustomEvent("fess:route:change", { detail: { path: "/help" } }));
    await vi.advanceTimersByTimeAsync(500);
    expect(suggestCalls(get).length).toBe(0);
    expect(dd.classList.contains("visually-hidden")).toBe(true);
  });

  it("does not re-open when an in-flight request resolves after a route change", async () => {
    vi.useFakeTimers();
    // The header form stays mounted on /search and /help, so a response that
    // renders after navigation would park the dropdown over the results list
    // with nothing left to close it.
    let release;
    const flow = await loadSearchFlow("codesearch", FULL_CFG);
    flow.get.mockImplementation((path) => {
      if (path === "/suggest-words") {
        return new Promise((resolve) => { release = () => resolve({ suggest_words: [{ text: "late" }] }); });
      }
      return Promise.resolve({});
    });
    mountIndexBody("codesearch");
    flow.mod.attach();
    const input = document.getElementById("query-input");
    const dd = document.getElementById("header-suggest-dropdown");
    await type(input, "he");
    expect(release).toBeTypeOf("function"); // the request is genuinely in flight

    document.dispatchEvent(new CustomEvent("fess:route:change", { detail: { path: "/help" } }));
    release();
    await vi.advanceTimersByTimeAsync(500);
    expect(dd.querySelectorAll('[role="option"]').length).toBe(0);
    expect(dd.classList.contains("visually-hidden")).toBe(true);
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("ArrowDown highlights an option and points aria-activedescendant at it", async () => {
    vi.useFakeTimers();
    const { input, dd } = await boot();
    await type(input, "he");
    input.dispatchEvent(KEY("ArrowDown"));
    const items = dd.querySelectorAll('[role="option"]');
    expect(items[0].getAttribute("aria-selected")).toBe("true");
    expect(items[0].classList.contains("active")).toBe(true);
    expect(input.getAttribute("aria-activedescendant")).toBe(items[0].id);
    // ArrowUp from the first option wraps to the last.
    input.dispatchEvent(KEY("ArrowUp"));
    expect(items[1].getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(items[1].id);
  });

  it("Enter commits the highlighted option and submits", async () => {
    vi.useFakeTimers();
    const { input, dd, navigate } = await boot();
    await type(input, "he");
    input.dispatchEvent(KEY("ArrowDown"));
    input.dispatchEvent(KEY("Enter"));
    expect(input.value).toBe("sug1");
    expect(dd.classList.contains("visually-hidden")).toBe(true);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("q=sug1"));
  });

  it("leaves keyboard nav inert for a dropdown hidden by d-none", async () => {
    vi.useFakeTimers();
    // advance.js builds its all-words list with a permanent `d-none`
    // (display:none!important) that attachSuggest never removes, so its options
    // render but are invisible — they must not become an ArrowDown/Enter target.
    const { mod, get } = await loadSearchFlow("codesearch", FULL_CFG);
    installDispatch(get);
    mountBody('<form><input id="adv-all"><ul id="adv-all-suggest" class="list-group suggest-dropdown d-none"></ul></form>');
    const input = document.getElementById("adv-all");
    const dd = document.getElementById("adv-all-suggest");
    mod.attachSuggest(input, dd);
    await type(input, "he");
    expect(dd.querySelectorAll('[role="option"]').length).toBeGreaterThan(0);
    input.dispatchEvent(KEY("ArrowDown"));
    expect(dd.querySelector('[role="option"]').getAttribute("aria-selected")).toBe("false");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("Escape dismisses the dropdown without submitting", async () => {
    vi.useFakeTimers();
    const { input, dd, navigate } = await boot();
    await type(input, "he");
    input.dispatchEvent(KEY("Escape"));
    expect(dd.classList.contains("visually-hidden")).toBe(true);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
