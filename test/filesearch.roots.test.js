// SPDX-License-Identifier: Apache-2.0
// filesearch: configured roots (`filesearch.roots` in theme_settings): reading the setting,
// the tree that starts at those folders, and the request that counts them.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../themes/filesearch/assets/api.js", () => ({ get: vi.fn() }));

import * as api from "../themes/filesearch/assets/api.js";
import { themeSettings, parseRoots, configuredRoots, rootsSignature, ROOTS_KEY, MAX_ROOTS, MAX_ROOT_LENGTH, ROOTS_QUERY_BUDGET, QUERY_BUDGET, queryBytes } from "../themes/filesearch/assets/roots.js";
import { createTree, setRootScopes, setConfiguredRoots, ensurePath, mergeSeen, chainOf, applyFold, applyClauseCounts, visibleNodes } from "../themes/filesearch/assets/tree.js";
import { rootsParams, loadRoots } from "../themes/filesearch/assets/treesource.js";
import { createTreeView } from "../themes/filesearch/assets/treeview.js";
import { scopeClause, parseScopeClause } from "../themes/filesearch/assets/scope.js";
import { MAX_CLAUSE_LENGTH } from "../themes/filesearch/assets/paths.js";

beforeEach(() => { api.get.mockReset(); });

const url = prefix => ({ type: "url", prefix });

describe("theme_settings", () => {
  it("reads strings only, and nothing from a missing or malformed field", () => {
    expect(themeSettings({ theme_settings: { a: "x", b: 1, c: null, d: { e: "f" }, g: ["h"] } })).toEqual({ a: "x" });
    expect(themeSettings({})).toEqual({});
    expect(themeSettings(null)).toEqual({});
    expect(themeSettings(undefined)).toEqual({});
    expect(themeSettings({ theme_settings: "filesearch.roots=a" })).toEqual({});
    expect(themeSettings({ theme_settings: ["a"] })).toEqual({});
    expect(themeSettings({ theme_settings: null })).toEqual({});
  });

  it("an older Fess (no theme_settings) means no roots: the tree behaves as before", () => {
    expect(configuredRoots({ ui_locale: "en" })).toEqual([]);
    expect(configuredRoots(null)).toEqual([]);
    expect(configuredRoots({ theme_settings: {} })).toEqual([]);
    expect(configuredRoots({ theme_settings: { [ROOTS_KEY]: "" } })).toEqual([]);
    expect(configuredRoots({ theme_settings: { [ROOTS_KEY]: 5 } })).toEqual([]);
  });

  it("reads the roots from the filesearch.roots key (a dot in a key is fine)", () => {
    expect(ROOTS_KEY).toBe("filesearch.roots");
    expect(configuredRoots({ theme_settings: { "filesearch.roots": "smb://srv/a/" } })).toEqual([url("smb://srv/a/")]);
    expect(configuredRoots({ theme_settings: { "other.roots": "smb://srv/a/" } })).toEqual([]);
  });
});

