// SPDX-License-Identifier: Apache-2.0
// docsearch: two things the results view shows about the current search.
//
// - The active-filter chip of a label shows the label's display name from
//   /api/v2/ui/config label_options ({ value, name }), as the facet sidebar, the options bar
//   and the drawer do; the value stays what the URL and the request carry.
// - The "Similar Results" view is part of the URL (sdh=), so a reload or a shared link shows
//   it and Back leaves it; runFromUrl() already read sdh, but nothing wrote it.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { resetDom, mountBody, setLocation } from "./helpers/dom.js";
import { SEARCH_FIXTURE, FULL_CFG, SAMPLE_DOCS, makeSearchEnv, installDispatch, settle } from "./helpers/searchFlow.js";

const THEME = "docsearch";

const LABEL_OPTIONS = [
  { value: "fa", name: "Fixture A pages" },
  { value: "fb", name: "Fixture B pages" },
  { value: "fc" },
];

beforeEach(() => {
  resetDom();
  sessionStorage.clear();
  window.scrollTo = () => {};
});
afterEach(() => setLocation("/"));

const searchParams = (get) => get.mock.calls.filter((c) => c[0] === "/search").map((c) => c[1]);

describe("docsearch: label name in the active-filter chip", () => {
  const cfg = { ...FULL_CFG, label_options: LABEL_OPTIONS };

  async function open(url) {
    setLocation(url);
    const flow = await loadSearchFlow(THEME, cfg);
    installDispatch(flow.get);
    mountBody(SEARCH_FIXTURE);
    flow.mod.runFromUrl();
    await settle();
    return flow;
  }

  const chips = () => document.getElementById("active-chips");

  it("names the label of a drawer / URL filter, not its value", async () => {
    await open("/search?q=foo&fields.label=fb");
    expect(chips().textContent).toContain("labels.facet_label_title: Fixture B pages");
    expect(chips().textContent).not.toContain("fb");
    expect(chips().querySelector(".active-chip-remove").getAttribute("aria-label")).toContain("Fixture B pages");
  });

  it("names the label of a facet selection (ex_q)", async () => {
    await open("/search?q=foo&ex_q=label%3Afa");
    expect(chips().textContent).toContain("labels.facet_label_title: Fixture A pages");
  });

  it("falls back to the value for a label without a name", async () => {
    await open("/search?q=foo&fields.label=fc");
    expect(chips().textContent).toContain("labels.facet_label_title: fc");
  });

  it("keeps the value in the URL and in the request, and the chip's remove button removes it", async () => {
    const { get } = await open("/search?q=foo&ex_q=label%3Afb");
    expect(new URLSearchParams(location.search).getAll("ex_q")).toEqual(["label:fb"]);
    expect(searchParams(get)[0].ex_q).toEqual(["label:fb"]);
    chips().querySelector(".active-chip-remove").click();
    await settle();
    expect(new URLSearchParams(location.search).getAll("ex_q")).toEqual([]);
    expect(chips().classList.contains("d-none")).toBe(true);
  });

  it("leaves other fields as they were", async () => {
    setLocation("/search?q=foo&fields.site=docs");
    const flow = await loadSearchFlow(THEME, cfg);
    installDispatch(flow.get);
    mountBody(SEARCH_FIXTURE);
    flow.mod.runFromUrl();
    await settle();
    expect(chips().textContent).toContain("site: docs");
  });
});

describe("docsearch: the Similar Results view in the URL", () => {
  const docs = [{ ...SAMPLE_DOCS[0], similar_docs_count: 3, similar_docs_hash: "h-1" }, SAMPLE_DOCS[1]];

  async function open(url = "/search?q=foo&start=0") {
    setLocation(url);
    const flow = await loadSearchFlow(THEME, FULL_CFG);
    installDispatch(flow.get, { search: makeSearchEnv(docs) });
    mountBody(SEARCH_FIXTURE);
    flow.mod.runFromUrl();
    await settle();
    return flow;
  }

  const banner = () => document.getElementById("similar-doc-banner");
  const params = () => new URLSearchParams(location.search);

  it("writes sdh to a new history entry when the link is followed", async () => {
    const { get } = await open("/search?q=foo");
    const before = history.length;
    document.querySelector("a.similar").click();
    await settle();
    expect(params().get("sdh")).toBe("h-1");
    expect(params().get("q")).toBe("foo");
    expect(history.length).toBe(before + 1);
    expect(searchParams(get).at(-1).sdh).toBe("h-1");
    expect(banner().classList.contains("d-none")).toBe(false);
  });

  it("starts the view on its first page", async () => {
    await open("/search?q=foo&start=10");
    document.querySelector("a.similar").click();
    await settle();
    expect(params().has("start")).toBe(false);
    expect(params().get("sdh")).toBe("h-1");
  });

  it("takes sdh out of the URL again, in a new history entry, when the banner is closed", async () => {
    await open("/search?q=foo");
    document.querySelector("a.similar").click();
    await settle();
    const before = history.length;
    banner().querySelector("button.btn-close").click();
    await settle();
    expect(params().has("sdh")).toBe(false);
    expect(params().get("q")).toBe("foo");
    expect(history.length).toBe(before + 1);
    expect(banner().classList.contains("d-none")).toBe(true);
  });

  it("shows the view again from a URL that carries sdh (a reload or a shared link)", async () => {
    const { get } = await open("/search?q=foo&sdh=h-1");
    expect(searchParams(get)[0].sdh).toBe("h-1");
    expect(banner().classList.contains("d-none")).toBe(false);
    expect(params().get("sdh")).toBe("h-1");
  });

  it("keeps sdh while the page changes inside the view", async () => {
    await open("/search?q=foo&sdh=h-1");
    const next = document.querySelector("#pagination li.page-item:not(.active):not(.disabled) a.page-link");
    expect(next).not.toBeNull();
    next.click();
    await settle();
    expect(Number(params().get("start"))).toBeGreaterThan(0);
    expect(params().get("sdh")).toBe("h-1");
  });
});
