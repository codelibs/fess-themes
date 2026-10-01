// SPDX-License-Identifier: Apache-2.0
// filesearch: tree.js — folding the url facet into child folders, the count / "≥" rules,
// and the sparse tree model the folder pane renders.

import { describe, it, expect } from "vitest";
import {
  foldUrls, createTree, setRoots, applyFold, ensurePath, mergeSeen, visibleNodes,
  countLabel, findNode, setExpanded, applyClauseCounts,
} from "../themes/filesearch/assets/tree.js";
import { scopeClause } from "../themes/filesearch/assets/scope.js";

const b = (value, count = 1) => ({ value, count });
const HOST = { type: "host", host: "srv" };
const SHARE = { type: "url", prefix: "smb://srv/share/" };

const SMB_BUCKETS = [
  b("smb://srv/share/a/x.txt"), b("smb://srv/share/a/y.txt"), b("smb://srv/share/b/z.txt", 2),
  b("smb://srv/other/q.txt"), b("smb://srv/rootfile.txt"),
];

describe("foldUrls", () => {
  it("folds a source's URLs into its first-level folders with counts", () => {
    const f = foldUrls(HOST, SMB_BUCKETS, { total: 6, relation: "EQUAL_TO" });
    expect(f.children.map(c => [c.label, c.prefix, c.count])).toEqual([
      ["other", "smb://srv/other/", 1],
      ["share", "smb://srv/share/", 4],
    ]);
    expect(f.direct).toBe(1);
    expect(f.total).toBe(6);
    expect(f.exact).toBe(true);
  });

  it("folds a folder's URLs into its sub-folders, ignoring URLs outside it", () => {
    const f = foldUrls(SHARE, SMB_BUCKETS, { total: 4, relation: "EQUAL_TO" });
    expect(f.children.map(c => [c.label, c.prefix, c.count])).toEqual([
      ["a", "smb://srv/share/a/", 2],
      ["b", "smb://srv/share/b/", 2],
    ]);
    expect(f.direct).toBe(0);
  });

  it("counts a file directly inside the folder as direct, not as a child", () => {
    const f = foldUrls(SHARE, [b("smb://srv/share/readme.txt"), b("smb://srv/share/a/x.txt")], { total: 2, relation: "EQUAL_TO" });
    expect(f.direct).toBe(1);
    expect(f.children).toHaveLength(1);
  });

  it("keeps the raw prefix but shows the decoded folder name", () => {
    const f = foldUrls(SHARE, [b("smb://srv/share/dir%20a/x.txt")], { total: 1, relation: "EQUAL_TO" });
    expect(f.children[0]).toMatchObject({ label: "dir a", prefix: "smb://srv/share/dir%20a/" });
  });

  it("orders folders by name, numbers by value, ignoring case", () => {
    const f = foldUrls(SHARE, [b("smb://srv/share/b10/x"), b("smb://srv/share/B2/x"), b("smb://srv/share/a/x")], { total: 3, relation: "EQUAL_TO" });
    expect(f.children.map(c => c.label)).toEqual(["a", "B2", "b10"]);
  });

  it("folds file: URLs under localhost, UNC and drive forms alike", () => {
    expect(foldUrls({ type: "host", host: "localhost" }, [b("file:/home/u/a.txt"), b("file:/C:/x/y.txt")], { total: 2, relation: "EQUAL_TO" })
      .children.map(c => c.prefix)).toEqual(["file:/C:/", "file:/home/"]);
    expect(foldUrls({ type: "host", host: "srv" }, [b("file:////srv/share/d/a.txt")], { total: 1, relation: "EQUAL_TO" })
      .children.map(c => [c.label, c.prefix])).toEqual([["share", "file:////srv/share/"]]);
  });

  it("treats object-store keys and web paths as folders", () => {
    expect(foldUrls({ type: "host", host: "bucket" }, [b("s3://bucket/key/obj"), b("s3://bucket/other/o2")], { total: 2, relation: "EQUAL_TO" })
      .children.map(c => c.prefix)).toEqual(["s3://bucket/key/", "s3://bucket/other/"]);
    expect(foldUrls({ type: "host", host: "ex.com" }, [b("https://ex.com/docs/a.html?x=1"), b("https://ex.com/")], { total: 2, relation: "EQUAL_TO" })
      .children.map(c => c.prefix)).toEqual(["https://ex.com/docs/"]);
  });

  it("flags same-named folders of different schemes so the UI can tell them apart", () => {
    const f = foldUrls({ type: "host", host: "h" }, [b("https://h/docs/a.html"), b("http://h/docs/b.html")], { total: 2, relation: "EQUAL_TO" });
    expect(f.children).toHaveLength(2);
    expect(f.children.every(c => c.showScheme)).toBe(true);
    expect(foldUrls(HOST, SMB_BUCKETS, { total: 6, relation: "EQUAL_TO" }).children.some(c => c.showScheme)).toBe(false);
  });

  it("skips values that are not URLs", () => {
    const f = foldUrls(HOST, [b("garbage"), b("smb://srv/share/a/x.txt")], { total: 2, relation: "EQUAL_TO" });
    expect(f.children).toHaveLength(1);
  });

  describe("exactness", () => {
    it("is exact when the buckets add up to the hits the request matched", () => {
      expect(foldUrls(SHARE, [b("smb://srv/share/a/x", 3)], { total: 3, relation: "EQUAL_TO" }).exact).toBe(true);
    });
    it("is not exact when the facet was truncated (fewer URLs than hits)", () => {
      expect(foldUrls(SHARE, [b("smb://srv/share/a/x", 3)], { total: 1500, relation: "EQUAL_TO" }).exact).toBe(false);
    });
    it("is not exact when the total is a lower bound or unknown", () => {
      expect(foldUrls(SHARE, [b("smb://srv/share/a/x")], { total: 1, relation: "GREATER_THAN_OR_EQUAL_TO" }).exact).toBe(false);
      expect(foldUrls(SHARE, [b("smb://srv/share/a/x")], {}).exact).toBe(false);
      expect(foldUrls(SHARE, [b("smb://srv/share/a/x")]).exact).toBe(false);
    });
    it("counts unparseable buckets towards exactness", () => {
      expect(foldUrls(HOST, [b("garbage"), b("smb://srv/share/a/x")], { total: 2, relation: "EQUAL_TO" }).exact).toBe(true);
    });
  });
});