describe("parseRoots", () => {
  it("splits on |, trims each item and drops empty ones", () => {
    expect(parseRoots("  smb://srv/a/ | |file:/data/docs/||  ")).toEqual([url("smb://srv/a/"), url("file:/data/docs/")]);
  });

  it("keeps a space inside a URL: white space is not a separator", () => {
    expect(parseRoots("smb://srv/share/Main Repository/Documents/")).toEqual([url("smb://srv/share/Main Repository/Documents/")]);
  });

  it("gives a folder prefix its trailing slash, as every folder scope has", () => {
    expect(parseRoots("smb://srv/share/docs")).toEqual([url("smb://srv/share/docs/")]);
  });

  it("takes the prefix as written: file: stays percent-encoded, smb: stays decoded", () => {
    expect(parseRoots("file:/data/My%20Docs/|smb://srv/My Docs/")).toEqual([url("file:/data/My%20Docs/"), url("smb://srv/My Docs/")]);
  });

  it("a prefix with no folder is the whole source", () => {
    expect(parseRoots("smb://srv")).toEqual([{ type: "host", host: "srv" }]);
  });

  it("drops what is not a URL, a control character, a non-string and an over-long item", () => {
    expect(parseRoots("not a url|/data/docs/|smb://srv/a\nb/|smb://srv/ok/")).toEqual([url("smb://srv/ok/")]);
    expect(parseRoots("smb://srv/" + "x".repeat(MAX_ROOT_LENGTH) + "/|smb://srv/ok/")).toEqual([url("smb://srv/ok/")]);
    for (const v of [undefined, null, 5, {}, ["smb://srv/a/"], true]) expect(parseRoots(v)).toEqual([]);
  });

  it("drops a root that would not fit the 1000-character ex_q clause", () => {
    // every "(" and "/" is escaped in the clause, so each costs two characters
    const heavy = "smb://s/" + "(/".repeat(246);
    expect(heavy.length).toBeLessThanOrEqual(MAX_ROOT_LENGTH);
    expect(scopeClause(url(heavy)).length).toBeGreaterThan(MAX_CLAUSE_LENGTH);
    expect(parseRoots(heavy)).toEqual([]);
  });

  it("keeps at most MAX_ROOTS roots, the first ones", () => {
    const many = Array.from({ length: MAX_ROOTS + 15 }, (_, i) => "smb://srv/s" + i + "/").join("|");
    const roots = parseRoots(many);
    expect(roots.length).toBe(MAX_ROOTS);
    expect(roots[0]).toEqual(url("smb://srv/s0/"));
    expect(roots[MAX_ROOTS - 1]).toEqual(url("smb://srv/s" + (MAX_ROOTS - 1) + "/"));
  });

  it("drops duplicates and a root inside another root (it would be the same node twice)", () => {
    expect(parseRoots("smb://srv/a/|smb://srv/a|smb://srv/a/b/c/|smb://srv/ab/")).toEqual([url("smb://srv/a/"), url("smb://srv/ab/")]);
    expect(parseRoots("smb://srv/a/b/|smb://srv/a/")).toEqual([url("smb://srv/a/")]);
  });

  it("roots that name the same scope are one root (the tree has one node per scope)", () => {
    expect(parseRoots("smb://srv/|file:////srv/")).toEqual([{ type: "host", host: "srv" }]);
    expect(parseRoots("smb://srv/|smb1://srv/")).toEqual([{ type: "host", host: "srv" }]);
    expect(parseRoots("file:////srv/|smb://srv/")).toEqual([{ type: "host", host: "srv" }]);
  });

  it("a root inside a source root is dropped, whatever scheme spells the source", () => {
    expect(parseRoots("smb://srv/|file:////srv/share/")).toEqual([{ type: "host", host: "srv" }]);
    expect(parseRoots("file:////srv/share/|smb://srv/")).toEqual([{ type: "host", host: "srv" }]);
    expect(parseRoots("smb://srv/|smb://srv/share/docs/|smb://other/x/")).toEqual([{ type: "host", host: "srv" }, url("smb://other/x/")]);
  });

  it("the tree gets each scope once for those inputs", () => {
    for (const text of ["smb://srv/|file:////srv/", "smb://srv/|smb1://srv/", "smb://srv/|file:////srv/share/"]) {
      const tree = createTree();
      setRootScopes(tree, parseRoots(text));
      setConfiguredRoots(tree, []);
      expect(tree.roots.map(n => n.id)).toEqual(["host:srv"]);
      expect(visibleNodes(tree).map(i => i.node.id)).toEqual(["host:srv"]);
    }
  });

  describe("the request-size budget", () => {
    // exactly what api.js qs() does for an array value
    const encoded = roots => {
      const u = new URLSearchParams();
      roots.forEach(r => u.append("facet.query", scopeClause(r)));
      return u.toString().length;
    };
    const japanese = Array.from({ length: 20 }, (_, i) => `smb://fileserver/共有フォルダ/営業本部/第${i}課/令和六年度の資料/`);

    it("measures a clause the way api.js builds the query string", () => {
      const clause = scopeClause(url(japanese[0]));
      expect(queryBytes(clause)).toBe(encoded([url(japanese[0])]) + 1);
      expect(queryBytes(clause)).toBeGreaterThan(clause.length * 2);
    });

    it("20 Japanese roots are cut at the budget, in the order written", () => {
      const all = japanese.map(p => url(p));
      expect(encoded(all)).toBeGreaterThan(ROOTS_QUERY_BUDGET);
      const kept = parseRoots(japanese.join("|"));
      expect(kept.length).toBeLessThan(20);
      expect(kept.length).toBeGreaterThan(0);
      expect(kept).toEqual(all.slice(0, kept.length));
      expect(encoded(kept)).toBeLessThanOrEqual(ROOTS_QUERY_BUDGET);
      expect(encoded(all.slice(0, kept.length + 1))).toBeGreaterThan(ROOTS_QUERY_BUDGET - 1);
    });

    it("short ASCII roots all fit (the budget does not bite the ordinary case)", () => {
      const many = Array.from({ length: MAX_ROOTS }, (_, i) => "smb://srv/share/Dept" + i + "/").join("|");
      expect(parseRoots(many).length).toBe(MAX_ROOTS);
    });

    it("a deep selection under long roots keeps the whole request within QUERY_BUDGET", () => {
      const roots = parseRoots(japanese.join("|"));
      let prefix = roots[0].prefix;
      const chain = [roots[0]];
      for (let i = 0; i < 12; i++) { prefix += "サブフォルダ" + i + "/"; chain.push(url(prefix)); }
      const clauses = rootsParams({ q: "" }, chain, roots)["facet.query"];
      expect(clauses.slice(0, roots.length)).toEqual(roots.map(scopeClause));
      expect(clauses.length).toBeLessThan(roots.length + chain.length - 1);
      expect(clauses.reduce((n, c) => n + queryBytes(c), 0)).toBeLessThanOrEqual(QUERY_BUDGET);
      // the ancestors that fit are the ones nearest the root
      expect(clauses.slice(roots.length)).toEqual(chain.slice(1, 1 + clauses.length - roots.length).map(scopeClause));
    });
  });

  it("a root is a scope the tree and the search treat like any clicked folder", () => {
    const [root] = parseRoots('smb://srv/share/Q1 "final" (draft)/');
    expect(parseScopeClause(scopeClause(root))).toEqual(root);
  });

  it("signs a set of roots so a cache can tell when the configuration changed", () => {
    expect(rootsSignature(parseRoots("smb://srv/a/|smb://srv/b/"))).not.toBe(rootsSignature(parseRoots("smb://srv/a/")));
    expect(rootsSignature([])).toBe("");
    expect(rootsSignature(undefined)).toBe("");
  });
});

