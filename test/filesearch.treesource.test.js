// SPDX-License-Identifier: Apache-2.0
// filesearch: treesource.js — the one place that asks Fess for the tree's data. Request
// shapes (host facet for the roots, a scoped url facet for a node's children) and the
// handling of an answer without facets.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../themes/filesearch/assets/api.js", () => ({ get: vi.fn() }));

import * as api from "../themes/filesearch/assets/api.js";
import { rootsParams, childrenParams, loadRoots, loadChildren, FACET_SIZE, CHILDREN_FACET_SIZE, MAX_PROBES, afterFolder, urlFromClause, probeParams } from "../themes/filesearch/assets/treesource.js";
import { scopeClause } from "../themes/filesearch/assets/scope.js";

// braces: a returned mock would be run by vitest as the teardown function
beforeEach(() => { api.get.mockReset(); });

describe("request shapes", () => {
  it("roots: the host facet over the current search, one hit, no sort and no paging", () => {
    const p = rootsParams({ q: "report", ex_q: ["filetype:pdf"], lang: ["ja"] });
    expect(p).toMatchObject({ q: "report", ex_q: ["filetype:pdf"], lang: ["ja"], start: 0, num: 1, "facet.field": ["host"], "facet.size": FACET_SIZE });
    expect(p.sort).toBeUndefined();
  });

  it("roots: with no condition at all, asks for every document", () => {
    expect(rootsParams({ q: "" }).ex_q).toEqual(["url:*"]);
    expect(rootsParams({ q: "" , ex_q: [] }).ex_q).toEqual(["url:*"]);
  });

  it("roots: counts the ancestors of the selected folder exactly with facet.query", () => {
    const scopes = [{ type: "host", host: "srv" }, { type: "url", prefix: "smb://srv/a/" }];
    const p = rootsParams({ q: "x" }, scopes);
    expect(p["facet.query"]).toEqual(scopes.map(scopeClause));
    expect(rootsParams({ q: "x" })["facet.query"]).toBeUndefined();
  });

  it("children: the url facet inside the node, on top of the current filters", () => {
    const scope = { type: "url", prefix: "smb://srv/share/" };
    const p = childrenParams({ q: "", ex_q: ["label:x"], "fields.label": ["a"] }, scope);
    expect(p).toMatchObject({ q: "", "fields.label": ["a"], start: 0, num: 1, "facet.field": ["url"], "facet.size": CHILDREN_FACET_SIZE });
    expect(p.ex_q).toEqual(["label:x", scopeClause(scope)]);
  });

  it("children ask for more URLs than the default server cap, so a raised cap is honoured", () => {
    expect(CHILDREN_FACET_SIZE).toBeGreaterThan(FACET_SIZE);
  });

  it("children of a source are scoped by its host", () => {
    expect(childrenParams({ q: "" }, { type: "host", host: "srv" }).ex_q).toEqual(["host:srv"]);
  });

  it("never mutates the base parameters", () => {
    const base = { q: "a", ex_q: ["x"] };
    childrenParams(base, { type: "host", host: "h" });
    rootsParams(base, [{ type: "host", host: "h" }]);
    expect(base).toEqual({ q: "a", ex_q: ["x"] });
  });
});