describe("countLabel", () => {
  it("is empty when the count is unknown, a number when exact, and ≥number when approximate", () => {
    expect(countLabel({ count: null, approx: false })).toBe("");
    expect(countLabel({ count: 12, approx: false })).toBe("12");
    expect(countLabel({ count: 12, approx: true })).toBe("≥12");
    expect(countLabel({ count: 0, approx: false })).toBe("0");
    expect(countLabel(null)).toBe("");
  });
  it("groups thousands", () => {
    expect(countLabel({ count: 12345, approx: false }, "en-US")).toBe("12,345");
  });
});

describe("tree model", () => {
  it("setRoots creates one sorted root per host, with exact counts", () => {
    const tree = createTree();
    setRoots(tree, [b("srv", 10), b("ex.com", 3)]);
    expect(tree.roots.map(r => [r.id, r.label, r.count, r.approx, r.loaded, r.expanded])).toEqual([
      ["host:ex.com", "ex.com", 3, false, false, false],
      ["host:srv", "srv", 10, false, false, false],
    ]);
  });

  it("setRoots keeps the state of a root that is still listed and updates its count", () => {
    const tree = createTree();
    setRoots(tree, [b("srv", 10)]);
    const srv = tree.roots[0];
    applyFold(tree, srv, foldUrls(HOST, SMB_BUCKETS, { total: 6, relation: "EQUAL_TO" }));
    setExpanded(tree, srv, true);
    setRoots(tree, [b("srv", 7), b("new", 1)]);
    const again = findNode(tree, HOST);
    expect(again).toBe(srv);
    expect(again.count).toBe(7);
    expect(again.expanded).toBe(true);
    expect(again.children).toHaveLength(2);
  });

  it("setRoots drops roots the new answer no longer lists, unless asked to keep the selection's", () => {
    const tree = createTree();
    setRoots(tree, [b("a", 1), b("b", 1)]);
    setRoots(tree, [b("a", 1)]);
    expect(tree.roots.map(r => r.id)).toEqual(["host:a"]);
    expect(findNode(tree, { type: "host", host: "b" })).toBeNull();
  });

  it("applyFold turns folded children into nodes: approximate unless the fold was exact", () => {
    const tree = createTree();
    setRoots(tree, [b("srv", 6)]);
    const srv = tree.roots[0];
    applyFold(tree, srv, foldUrls(HOST, SMB_BUCKETS, { total: 99, relation: "EQUAL_TO" }));
    expect(srv.loaded).toBe(true);
    expect(srv.children.map(c => [c.id, c.count, c.approx, c.parent === srv])).toEqual([
      ["url:smb://srv/other/", 1, true, true],
      ["url:smb://srv/share/", 4, true, true],
    ]);
    applyFold(tree, srv, foldUrls(HOST, SMB_BUCKETS, { total: 6, relation: "EQUAL_TO" }));
    expect(srv.children.every(c => c.approx === false)).toBe(true);
  });

  it("applyFold marks a node whose fold was only a sample as partial: folders may be missing, not just counts", () => {
    const tree = createTree();
    setRoots(tree, [b("srv", 6)]);
    const srv = tree.roots[0];
    expect(srv.partial).toBe(false);
    applyFold(tree, srv, foldUrls(HOST, SMB_BUCKETS, { total: 99, relation: "EQUAL_TO" }));
    expect(srv.partial).toBe(true);
    applyFold(tree, srv, foldUrls(HOST, SMB_BUCKETS, { total: 6, relation: "EQUAL_TO" }));
    expect(srv.partial).toBe(false);
  });

  it("applyFold keeps what was learned about a folder across a reload", () => {
    const tree = createTree();
    setRoots(tree, [b("srv", 6)]);
    const srv = tree.roots[0];
    applyFold(tree, srv, foldUrls(HOST, SMB_BUCKETS, { total: 6, relation: "EQUAL_TO" }));
    const share = findNode(tree, SHARE);
    applyFold(tree, share, foldUrls(SHARE, SMB_BUCKETS, { total: 4, relation: "EQUAL_TO" }));
    setExpanded(tree, share, true);
    applyFold(tree, srv, foldUrls(HOST, SMB_BUCKETS, { total: 6, relation: "EQUAL_TO" }));
    expect(findNode(tree, SHARE)).toBe(share);
    expect(share.expanded).toBe(true);
    expect(share.children).toHaveLength(2);
  });

  it("applyFold drops nodes an exact fold no longer lists, but keeps folders seen in results when the fold is partial", () => {
    const tree = createTree();
    setRoots(tree, [b("srv", 6)]);
    const srv = tree.roots[0];
    ensurePath(tree, { type: "url", prefix: "smb://srv/gone/" });
    applyFold(tree, srv, foldUrls(HOST, SMB_BUCKETS, { total: 6, relation: "EQUAL_TO" }));
    expect(srv.children.map(c => c.label)).toEqual(["other", "share"]);

    ensurePath(tree, { type: "url", prefix: "smb://srv/seen/" });
    mergeSeen(tree, [{ url: "smb://srv/seen/x.txt" }]);
    applyFold(tree, srv, foldUrls(HOST, SMB_BUCKETS, { total: 600, relation: "EQUAL_TO" }));
    expect(srv.children.map(c => c.label)).toEqual(["other", "seen", "share"]);
  });

  it("ensurePath builds the chain from the source, expanding the ancestors, and is idempotent", () => {
    const tree = createTree();
    const node = ensurePath(tree, { type: "url", prefix: "smb://srv/share/dir/" });
    expect(node.id).toBe("url:smb://srv/share/dir/");
    expect(node.count).toBeNull();
    expect(node.label).toBe("dir");
    const chain = [];
    for (let n = node; n; n = n.parent) chain.unshift(n.id);
    expect(chain).toEqual(["host:srv", "url:smb://srv/share/", "url:smb://srv/share/dir/"]);
    expect(findNode(tree, HOST).expanded).toBe(true);
    expect(findNode(tree, SHARE).expanded).toBe(true);
    expect(node.expanded).toBe(false);
    expect(ensurePath(tree, { type: "url", prefix: "smb://srv/share/dir/" })).toBe(node);
    expect(tree.roots).toHaveLength(1);
  });

  it("ensurePath can build a path without expanding it", () => {
    const tree = createTree();
    ensurePath(tree, { type: "url", prefix: "smb://srv/share/dir/" }, { expand: false });
    expect(findNode(tree, HOST).expanded).toBe(false);
  });

  it("ensurePath returns null for no scope", () => {
    expect(ensurePath(createTree(), null)).toBeNull();
  });

  it("mergeSeen adds the folders the current page's documents sit in, unexpanded and uncounted", () => {
    const tree = createTree();
    setRoots(tree, [b("srv", 3)]);
    mergeSeen(tree, [{ url: "smb://srv/share/a/x.txt" }, { url: "smb://srv/share/a/y.txt" }, { url: "smb://srv/top.txt" }, { url: "junk" }, {}]);
    const a = findNode(tree, { type: "url", prefix: "smb://srv/share/a/" });
    expect(a).not.toBeNull();
    expect(a.seen).toBe(true);
    expect(a.count).toBeNull();
    expect(findNode(tree, HOST).expanded).toBe(false);
    expect(tree.roots).toHaveLength(1);
  });

  it("visibleNodes lists the open part of the tree with level, position and set size", () => {
    const tree = createTree();
    setRoots(tree, [b("srv", 6), b("ex.com", 1)]);
    const srv = findNode(tree, HOST);
    applyFold(tree, srv, foldUrls(HOST, SMB_BUCKETS, { total: 6, relation: "EQUAL_TO" }));
    expect(visibleNodes(tree).map(v => v.node.id)).toEqual(["host:ex.com", "host:srv"]);
    setExpanded(tree, srv, true);
    const vis = visibleNodes(tree);
    expect(vis.map(v => [v.node.id, v.level, v.posInSet, v.setSize])).toEqual([
      ["host:ex.com", 1, 1, 2],
      ["host:srv", 1, 2, 2],
      ["url:smb://srv/other/", 2, 1, 2],
      ["url:smb://srv/share/", 2, 2, 2],
    ]);
  });

  it("findNode looks a scope up by its key", () => {
    const tree = createTree();
    setRoots(tree, [b("srv", 1)]);
    expect(findNode(tree, HOST)).toBe(tree.roots[0]);
    expect(findNode(tree, SHARE)).toBeNull();
    expect(findNode(tree, null)).toBeNull();
  });

  it("applyClauseCounts fills exact counts from facet.query answers keyed by clause", () => {
    const tree = createTree();
    const share = ensurePath(tree, SHARE);
    applyClauseCounts(tree, [
      { value: scopeClause(SHARE), count: 42 },
      { value: scopeClause(HOST), count: 50 },
      { value: "url:unrelated*", count: 1 },
    ]);
    expect(share.count).toBe(42);
    expect(share.approx).toBe(false);
    expect(findNode(tree, HOST).count).toBe(50);
  });

  it("applyClauseCounts ignores a missing answer", () => {
    const tree = createTree();
    const share = ensurePath(tree, SHARE);
    applyClauseCounts(tree, undefined);
    expect(share.count).toBeNull();
  });
});