describe("the tree model with roots", () => {
  const roots = parseRoots("smb://srv/share/Main Repository/Documents/|file:/data/docs/");

  function rooted() {
    const tree = createTree();
    setRootScopes(tree, roots);
    return tree;
  }

  it("lists the roots as the top level, labelled by their last folder", () => {
    const tree = rooted();
    setConfiguredRoots(tree, []);
    expect(tree.roots.map(n => n.label)).toEqual(["docs", "Documents"]);
    expect(tree.roots.every(n => n.parent === null)).toBe(true);
  });

  it("falls back to the host for a whole source, and tells equal labels apart by their path", () => {
    const tree = createTree();
    setRootScopes(tree, parseRoots("smb://srv|smb://a/x/Documents/|smb://b/y/Documents/"));
    setConfiguredRoots(tree, []);
    expect(tree.roots.map(n => n.label).sort()).toEqual(["\\\\a\\x\\Documents", "\\\\b\\y\\Documents", "srv"].sort());
  });

  it("leaves out a root counted 0, keeps one that was not counted, and counts the rest", () => {
    const tree = rooted();
    const fq = [{ value: scopeClause(roots[0]), count: 0 }, { value: scopeClause(roots[1]), count: 7 }];
    setConfiguredRoots(tree, fq);
    applyClauseCounts(tree, fq);
    expect(tree.roots.map(n => [n.label, n.count])).toEqual([["docs", 7]]);
    setConfiguredRoots(tree, undefined);
    expect(tree.roots.length).toBe(2);
    setConfiguredRoots(tree, [{ value: scopeClause(roots[1]), count: 7 }]);
    expect(tree.roots.length).toBe(2);
  });

  it("never adds the source or any folder above a root, for a selected folder or a result page", () => {
    const tree = rooted();
    setConfiguredRoots(tree, []);
    const node = ensurePath(tree, url("smb://srv/share/Main Repository/Documents/2026/Q1/"));
    expect(node.label).toBe("Q1");
    mergeSeen(tree, [
      { url: "file:/data/docs/a/b.txt" },
      { url: "smb://srv/share/Other/c.txt" },
      { url: "smb://srv/share/Main Repository/readme.txt" },
    ]);
    expect(tree.roots.map(n => n.label)).toEqual(["docs", "Documents"]);
    expect([...tree.index.keys()].every(id => id.startsWith("url:smb://srv/share/Main Repository/Documents/") || id.startsWith("url:file:/data/docs/"))).toBe(true);
    expect(tree.index.has("host:srv")).toBe(false);
    expect(tree.index.has("host:localhost")).toBe(false);
  });

  it("a folder outside every root is not in the tree, and has no path in it", () => {
    const tree = rooted();
    expect(ensurePath(tree, url("smb://srv/share/Other/"))).toBeNull();
    expect(ensurePath(tree, { type: "host", host: "srv" })).toBeNull();
    expect(chainOf(tree, url("smb://srv/share/Other/"))).toEqual([]);
    expect(tree.roots).toEqual([]);
  });

  it("the path to a folder starts at its root", () => {
    const tree = rooted();
    expect(chainOf(tree, url("file:/data/docs/a/b/"))).toEqual([url("file:/data/docs/"), url("file:/data/docs/a/"), url("file:/data/docs/a/b/")]);
    expect(chainOf(tree, url("file:/data/docs/"))).toEqual([url("file:/data/docs/")]);
  });

  it("without roots the path still starts at the source", () => {
    const tree = createTree();
    expect(chainOf(tree, url("file:/data/docs/a/"))[0]).toEqual({ type: "host", host: "localhost" });
  });

  it("a root expands like any folder", () => {
    const tree = rooted();
    setConfiguredRoots(tree, []);
    const node = tree.roots.find(n => n.label === "Documents");
    applyFold(tree, node, { children: [{ prefix: roots[0].prefix + "2026/", label: "2026", count: 3, scheme: "smb", showScheme: false }], direct: 0, total: 3, exact: true });
    node.expanded = true;
    expect(visibleNodes(tree).map(i => [i.node.label, i.level])).toEqual([["docs", 1], ["Documents", 1], ["2026", 2]]);
  });

  it("changing the roots starts a new tree", () => {
    const tree = rooted();
    setConfiguredRoots(tree, []);
    setRootScopes(tree, []);
    expect(tree.rootScopes).toBeNull();
    expect(tree.roots).toEqual([]);
    expect(tree.index.size).toBe(0);
  });
});