describe("loadRoots", () => {
  it("returns the sources, the ancestor counts and the permission state", async () => {
    api.get.mockResolvedValue({
      facet_field: [{ name: "host", result: [{ value: "srv", count: 5 }, { value: "ex.com", count: 2 }] }],
      facet_query: [{ value: "host:srv", count: 5 }],
      permission_state: "PENDING",
    });
    const signal = new AbortController().signal;
    const out = await loadRoots({ q: "x" }, { signal });
    expect(api.get).toHaveBeenCalledWith("/search", expect.objectContaining({ "facet.field": ["host"] }), { signal });
    expect(out).toEqual({
      available: true,
      buckets: [{ value: "srv", count: 5 }, { value: "ex.com", count: 2 }],
      facetQuery: [{ value: "host:srv", count: 5 }],
      permissionState: "PENDING",
    });
  });

  it("says so when the answer carries no host facet, instead of reporting no sources", async () => {
    api.get.mockResolvedValue({ record_count: 10 });
    const out = await loadRoots({ q: "x" });
    expect(out.available).toBe(false);
    expect(out.buckets).toEqual([]);
  });

  it("lets a failure through so the caller can show it", async () => {
    api.get.mockRejectedValue(Object.assign(new Error("boom"), { httpStatus: 500 }));
    await expect(loadRoots({ q: "x" })).rejects.toThrow("boom");
  });
});

describe("loadChildren", () => {
  it("folds the url facet into the node's folders and judges exactness from the hit count", async () => {
    api.get.mockResolvedValue({
      facet_field: [{ name: "url", result: [{ value: "smb://srv/share/a/x.txt", count: 1 }, { value: "smb://srv/share/b/y.txt", count: 1 }] }],
      record_count: 2, record_count_relation: "EQUAL_TO", permission_state: "OK",
    });
    const out = await loadChildren({ q: "" }, { type: "url", prefix: "smb://srv/share/" });
    expect(out.available).toBe(true);
    expect(out.fold.children.map(c => c.prefix)).toEqual(["smb://srv/share/a/", "smb://srv/share/b/"]);
    expect(out.fold.exact).toBe(true);
    expect(out.permissionState).toBe("OK");
  });

  it("is not exact when the facet saw fewer URLs than there are hits", async () => {
    api.get.mockResolvedValue({
      facet_field: [{ name: "url", result: [{ value: "smb://srv/share/a/x.txt", count: 1 }] }],
      record_count: 5000, record_count_relation: "EQUAL_TO",
    });
    const out = await loadChildren({ q: "" }, { type: "url", prefix: "smb://srv/share/" });
    expect(out.fold.exact).toBe(false);
  });

  it("is not exact when the hit count is only a lower bound", async () => {
    api.get.mockResolvedValue({
      facet_field: [{ name: "url", result: [{ value: "smb://srv/share/a/x.txt", count: 1 }] }],
      record_count: 1, record_count_relation: "GREATER_THAN_OR_EQUAL_TO",
    });
    expect((await loadChildren({ q: "" }, { type: "url", prefix: "smb://srv/share/" })).fold.exact).toBe(false);
  });

  it("reports an answer without the url facet as unavailable", async () => {
    api.get.mockResolvedValue({ record_count: 3 });
    const out = await loadChildren({ q: "" }, { type: "host", host: "srv" });
    expect(out.available).toBe(false);
    expect(out.fold.children).toEqual([]);
  });
});

