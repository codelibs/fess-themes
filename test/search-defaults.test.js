// SPDX-License-Identifier: Apache-2.0
// JSP parity for the search defaults (FessSearchAction.buildFormParams, and SearchAction's
// resultsPerPage session attribute): the user's default labels and sort, and the page size
// remembered for the tab. codesearch takes only the default sort: it filters with query
// qualifiers and pages 20 results at a time.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { resetDom, mountBody, setLocation } from "./helpers/dom.js";
import { SEARCH_FIXTURE, FULL_CFG, installDispatch, settle } from "./helpers/searchFlow.js";

/** Themes with the bootstrap runSearch contract (every theme but codesearch). */
const DNONE_THEMES = [
  "docsearch", "docuforge", "helpdesk", "mosaic",
  "nomadkit", "rawblock", "semanticlens", "storefront", "voicebox",
];
/** Themes whose page-size fallback is their own defaultNum(): page_size_default, num_options[0], 10. */
const DEFAULT_NUM_THEMES = ["mosaic", "storefront"];

const DEFAULTS_CFG = {
  ...FULL_CFG,
  default_label_values: ["lblA"],
  default_sort: "last_modified.desc",
  page_size_default: 20,
  page_size_max: 100,
  num_options: [10, 20, 50],
};

/** The params of the first /search call. */
const searchParams = (get) => get.mock.calls.find((c) => c[0] === "/search")[1];

beforeEach(() => {
  resetDom();
  sessionStorage.clear();
  window.scrollTo = () => {};
});
afterEach(() => setLocation("/"));

describe.each(DNONE_THEMES)("search defaults [%s]", (theme) => {
  async function boot(cfg = DEFAULTS_CFG) {
    const flow = await loadSearchFlow(theme, cfg);
    installDispatch(flow.get);
    mountBody(SEARCH_FIXTURE);
    return flow;
  }

  it("applies the default labels and sort when the URL names none, and shows them in the drawer", async () => {
    const { mod, get } = await boot();
    setLocation("/search?q=foo");
    mod.runFromUrl();
    await settle();
    expect(searchParams(get)["fields.label"]).toEqual(["lblA"]);
    expect(searchParams(get).sort).toBe("last_modified.desc");
    expect(document.getElementById("labelSearchOption").value).toBe("lblA");
    expect(document.getElementById("sortSearchOption").value).toBe("last_modified.desc");
  });

  it("keeps the labels and sort the URL names", async () => {
    const { mod, get } = await boot();
    setLocation("/search?q=foo&fields.label=lblB&sort=score.desc");
    mod.runFromUrl();
    await settle();
    expect(searchParams(get)["fields.label"]).toEqual(["lblB"]);
    expect(searchParams(get).sort).toBe("score.desc");
  });

  it("adds no default label when the URL has an empty fields.label", async () => {
    const { mod, get } = await boot();
    setLocation("/search?q=foo&fields.label=");
    mod.runFromUrl();
    await settle();
    expect(searchParams(get)).not.toHaveProperty(["fields.label"]);
  });

  it("does not turn an empty search into a search by applying defaults", async () => {
    const { mod, get, navigate } = await boot();
    setLocation("/search?sort=");
    mod.runFromUrl();
    await settle();
    expect(navigate).toHaveBeenCalledWith("./", { replace: true });
    expect(get.mock.calls.some((c) => c[0] === "/search")).toBe(false);
  });

  it("remembers an explicit num for the tab and uses it when the URL has none", async () => {
    const { mod, get } = await boot();
    setLocation("/search?q=a&num=50");
    mod.runFromUrl();
    await settle();
    expect(sessionStorage.getItem("fess.search.num")).toBe("50");
    get.mockClear();
    setLocation("/search?q=b");
    mod.runFromUrl();
    await settle();
    expect(searchParams(get).num).toBe(50);
  });

  it("starts from page_size_default when nothing is remembered", async () => {
    const { mod, get } = await boot();
    setLocation("/search?q=a");
    mod.runFromUrl();
    await settle();
    expect(searchParams(get).num).toBe(20);
  });

  it("resetSearchState() pre-selects the default labels, sort and remembered page size", async () => {
    const { mod } = await boot();
    sessionStorage.setItem("fess.search.num", "50");
    mod.resetSearchState();
    expect(mod._state.num).toBe(50);
    expect(mod._state.sort).toBe("last_modified.desc");
    expect(mod._state.fields).toEqual({ label: ["lblA"] });
    expect(document.getElementById("numSearchOption").value).toBe("50");
    expect(document.getElementById("sortSearchOption").value).toBe("last_modified.desc");
    expect(document.getElementById("labelSearchOption").value).toBe("lblA");
  });

  it("resetSearchState() without config starts from 10 with no sort or labels", async () => {
    const { mod } = await boot(null);
    mod.resetSearchState();
    expect(mod._state.num).toBe(10);
    expect(mod._state.sort).toBe("");
    expect(mod._state.fields).toEqual({});
  });

  it("shows no page-size badge for page_size_default", async () => {
    const { mod } = await boot({ ...FULL_CFG, page_size_default: 20 });
    mod._state.q = "foo";
    mod._state.num = 20;
    await mod.runSearch();
    await settle();
    expect(document.getElementById("current-filters").textContent).not.toContain("search.num_format");
  });
});