describe("the request that counts the roots", () => {
  const roots = parseRoots("smb://srv/share/Main Repository/Documents/|file:/data/docs/");

  it("asks for one facet.query per root and no host facet", () => {
    const p = rootsParams({ q: "report", ex_q: ["filetype:pdf"] }, undefined, roots);
    expect(p["facet.query"]).toEqual(roots.map(scopeClause));
    expect(p["facet.field"]).toBeUndefined();
    expect(p).toMatchObject({ q: "report", ex_q: ["filetype:pdf"], start: 0, num: 1 });
  });

  it("escapes the prefix: the space and the quotes of a root cannot end the clause", () => {
    const [quoted] = parseRoots('smb://srv/share/Q1 "final" report/');
    expect(scopeClause(quoted)).toBe('url:smb\\:\\/\\/srv\\/share\\/Q1\\ \\"final\\"\\ report\\/*');
    expect(rootsParams({ q: "" }, undefined, [quoted])["facet.query"]).toEqual([scopeClause(quoted)]);
  });

  it("counts the ancestors from the root down in the same list, a root once", () => {
    const chain = [roots[1], url("file:/data/docs/a/")];
    const p = rootsParams({ q: "x" }, chain, roots);
    expect(p["facet.query"]).toEqual([...roots.map(scopeClause), scopeClause(chain[1])]);
  });

  it("with no condition at all, asks for every document", () => {
    expect(rootsParams({ q: "" }, undefined, roots).ex_q).toEqual(["url:*"]);
  });

  it("without roots the request is the one for the sources", () => {
    expect(rootsParams({ q: "" }, undefined, [])["facet.field"]).toEqual(["host"]);
    expect(rootsParams({ q: "" })["facet.field"]).toEqual(["host"]);
  });

  it("loadRoots hands the counts back and does not need a host facet", async () => {
    api.get.mockResolvedValue({ facet_query: [{ value: scopeClause(roots[0]), count: 4 }], permission_state: "OK" });
    const out = await loadRoots({ q: "" }, { roots });
    expect(out).toEqual({ available: true, buckets: [], facetQuery: [{ value: scopeClause(roots[0]), count: 4 }], permissionState: "OK" });
  });

  it("loadRoots with an answer without facet_query (some rank-fusion searches) is still available", async () => {
    api.get.mockResolvedValue({ record_count: 3 });
    const out = await loadRoots({ q: "x" }, { roots });
    expect(out.available).toBe(true);
    expect(out.facetQuery).toBeUndefined();
  });
});

