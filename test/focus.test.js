// SPDX-License-Identifier: Apache-2.0
// Keyboard focus after a search renders. Rendering replaces the pager, the facet entries and the
// results, so a keyboard user who pressed one of them (Enter on Next, on a facet entry) was left with
// the focus on <body>: the next Tab started at the top of the page and a screen reader said nothing.
// runSearch() now hands the focus to the count line (the new page's own announcement), or to the view
// when there is no count line, and leaves a focus that is somewhere else (the search box) alone. A
// page opened by its address has the focus on <body> and keeps it.
// And showView() no longer focuses a heading of the results view: those are the result titles, which
// the search about to run replaces.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { modulePath } from "./helpers/themes.js";
import { resetDom, mountBody } from "./helpers/dom.js";
import { SEARCH_FIXTURE, FULL_CFG, SAMPLE_DOCS, makeSearchEnv, installDispatch, settle } from "./helpers/searchFlow.js";

// codesearch counts its hits in #result-summary instead of #results-status.
const THEMES = ["codesearch", "docsearch", "docuforge", "filesearch", "helpdesk", "mosaic", "nomadkit", "rawblock", "semanticlens", "storefront", "voicebox"];

beforeEach(() => {
  resetDom();
  window.scrollTo = () => {};
});
afterEach(() => vi.unstubAllGlobals());

describe.each(THEMES)("%s: the focus after a search renders", (theme) => {
  /** A page with a first search on it and `focusOn` focused; then the next search. */
  async function searchWithFocusOn(focusOn, extra = {}) {
    const flow = await loadSearchFlow(theme, FULL_CFG);
    installDispatch(flow.get, { search: makeSearchEnv(SAMPLE_DOCS, extra) });
    mountBody(SEARCH_FIXTURE + '<section id="results-view"></section>');
    flow.mod._state.q = "coffee";
    await flow.mod.runSearch();
    await settle();
    const target = focusOn();
    expect(document.activeElement, "the first search left the focus on the control under test").toBe(target);
    await flow.mod.runSearch();
    await settle();
    return target;
  }
  const pagerLink = () => {
    const a = document.querySelector("#pagination a, #pagination button");
    if (!a.hasAttribute("tabindex")) a.setAttribute("tabindex", "0");   // jsdom: an <a> without href is not focusable
    a.focus();
    return a;
  };

  it("does not drop to <body> when the pager link that was used is replaced", async () => {
    const link = await searchWithFocusOn(pagerLink);
    expect(link.isConnected, "the pager was rendered again").toBe(false);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement.id).toBe(theme === "codesearch" ? "result-summary" : "results-status");
  });

  it("leaves the focus on <body> when the page was opened by its address", async () => {
    // The first Tab must reach the skip link and the header, not the count line the search rendered.
    const flow = await loadSearchFlow(theme, FULL_CFG);
    installDispatch(flow.get, { search: makeSearchEnv(SAMPLE_DOCS) });
    mountBody(SEARCH_FIXTURE + '<section id="results-view"></section>');
    expect(document.activeElement).toBe(document.body);
    flow.mod._state.q = "coffee";
    await flow.mod.runSearch();
    await settle();
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves a focus that is in the search box alone", async () => {
    const box = await searchWithFocusOn(() => {
      const q = document.getElementById("query");
      q.focus();
      return q;
    });
    expect(document.activeElement).toBe(box);
  });

  it("moves to the view when there is no count line to announce", async () => {
    const flow = await loadSearchFlow(theme, FULL_CFG);
    installDispatch(flow.get, { search: makeSearchEnv(SAMPLE_DOCS) });
    mountBody(SEARCH_FIXTURE + '<section id="results-view"></section>');
    flow.mod._state.q = "coffee";
    await flow.mod.runSearch();
    await settle();
    pagerLink();
    installDispatch(flow.get, { search: makeSearchEnv([]) });
    await flow.mod.runSearch();
    await settle();
    expect(document.activeElement).not.toBe(document.body);
  });
});

// The results view's headings are the result titles, which a search replaces: focus on the view.
describe.each(["docuforge", "mosaic", "nomadkit", "rawblock", "semanticlens", "storefront", "voicebox"])(
  "%s: showView does not focus a result title", (theme) => {
    it("targets the results view itself, not the first heading inside it", () => {
      const src = readFileSync(modulePath(theme, "app.js"), "utf8");
      expect(src).toMatch(/const heading = vid === "results-view" \? null : el\.querySelector\("h1, h2, h3"\);/);
    });
  });
