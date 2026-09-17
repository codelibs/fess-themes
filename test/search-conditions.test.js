// SPDX-License-Identifier: Apache-2.0
// URLs made by the JSP pages (sdh, as.*), facet clicks that narrow the search, and the
// header search form, for the nine themes with the bootstrap search contract.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { resetDom, mountBody, setLocation } from "./helpers/dom.js";
import { mountIndexBody } from "./helpers/themes.js";
import { SEARCH_FIXTURE, FULL_CFG, installDispatch, settle } from "./helpers/searchFlow.js";

const DNONE_THEMES = [
  "docsearch", "docuforge", "helpdesk", "mosaic",
  "nomadkit", "rawblock", "semanticlens", "storefront", "voicebox",
];

/** The params of the first /search call. */
const searchParams = (get) => get.mock.calls.find((c) => c[0] === "/search")[1];

beforeEach(() => {
  resetDom();
  sessionStorage.clear();
  window.scrollTo = () => {};
});
afterEach(() => setLocation("/"));

describe.each(DNONE_THEMES)("JSP URL conditions [%s]", (theme) => {
  async function boot(cfg = FULL_CFG) {
    const flow = await loadSearchFlow(theme, cfg);
    installDispatch(flow.get);
    mountBody(SEARCH_FIXTURE);
    return flow;
  }

  it("passes sdh and as.* from the URL to the search API", async () => {
    const { mod, get } = await boot();
    setLocation("/search?q=foo&sdh=abc&as.q=bar&as.filetype=pdf&as.filetype=html&as.nq=");
    mod.runFromUrl();
    await settle();
    expect(searchParams(get).sdh).toBe("abc");
    expect(searchParams(get)["as.q"]).toEqual(["bar"]);
    expect(searchParams(get)["as.filetype"]).toEqual(["pdf", "html"]);
    expect(Object.keys(searchParams(get))).not.toContain("as.nq");
  });

  it("runs a search for an advanced-search condition without a keyword", async () => {
    const { mod, get, navigate } = await boot();
    setLocation("/search?as.epq=exact%20phrase");
    mod.runFromUrl();
    await settle();
    expect(navigate).not.toHaveBeenCalled();
    expect(searchParams(get)["as.epq"]).toEqual(["exact phrase"]);
  });

  it("goes home for as.occt alone, which only narrows a search", async () => {
    const { mod, get, navigate } = await boot();
    setLocation("/search?as.occt=title");
    mod.runFromUrl();
    await settle();
    expect(navigate).toHaveBeenCalledWith("./", { replace: true });
    expect(get.mock.calls.some((c) => c[0] === "/search")).toBe(false);
  });

  it("drops sdh and as.* once the URL has none", async () => {
    const { mod, get } = await boot();
    setLocation("/search?q=foo&sdh=abc&as.q=bar");
    mod.runFromUrl();
    await settle();
    get.mockClear();
    setLocation("/search?q=next");
    mod.runFromUrl();
    await settle();
    expect(Object.keys(searchParams(get))).not.toContain("sdh");
    expect(Object.keys(searchParams(get)).filter((k) => k.startsWith("as."))).toEqual([]);
  });

  it("resetSearchState() clears the advanced-search conditions", async () => {
    const { mod } = await boot();
    mod._state.as = { q: ["x"] };
    mod.resetSearchState();
    expect(mod._state.as).toEqual({});
  });

  it("the header search carries the drawer's labels and drops sdh and as.*", async () => {
    // The shipped markup, so the header form, its input and the drawer are the real ones.
    const { mod, get, navigate } = await loadSearchFlow(theme, FULL_CFG);
    installDispatch(get);
    mountIndexBody(theme);
    mod.attach();
    setLocation("/search?q=old&sdh=h1&as.q=legacy&fields.label=lblB");
    document.getElementById("labelSearchOption").value = "lblA";
    document.getElementById("query").value = "hello";
    document.getElementById("search-form").dispatchEvent(new Event("submit", { cancelable: true }));
    const target = navigate.mock.calls.at(-1)[0];
    const params = new URLSearchParams(target.slice(target.indexOf("?") + 1));
    expect(params.get("q")).toBe("hello");
    expect(params.getAll("fields.label")).toEqual(["lblA"]);
    expect(params.has("sdh")).toBe(false);
    expect(params.has("as.q")).toBe(false);
  });
});

describe.each(DNONE_THEMES)("facet selections [%s]", (theme) => {
  it("narrow the search instead of widening the explicit labels", async () => {
    const { mod, get } = await loadSearchFlow(theme, FULL_CFG);
    installDispatch(get);
    mountBody(SEARCH_FIXTURE);
    mod._state.q = "foo";
    mod._state.fields = { label: ["lblA"] };
    mod._state.facets = { label: ["lblB"], filetype: ["pdf"] };
    await mod.runSearch();
    await settle();
    const params = searchParams(get);
    expect(params["ex_q"]).toContain("filetype:pdf");
    expect(params["fields.label"]).toEqual(["lblA"]);
    expect(params["ex_q"]).toContain("label:lblB");
  });
});