describe("tree view with roots", () => {
  const XSS = '<img src=x onerror="window.__pwned=1">';
  const roots = parseRoots(`smb://srv/share/Main Repository/Documents/|file:/data/${XSS}/`);

  function makeSource(counts) {
    return {
      loadRoots: vi.fn(async (base, { roots: r }) => ({
        available: true, buckets: [], permissionState: "OK",
        facetQuery: (r || []).map(s => ({ value: scopeClause(s), count: counts ? counts(s) : 5 })),
      })),
      loadChildren: vi.fn(async (base, scope) => ({
        available: true, permissionState: "OK",
        fold: { children: [{ prefix: scope.prefix + "2026/", label: "2026", count: 2, scheme: "smb", showScheme: false }], direct: 1, total: 3, exact: true },
      })),
    };
  }

  function mount(opts = {}) {
    document.body.innerHTML = '<div id="t"></div><div id="s"></div>';
    const source = opts.source || makeSource();
    const onSelect = vi.fn();
    const view = createTreeView({
      root: document.getElementById("t"), status: document.getElementById("s"),
      source, getBase: () => ({ q: "" }), onSelect, getRoots: () => opts.roots || roots, browse: !!opts.browse,
    });
    return { view, source, onSelect };
  }
  const items = () => [...document.querySelectorAll("[role=treeitem]")];
  const labels = () => items().map(i => i.querySelector(".fs-node-label").textContent);

  it("home: the top level is the roots, labelled by the last folder, with the full prefix as title", async () => {
    const { view, source } = mount({ browse: true });
    await view.loadHome();
    expect(labels()).toEqual([XSS, "Documents"]);
    expect(items().map(i => i.title)).toEqual([`file:/data/${XSS}/`, "smb://srv/share/Main Repository/Documents/"]);
    expect(source.loadRoots).toHaveBeenCalledTimes(1);
    expect(source.loadRoots.mock.calls[0][1].roots).toEqual(roots);
  });

  it("renders a hostile root path as text, never as markup", async () => {
    const { view } = mount();
    await view.loadHome();
    expect(document.querySelector("#t img")).toBeNull();
    expect(window.__pwned).toBeUndefined();
    expect(document.getElementById("t").textContent).toContain(XSS);
    expect(document.querySelector("#t [title]").getAttribute("title")).toContain("onerror");
  });

  it("choosing a root scopes the search to that prefix, like choosing a folder", async () => {
    const { view, onSelect } = mount();
    await view.loadHome();
    items().find(i => i.querySelector(".fs-node-label").textContent === "Documents").querySelector(".fs-node-label").click();
    expect(onSelect).toHaveBeenCalledWith({ type: "url", prefix: "smb://srv/share/Main Repository/Documents/" });
    expect(scopeClause(onSelect.mock.calls[0][0])).toBe("url:smb\\:\\/\\/srv\\/share\\/Main\\ Repository\\/Documents\\/*");
  });

  it("a root expands to its folders, asking only inside the root", async () => {
    const { view, source } = mount();
    await view.loadHome();
    const doc = items().find(i => i.querySelector(".fs-node-label").textContent === "Documents");
    doc.querySelector(".fs-twisty").click();
    await vi.waitFor(() => expect(items().length).toBe(3));
    expect(source.loadChildren.mock.calls[0][1]).toEqual({ type: "url", prefix: "smb://srv/share/Main Repository/Documents/" });
    expect(items().map(i => i.getAttribute("aria-level"))).toEqual(["1", "1", "2"]);
  });

  it("a root with no document is left out of the tree", async () => {
    const { view } = mount({ source: makeSource(s => (s.prefix.startsWith("file:") ? 0 : 9)) });
    await view.loadHome();
    expect(labels()).toEqual(["Documents"]);
  });

  it("the tree beside the results shows counts and builds the path from the root down", async () => {
    const { view, source } = mount();
    const scope = { type: "url", prefix: "smb://srv/share/Main Repository/Documents/2026/" };
    await view.sync({ key: "k", scope, docs: [{ url: "smb://srv/share/Main Repository/Documents/2026/a.txt" }, { url: "smb://srv/share/Other/b.txt" }] });
    expect(source.loadRoots.mock.calls[0][1].ancestors).toEqual([
      { type: "url", prefix: "smb://srv/share/Main Repository/Documents/" }, scope,
    ]);
    expect(items().some(i => i.querySelector(".fs-node-count"))).toBe(true);
    expect(labels()).not.toContain("srv");
    expect(labels()).not.toContain("share");
    expect(labels()).toContain("2026");
  });

  it("a selected folder outside every root leaves the tree as it is", async () => {
    const { view } = mount();
    await view.sync({ key: "k", scope: { type: "url", prefix: "smb://elsewhere/x/" }, docs: [], count: 3, relation: "EQUAL_TO" });
    expect(labels()).toEqual([XSS, "Documents"]);
    expect(items().some(i => i.getAttribute("aria-selected") === "true")).toBe(false);
  });

  it("without roots the tree starts at the sources, as before", async () => {
    const source = {
      loadRoots: vi.fn(async () => ({ available: true, buckets: [{ value: "srv", count: 4 }], facetQuery: undefined, permissionState: "OK" })),
      loadChildren: vi.fn(),
    };
    const { view } = mount({ source, roots: [] });
    await view.loadHome();
    expect(labels()).toEqual(["srv"]);
    expect(items()[0].title).toBe("");
    expect(source.loadRoots.mock.calls[0][1].roots).toBeUndefined();
  });

  it("follows a changed configuration (the settings arrive with a later /ui/config)", async () => {
    document.body.innerHTML = '<div id="t"></div><div id="s"></div>';
    let current = [];
    const source = {
      loadRoots: vi.fn(async (base, { roots: r }) => (r
        ? { available: true, buckets: [], facetQuery: [], permissionState: "OK" }
        : { available: true, buckets: [{ value: "srv", count: 4 }], permissionState: "OK" })),
      loadChildren: vi.fn(),
    };
    const view = createTreeView({ root: document.getElementById("t"), source, getBase: () => ({ q: "" }), onSelect: () => {}, getRoots: () => current });
    await view.loadHome();
    expect(labels()).toEqual(["srv"]);
    current = roots;
    await view.loadHome();
    expect(labels()).toEqual([XSS, "Documents"]);
    current = [];
    await view.loadHome();
    expect(labels()).toEqual(["srv"]);
    expect(source.loadRoots).toHaveBeenCalledTimes(3);
  });
});
