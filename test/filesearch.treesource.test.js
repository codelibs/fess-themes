// SPDX-License-Identifier: Apache-2.0
// filesearch: treesource.js — the one place that asks Fess for the tree's data. Request
// shapes (host facet for the roots, a scoped url facet for a node's children) and the
// handling of an answer without facets.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../themes/filesearch/assets/api.js", () => ({ get: vi.fn() }));

import * as api from "../themes/filesearch/assets/api.js";
import { rootsParams, childrenParams, loadRoots, loadChildren, FACET_SIZE } from "../themes/filesearch/assets/treesource.js";
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
    expect(p).toMatchObject({ q: "", "fields.label": ["a"], start: 0, num: 1, "facet.field": ["url"], "facet.size": FACET_SIZE });
    expect(p.ex_q).toEqual(["label:x", scopeClause(scope)]);
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
