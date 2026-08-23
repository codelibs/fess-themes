// SPDX-License-Identifier: Apache-2.0
// Mosaic searcher-provenance and query-verbatim behaviour against Fess 15.8.
//
// Two contracts this theme depends on:
//
//   1. The vector searcher on the docker-multimodalsearch stack is registered as
//      "multi_modal" (fess-webapp-multimodal's ClipChunkSearcher overrides getName()
//      so the badge vocabulary Keyword/Visual/Blend keeps meaning what it says).
//      A stock 15.8 without the plugin emits "semantic_chunk" instead, which is a
//      text-only semantic searcher — labelling that "Visual" would assert something
//      false, so it must fall through to the neutral badge.
//   2. Fess 15.8 skips the vector branch for any query containing search syntax, and
//      a double quote counts. The theme used to wrap a multi-word query in quotes
//      whenever a filter was active, to dodge an HTTP 400 in the 15.7 plugin; on 15.8
//      that transform silently turns every filtered search keyword-only.
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

/** The badge kind buildResultCard rendered, e.g. "blend"; null when no badge. */
function badgeKind(card) {
  const badge = card.querySelector(".searcher-badge");
  if (!badge) return null;
  const cls = [...badge.classList].find((c) => c.startsWith("searcher-badge--"));
  return cls ? cls.slice("searcher-badge--".length) : null;
}

describe("mosaic searcher badge", () => {
  beforeEach(() => {
    resetDom();
  });

  const CASES = [
    ["hybrid",              ["default", "multi_modal"], "blend"],
    ["visual only",         ["multi_modal"],            "visual"],
    ["keyword only",        ["default"],                "keyword"],
    ["comma string",        "default,multi_modal",      "blend"],
    ["stock 15.8 semantic", ["semantic_chunk"],         "other"],
  ];

  it.each(CASES)("labels %s as %s", async (_name, searcher, expected) => {
    const { buildResultCard } = await loadSearch("mosaic", {});
    expect(badgeKind(buildResultCard(docWith(searcher), "q1", 0))).toBe(expected);
  });

  it("renders no badge when the deployment does not expose `searcher`", async () => {
    const { buildResultCard } = await loadSearch("mosaic", {});
    expect(badgeKind(buildResultCard(docWith(undefined), "q1", 0))).toBe(null);
  });

  it("shows the raw name on an unknown searcher rather than calling it Visual", async () => {
    const { buildResultCard } = await loadSearch("mosaic", {});
    const badge = buildResultCard(docWith(["semantic_chunk"]), "q1", 0)
      .querySelector(".searcher-badge");
    expect(badge.textContent).toContain("semantic_chunk");
  });
});

describe("mosaic sends the query verbatim", () => {
  beforeEach(() => {
    resetDom();
    window.scrollTo = () => {};
  });

  const MULTI_WORD = "red sports car";

  // Hits that carry provenance: the removed workaround only engaged after a response
  // proved vector search was active, so a single cold search would never trigger it
  // and asserting on one would pass against the old code too.
  const VISUAL_DOCS = SAMPLE_DOCS.map((d) => ({ ...d, searcher: ["default", "multi_modal"] }));

  /**
   * Run the real user sequence: search, see visual results, then narrow with a
   * filter. Returns the `q` sent on the SECOND request.
   */
  async function qAfterFiltering(filterState) {
    const flow = await loadSearchFlow("mosaic", FULL_CFG);
    installDispatch(flow.get, { search: makeSearchEnv(VISUAL_DOCS) });
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
    expect(await qAfterFiltering({ fields: { label: ["photos"] } })).toBe(MULTI_WORD);
  });

  it("does not quote a multi-word query when a facet is active", async () => {
    expect(await qAfterFiltering({ facets: { filetype: ["jpeg"] } })).toBe(MULTI_WORD);
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
