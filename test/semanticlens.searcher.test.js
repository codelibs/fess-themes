// SPDX-License-Identifier: Apache-2.0
// SemanticLens searcher-provenance behaviour against Fess 15.8.
//
// Semantic search moved into Fess core in 15.8, and the two contracts this theme
// depends on changed with it:
//
//   1. The vector searcher is registered as "semantic_chunk" (core), not "semantic"
//      (the name the fess-webapp-semantic-search plugin used on 15.7 and earlier).
//      A theme that only knows "semantic" reads a hybrid hit as keyword-only, which
//      is worse than showing no badge at all — it asserts something false.
//   2. Fess skips the semantic branch for any query containing search syntax, and a
//      double quote counts. The theme used to wrap a multi-word query in quotes
//      whenever a filter was active, to dodge an HTTP 400 in the plugin; on 15.8 that
//      transform would silently turn every filtered search keyword-only.
//
// Case (1) is asserted through buildResultCard (the badge is built there), case (2)
// through the runSearch pipeline so the assertion is on the actual outgoing request.

import { describe, it, expect, beforeEach } from "vitest";
import { loadSearch, loadSearchFlow } from "./helpers/loadSearch.js";
import { resetDom, mountBody } from "./helpers/dom.js";
import {
  SEARCH_FIXTURE, FULL_CFG, SAMPLE_DOCS, makeSearchEnv, installDispatch, settle,
} from "./helpers/searchFlow.js";

/** A result document with the fields buildResultCard reads on the common path. */
function docWith(searcher) {
  const d = {
    doc_id: "doc-1",
    url: "https://example.com/a",
    url_link: "https://example.com/a",
    content_title: "Example Title",
    content_description: "An example description.",
    digest: "An example description.",
    site: "example.com",
    site_path: "example.com/a",
    mimetype: "text/html",
    filetype: "html",
    last_modified: "2026-01-02T03:04:05",
    created: "2026-01-01T00:00:00",
    content_length: 2048,
  };
  if (searcher !== undefined) d.searcher = searcher;
  return d;
}

/** The badge kind buildResultCard rendered, e.g. "hybrid"; null when no badge. */
function badgeKind(card) {
  const badge = card.querySelector(".searcher-badge");
  if (!badge) return null;
  const cls = [...badge.classList].find((c) => c.startsWith("searcher-badge--"));
  return cls ? cls.slice("searcher-badge--".length) : null;
}

describe("semanticlens searcher badge", () => {
  beforeEach(() => {
    resetDom();
  });

  // Fess emits `searcher` as a JSON array; the comma-string form is accepted too
  // because searcherKinds() has always normalised both.
  const CASES = [
    ["15.8 hybrid",           ["default", "semantic_chunk"], "hybrid"],
    ["15.8 semantic only",    ["semantic_chunk"],            "semantic"],
    ["15.7 hybrid (legacy)",  ["default", "semantic"],       "hybrid"],
    ["15.7 semantic (legacy)", ["semantic"],                 "semantic"],
    ["keyword only",          ["default"],                   "keyword"],
    ["comma string",          "default,semantic_chunk",      "hybrid"],
    ["unknown searcher",      ["something_else"],            "other"],
  ];

  it.each(CASES)("labels %s as %s", async (_name, searcher, expected) => {
    const { buildResultCard } = await loadSearch("semanticlens", {});
    expect(badgeKind(buildResultCard(docWith(searcher), "q1", 0))).toBe(expected);
  });

  it("renders no badge when the deployment does not expose `searcher`", async () => {
    const { buildResultCard } = await loadSearch("semanticlens", {});
    expect(badgeKind(buildResultCard(docWith(undefined), "q1", 0))).toBe(null);
  });

  it("shows the raw name on an unknown searcher rather than guessing", async () => {
    const { buildResultCard } = await loadSearch("semanticlens", {});
    const badge = buildResultCard(docWith(["something_else"]), "q1", 0)
      .querySelector(".searcher-badge");
    expect(badge.textContent).toContain("something_else");
  });
});

describe("semanticlens sends the query verbatim", () => {
  beforeEach(() => {
    resetDom();
    window.scrollTo = () => {};
  });

  const MULTI_WORD = "how do I brew coffee";

  // Hits that carry provenance: the removed workaround only engaged after a response
  // proved semantic search was active, so a single cold search would never trigger it
  // and asserting on one would pass against the old code too.
  const SEMANTIC_DOCS = SAMPLE_DOCS.map((d) => ({ ...d, searcher: ["default", "semantic_chunk"] }));

  /**
   * Run the real user sequence: search, see semantic results, then narrow with a
   * filter. Returns the `q` sent on the SECOND request.
   */
  async function qAfterFiltering(filterState) {
    const flow = await loadSearchFlow("semanticlens", FULL_CFG);
    installDispatch(flow.get, { search: makeSearchEnv(SEMANTIC_DOCS) });
    mountBody(SEARCH_FIXTURE);
    flow.mod._state.q = MULTI_WORD;
    await flow.mod.runSearch();
    await settle();
    Object.assign(flow.mod._state, filterState);
    await flow.mod.runSearch();
    await settle();
    const calls = flow.get.mock.calls.filter((c) => c[0] === "/search");
    expect(calls.length).toBe(2);
    return calls[1][1].q;
  }

  it("does not quote a multi-word query when a field filter is active", async () => {
    expect(await qAfterFiltering({ fields: { label: ["docs"] } })).toBe(MULTI_WORD);
  });

  it("does not quote a multi-word query when a facet is active", async () => {
    expect(await qAfterFiltering({ facets: { filetype: ["html"] } })).toBe(MULTI_WORD);
  });

  it("does not quote a multi-word query when a facet-view clause is active", async () => {
    expect(await qAfterFiltering({ facetQueries: ["timestamp:[now-1d TO now]"] })).toBe(MULTI_WORD);
  });

  it("does not quote a multi-word query when an advance ex_q clause is active", async () => {
    expect(await qAfterFiltering({ exQ: ['title:"guide"'] })).toBe(MULTI_WORD);
  });

  it("leaves an unfiltered multi-word query alone as well", async () => {
    expect(await qAfterFiltering({})).toBe(MULTI_WORD);
  });
});
