// SPDX-License-Identifier: Apache-2.0
// A partial result with no hit (the search engine could not be reached) says nothing about whether
// a document matches: the incomplete-search warning stands alone, and the empty state ("Your search
// did not match any documents") is not shown. A complete result with no hit still shows it.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { resetDom, mountBody, setLocation } from "./helpers/dom.js";
import { SEARCH_FIXTURE, FULL_CFG, makeSearchEnv, installDispatch, settle } from "./helpers/searchFlow.js";

const THEMES = ["docsearch", "docuforge", "filesearch", "helpdesk", "mosaic", "nomadkit", "rawblock", "semanticlens", "storefront", "voicebox"];

// codesearch hides the empty state and the warning with the `hidden` attribute, the others with d-none.
const hidden = (theme, el) => (theme === "codesearch" ? el.hidden : el.classList.contains("d-none"));

beforeEach(() => {
  resetDom();
  window.scrollTo = () => {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLocation("/");
});

describe.each([...THEMES, "codesearch"])("%s: a partial result with no hit", (theme) => {
  async function searchWith(env) {
    setLocation("/search?q=zzqx");
    const flow = await loadSearchFlow(theme, FULL_CFG);
    installDispatch(flow.get, { search: env });
    mountBody(SEARCH_FIXTURE);
    flow.mod._state.q = "zzqx";
    await flow.mod.runSearch();
    await settle();
  }
  const $ = (id) => document.getElementById(id);

  it("does not say 'did not match'; the incomplete-search warning stays", async () => {
    await searchWith(makeSearchEnv([], { partial: true, shard_failed: true }));
    expect(hidden(theme, $("empty-state"))).toBe(true);
    expect(hidden(theme, $("results-warning"))).toBe(false);
    expect($("results-warning").textContent).toContain("labels.search_partially_failed");
    // nor to a screen reader through the live region some themes keep for it
    expect($("results-meta").textContent).not.toContain("did_not_match");
  });

  it("is not what a complete result with no hit looks like: that still says it", async () => {
    await searchWith(makeSearchEnv([]));
    expect(hidden(theme, $("empty-state"))).toBe(false);
  });
});
