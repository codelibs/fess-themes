// SPDX-License-Identifier: Apache-2.0
// The popular words of the empty state of the results page ("Your search did not match any
// documents") in the ten themes that have it (codesearch has its own results page).
//
// They are requested when the state is shown: once for a search with no hit, and not at all by
// search.attach() on the home page, which has its own request in app.js. The home page used to ask
// /api/v2/popular-words twice. A partial result with no hit does not show the state, so it does not
// ask either.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { resetDom, mountBody, setLocation } from "./helpers/dom.js";
import { SEARCH_FIXTURE, FULL_CFG, makeSearchEnv, installDispatch, settle } from "./helpers/searchFlow.js";

const THEMES = ["docsearch", "docuforge", "filesearch", "helpdesk", "mosaic", "nomadkit", "rawblock", "semanticlens", "storefront", "voicebox"];
const popularCalls = (get) => get.mock.calls.filter((c) => c[0] === "/popular-words").length;
const CFG = { ...FULL_CFG, features: { ...FULL_CFG.features, popular_word: true } };

beforeEach(() => {
  resetDom();
  window.scrollTo = () => {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLocation("/");
});

describe.each(THEMES)("%s: the popular words of the empty state", (theme) => {
  async function searchWith(env) {
    setLocation("/search?q=zzqx");
    const flow = await loadSearchFlow(theme, CFG);
    installDispatch(flow.get, { search: env });
    mountBody(SEARCH_FIXTURE);
    flow.mod._state.q = "zzqx";
    await flow.mod.runSearch();
    await settle();
    return flow;
  }
  const $ = (id) => document.getElementById(id);

  it("asks for the popular words once when a search has no hit, and lists them", async () => {
    const flow = await searchWith(makeSearchEnv([]));
    expect($("empty-state").classList.contains("d-none")).toBe(false);
    expect(popularCalls(flow.get)).toBe(1);
    expect($("popular-words").querySelectorAll("a").length).toBe(4);
  });

  it("does not ask for them when search.attach() runs on the home page", async () => {
    setLocation("/");
    const flow = await loadSearchFlow(theme, CFG);
    installDispatch(flow.get);
    mountBody(SEARCH_FIXTURE);
    flow.mod.attach();
    await settle();
    expect(popularCalls(flow.get)).toBe(0);
  });

  it("does not ask for them for a partial result with no hit", async () => {
    const flow = await searchWith(makeSearchEnv([], { partial: true, shard_failed: true }));
    expect(popularCalls(flow.get)).toBe(0);
  });
});