describe("browse mode: folders found without counting documents", () => {
  const scope = { type: "url", prefix: "smb://srv/share/" };
  const answer = (urls, extra = {}) => ({
    facet_field: [{ name: "url", result: urls.map(value => ({ value, count: 1 })) }],
    record_count_relation: "EQUAL_TO", ...extra,
  });

  it("afterFolder is above every url of the folder and below the next sibling", () => {
    expect(afterFolder("smb://srv/share/a/")).toBe("smb://srv/share/a0");
    expect("smb://srv/share/a/zzz" < afterFolder("smb://srv/share/a/")).toBe(true);
    expect(afterFolder("smb://srv/share/a/") <= "smb://srv/share/a0/x").toBe(true);
  });

  it("quotes the range bound so spaces and quotes survive", () => {
    expect(urlFromClause('smb://srv/a b/"c"\\', true)).toBe('url:["smb://srv/a b/\\"c\\"\\\\" TO *]');
    expect(urlFromClause("x", false)).toBe('url:{"x" TO *]');
  });

  it("probes in url order on top of the folder scope and the current filters", () => {
    const p = probeParams({ q: "", ex_q: ["label:x"] }, scope, { value: "smb://srv/share/b0", inclusive: true }, 1);
    expect(p).toMatchObject({ "facet.field": ["url"], "facet.size": 1, "facet.sort": "term.asc", num: 1 });
    expect(p.ex_q).toEqual(["label:x", scopeClause(scope), 'url:["smb://srv/share/b0" TO *]']);
  });

  it("one request is enough when the first answer holds the whole folder; no counts are kept", async () => {
    api.get.mockResolvedValue(answer(["smb://srv/share/a/x.txt", "smb://srv/share/b/y.txt"], { record_count: 2 }));
    const out = await loadChildren({ q: "" }, scope, { browse: true });
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(out.fold.children.map(c => [c.prefix, c.count])).toEqual([["smb://srv/share/a/", null], ["smb://srv/share/b/", null]]);
    expect(out.fold.exact).toBe(true);
  });

  it("keeps asking for the first url after the last folder found until none is left", async () => {
    api.get
      .mockResolvedValueOnce(answer(["smb://srv/share/1/a.txt", "smb://srv/share/1/b.txt"], { record_count: 90000 }))
      .mockResolvedValueOnce(answer(["smb://srv/share/3/z.txt"]))
      .mockResolvedValueOnce(answer(["smb://srv/share/5/z.txt"]))
      .mockResolvedValueOnce(answer([]));
    const out = await loadChildren({ q: "" }, scope, { browse: true });
    expect(out.fold.children.map(c => c.prefix)).toEqual(["smb://srv/share/1/", "smb://srv/share/3/", "smb://srv/share/5/"]);
    expect(out.fold.exact).toBe(true);
    const lastClause = api.get.mock.calls.map(c => c[1].ex_q.at(-1));
    expect(lastClause).toEqual([
      scopeClause(scope),
      'url:["smb://srv/share/10" TO *]', 'url:["smb://srv/share/30" TO *]', 'url:["smb://srv/share/50" TO *]',
    ]);
  });

  it("steps over a file that sits directly in the folder", async () => {
    api.get
      .mockResolvedValueOnce(answer(["smb://srv/share/a/x.txt"], { record_count: 5000 }))
      .mockResolvedValueOnce(answer(["smb://srv/share/readme.txt"]))
      .mockResolvedValueOnce(answer(["smb://srv/share/z/y.txt"]))
      .mockResolvedValueOnce(answer([]));
    const out = await loadChildren({ q: "" }, scope, { browse: true });
    expect(out.fold.children.map(c => c.prefix)).toEqual(["smb://srv/share/a/", "smb://srv/share/z/"]);
    expect(api.get.mock.calls[2][1].ex_q.at(-1)).toBe('url:{"smb://srv/share/readme.txt" TO *]');
  });

  it("gives up after MAX_PROBES requests and says the list may be incomplete", async () => {
    let n = 0;
    api.get.mockImplementation(async () => answer([`smb://srv/share/f${String(++n).padStart(6, "0")}/x.txt`], { record_count: 1e6 }));
    const out = await loadChildren({ q: "" }, scope, { browse: true });
    expect(api.get).toHaveBeenCalledTimes(MAX_PROBES + 1);
    expect(out.fold.exact).toBe(false);
  });

  it("stops, incomplete, when the range clause would be too long for ex_q", async () => {
    const deep = "smb://srv/share/" + "d".repeat(1100) + "/";
    api.get.mockResolvedValueOnce(answer([deep + "x.txt"], { record_count: 5000 }));
    const out = await loadChildren({ q: "" }, scope, { browse: true });
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(out.fold.exact).toBe(false);
  });

  it("reports an answer without the url facet as unavailable", async () => {
    api.get.mockResolvedValue({ record_count: 3 });
    expect((await loadChildren({ q: "" }, scope, { browse: true })).available).toBe(false);
  });
});