describe.each(DNONE_THEMES)("initialNum / forgetNum [%s]", (theme) => {
  const CFG = { page_size_default: 20, page_size_max: 100, num_options: [10, 20, 50] };

  it.each([
    ["50", 50],   // an offered size
    ["30", 20],   // rounded down to an offered size
    ["500", 50],  // capped at page_size_max, then rounded down
    ["5", 10],    // below every offered size → the smallest
    ["abc", 20],  // unreadable → page_size_default
    ["0", 20],    // not positive → page_size_default
  ])("turns a remembered %s into %i", async (stored, expected) => {
    const { mod } = await loadSearchFlow(theme, CFG);
    sessionStorage.setItem("fess.search.num", stored);
    expect(mod.initialNum()).toBe(expected);
  });

  it("caps a remembered size at page_size_max when no num options are offered", async () => {
    const { mod } = await loadSearchFlow(theme, { page_size_default: 20, page_size_max: 100 });
    sessionStorage.setItem("fess.search.num", "300");
    expect(mod.initialNum()).toBe(100);
  });

  it("falls back to the theme's default page size when nothing is remembered", async () => {
    const { mod } = await loadSearchFlow(theme, { num_options: [30, 50] });
    expect(mod.initialNum()).toBe(DEFAULT_NUM_THEMES.includes(theme) ? 30 : 10);
  });

  it("forgetNum() drops the remembered size", async () => {
    const { mod } = await loadSearchFlow(theme, CFG);
    sessionStorage.setItem("fess.search.num", "50");
    mod.forgetNum();
    expect(sessionStorage.getItem("fess.search.num")).toBeNull();
    expect(mod.initialNum()).toBe(20);
  });
});

describe("search defaults [codesearch]", () => {
  async function boot() {
    const flow = await loadSearchFlow("codesearch", DEFAULTS_CFG);
    installDispatch(flow.get);
    mountBody(SEARCH_FIXTURE);
    return flow;
  }

  it("applies the default sort when the URL names none, and keeps the URL's sort", async () => {
    const { mod, get } = await boot();
    setLocation("/search?q=foo");
    mod.runFromUrl();
    await settle();
    expect(searchParams(get).sort).toBe("last_modified.desc");
    get.mockClear();
    setLocation("/search?q=foo&sort=content_length.desc");
    mod.runFromUrl();
    await settle();
    expect(searchParams(get).sort).toBe("content_length.desc");
  });

  it("takes neither the default labels nor a remembered page size", async () => {
    const { mod, get } = await boot();
    setLocation("/search?q=foo&num=50");
    mod.runFromUrl();
    await settle();
    expect(searchParams(get)).not.toHaveProperty(["fields.label"]);
    expect(sessionStorage.getItem("fess.search.num")).toBeNull();
  });

  it("offers relevance as an explicit score.desc, so it survives a default sort", async () => {
    const { mod, navigate } = await boot();
    setLocation("/search?q=foo");
    mod.runFromUrl();
    await settle();
    const sel = document.querySelector("#result-summary .sort-select");
    expect(sel.value).toBe("last_modified.desc");
    expect(sel.options[0].value).toBe("score.desc");
    sel.value = "score.desc";
    sel.dispatchEvent(new Event("change"));
    const target = navigate.mock.calls.at(-1)[0];
    expect(new URLSearchParams(target.slice(target.indexOf("?") + 1)).get("sort")).toBe("score.desc");
  });
});
