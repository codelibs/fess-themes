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

  it("shows the partial-results warning when env.partial is set", async () => {
    const { mod } = await boot({ search: makeSearchEnv(SAMPLE_DOCS, { partial: true }) });
    await mod.runSearch();
    await settle();
    const warn = document.getElementById("results-warning");
    expect(warn.classList.contains("d-none")).toBe(false);
    expect(warn.textContent).toBe("labels.process_time_is_exceeded");
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
    expect(navigate).toHaveBeenCalledWith("/", { replace: true });
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
