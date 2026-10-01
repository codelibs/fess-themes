// SPDX-License-Identifier: Apache-2.0
// filesearch: the search view end to end, against the theme's real shipped markup. What the
// shared pipeline suites cannot see: the folder scope in the address bar, the tree's
// requests, sorting and its 400 fallback, the filters, the row actions, the preview pane
// and the keyboard. api.get is a double; the DOM is index.html's own <body>.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { resetDom, setLocation } from "./helpers/dom.js";
import { mountIndexBody } from "./helpers/themes.js";
import { FULL_CFG, makeSearchEnv, settle } from "./helpers/searchFlow.js";
import { scopeClause } from "../themes/filesearch/assets/scope.js";
import { resetUnsupported } from "../themes/filesearch/assets/sorting.js";

const THEME = "filesearch";
const SHARE = { type: "url", prefix: "smb://srv/share/" };
const SHARE_CLAUSE = scopeClause(SHARE);

const doc = (id, url, extra = {}) => ({
  doc_id: id, url, url_link: url, title: id, content_title: id, content_description: "snippet " + id,
  filename: url.split("/").pop(), mimetype: "text/plain", filetype: "txt", content_length: 1024,
  last_modified: "2026-01-02T03:04:05Z", ...extra,
});
const DOCS = [
  doc("a1", "smb://srv/share/dir/a1.txt"),
  doc("w2", "smb://srv/share/w2.docx", { mimetype: "application/msword", filetype: "word" }),
  doc("p3", "smb://srv/share/p3.pdf", { mimetype: "application/pdf", filetype: "pdf" }),
];

const CFG = { ...FULL_CFG, features: { ...FULL_CFG.features, thumbnail_enabled: false } };

/** A /search answer for the main list, the roots request (host facet) or a folder's children (url facet). */
function install(get, { main = DOCS, roots, children, mainExtra = {} } = {}) {
  get.mockImplementation(async (path, params) => {
    if (path !== "/search") {
      if (path === "/labels") return { labels: [] };
      if (path === "/popular-words") return { popular_words: [] };
      if (path === "/related-queries") return { queries: [] };
      if (path === "/related-content") return { content: "" };
      return {};
    }
    const facet = params["facet.field"] || [];
    if (params.num === 1 && facet.length === 1 && facet[0] === "host") {
      return roots || { facet_field: [{ name: "host", result: [{ value: "srv", count: 3 }] }], record_count: 3, record_count_relation: "EQUAL_TO" };
    }
    if (params.num === 1 && facet.length === 1 && facet[0] === "url") {
      return children || {
        facet_field: [{ name: "url", result: DOCS.map(d => ({ value: d.url, count: 1 })) }],
        record_count: 3, record_count_relation: "EQUAL_TO",
      };
    }
    return makeSearchEnv(main, {
      facet_field: [{ name: "filetype", result: [{ value: "txt", count: 2 }, { value: "pdf", count: 1 }] }],
      facet_query: [],
      ...mainExtra,
    });
  });
}

const searchCalls = get => get.mock.calls.filter(c => c[0] === "/search").map(c => c[1]);
const mainCalls = get => searchCalls(get).filter(p => p.num !== 1);
const lastMain = get => mainCalls(get).at(-1);
const rows = () => [...document.querySelectorAll("#results .fs-row")];

async function boot({ url = "/search?q=foo", cfg = CFG, ...opts } = {}) {
  setLocation(url);
  const flow = await loadSearchFlow(THEME, cfg);
  install(flow.get, opts);
  mountIndexBody(THEME);
  flow.mod.attach();
  flow.mod.runFromUrl();
  await settle();
  return flow;
}

beforeEach(() => {
  resetDom();
  sessionStorage.clear();
  localStorage.clear();
  resetUnsupported();
  window.scrollTo = () => {};
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { setLocation("/"); vi.restoreAllMocks(); });

describe("folder scope in the address bar", () => {
  it("hydrates the scope from ex_q, narrows the search with it, and shows the folder", async () => {
    const { mod, get } = await boot({ url: "/search?ex_q=" + encodeURIComponent(SHARE_CLAUSE) });
    expect(mod._state.scope).toEqual(SHARE);
    expect(lastMain(get).ex_q).toEqual([SHARE_CLAUSE]);
    const crumbs = [...document.querySelectorAll(".fs-crumb-btn")].map(b => b.textContent);
    expect(crumbs).toEqual(["fs.scope_all", "srv", "share"]);
    expect(document.getElementById("fs-pathtext").textContent).toBe("\\\\srv\\share");
    expect(document.getElementById("fs-crumbs").classList.contains("fs-crumbs--win")).toBe(true);
    expect(document.getElementById("fs-up").disabled).toBe(false);
    expect(document.getElementById("fs-copy-path").disabled).toBe(false);
  });

  it("browses without a keyword: name order, and the first page is a real search", async () => {
    const { get, navigate } = await boot({ url: "/search?ex_q=" + encodeURIComponent(SHARE_CLAUSE) });
    expect(navigate).not.toHaveBeenCalled();
    expect(lastMain(get).q).toBe("");
    expect(lastMain(get).sort).toBe("filename.asc");
  });

  it("sends no sort for a keyword search (relevance), and the explicit sort when there is one", async () => {
    const { get } = await boot({ url: "/search?q=foo" });
    expect(lastMain(get)).not.toHaveProperty("sort");
    const second = await boot({ url: "/search?q=foo&sort=content_length.desc" });
    expect(lastMain(second.get).sort).toBe("content_length.desc");
  });

  it("a click on a folder in the tree pushes a history entry and searches inside it", async () => {
    const { mod, get } = await boot({ url: "/search?q=foo" });
    const before = history.length;
    const node = document.querySelector('#fs-tree [role=treeitem][data-id="host:srv"]');
    expect(node).not.toBeNull();
    node.click();
    await settle();
    expect(mod._state.scope).toEqual({ type: "host", host: "srv" });
    expect(history.length).toBe(before + 1);
    expect(new URLSearchParams(location.search).getAll("ex_q")).toEqual(["host:srv"]);
    expect(lastMain(get).ex_q).toEqual(["host:srv"]);
  });

  it("'show in folder' moves the scope to the document's folder, and the source for a file at the root", async () => {
    const { mod } = await boot({ url: "/search?q=foo" });
    rows()[0].querySelector('.fs-act[title="fs.show_in_folder"]').click();
    await settle();
    expect(mod._state.scope).toEqual({ type: "url", prefix: "smb://srv/share/dir/" });
    expect(new URLSearchParams(location.search).getAll("ex_q")).toEqual([scopeClause({ type: "url", prefix: "smb://srv/share/dir/" })]);
    // the second document sits at the root of the share: its folder is the share itself
    rows()[1].querySelector(".fs-loc-btn").click();
    await settle();
    expect(mod._state.scope).toEqual({ type: "url", prefix: "smb://srv/share/" });
  });

  it("the breadcrumb and the up button walk back up, and 'All sources' clears the scope", async () => {
    const { mod } = await boot({ url: "/search?ex_q=" + encodeURIComponent(scopeClause({ type: "url", prefix: "smb://srv/share/dir/" })) });
    document.getElementById("fs-up").click();
    await settle();
    expect(mod._state.scope).toEqual(SHARE);
    document.querySelector(".fs-crumb:first-child .fs-crumb-btn").click();
    await settle();
    expect(mod._state.scope).toBeNull();
  });

  it("a new keyword typed in the header stays inside the folder", async () => {
    const { navigate } = await boot({ url: "/search?q=old&ex_q=" + encodeURIComponent(SHARE_CLAUSE) });
    document.getElementById("query").value = "new";
    document.getElementById("search-form").dispatchEvent(new Event("submit", { cancelable: true }));
    const target = navigate.mock.calls.at(-1)[0];
    const params = new URLSearchParams(target.slice(target.indexOf("?") + 1));
    expect(params.get("q")).toBe("new");
    expect(params.getAll("ex_q")).toEqual([SHARE_CLAUSE]);
  });

  it("back and forward restore the scope (the route handler re-reads the URL)", async () => {
    const { mod } = await boot({ url: "/search?ex_q=" + encodeURIComponent(SHARE_CLAUSE) });
    setLocation("/search?q=foo");
    mod.runFromUrl();
    await settle();
    expect(mod._state.scope).toBeNull();
    setLocation("/search?ex_q=" + encodeURIComponent(SHARE_CLAUSE));
    mod.runFromUrl();
    await settle();
    expect(mod._state.scope).toEqual(SHARE);
  });
});

describe("folder tree requests", () => {
  it("asks for the sources with the host facet under the current keyword, without the folder", async () => {
    const { get } = await boot({ url: "/search?q=foo&ex_q=" + encodeURIComponent(SHARE_CLAUSE) });
    const roots = searchCalls(get).find(p => p.num === 1 && p["facet.field"][0] === "host");
    expect(roots).toMatchObject({ q: "foo", start: 0, num: 1, "facet.size": 1000 });
    expect(roots.ex_q).toBeUndefined();
    // the ancestors of the selected folder are counted exactly in the same request
    expect(roots["facet.query"]).toEqual([scopeClause({ type: "host", host: "srv" }), SHARE_CLAUSE]);
  });

  it("shows the sources with their counts, and the selected folder inside its source", async () => {
    await boot({ url: "/search?ex_q=" + encodeURIComponent(SHARE_CLAUSE) });
    const items = [...document.querySelectorAll("#fs-tree [role=treeitem]")];
    expect(items.map(i => i.dataset.id)).toContain("host:srv");
    expect(items.find(i => i.dataset.id === "host:srv").querySelector(".fs-node-count").textContent).toBe("3");
    const selected = document.querySelector('#fs-tree [aria-selected="true"]');
    expect(selected.dataset.id).toBe("url:smb://srv/share/");
    expect(selected.getAttribute("aria-level")).toBe("2");
  });

  it("folds a folder's URLs into its sub-folders and marks a truncated count with ≥", async () => {
    const truncated = {
      facet_field: [{ name: "url", result: [{ value: "smb://srv/share/dir/a1.txt", count: 1 }] }],
      record_count: 5000, record_count_relation: "EQUAL_TO",
    };
    await boot({ url: "/search?ex_q=" + encodeURIComponent(SHARE_CLAUSE), children: truncated });
    const dir = document.querySelector('#fs-tree [data-id="url:smb://srv/share/dir/"]');
    expect(dir).not.toBeNull();
    expect(dir.querySelector(".fs-node-count").textContent).toBe("≥1");
  });

  it("says that a large folder's list may be incomplete, when the facet only sampled it", async () => {
    const sampled = {
      facet_field: [{ name: "url", result: [{ value: "smb://srv/share/dir/a1.txt", count: 1 }] }],
      record_count: 5000, record_count_relation: "EQUAL_TO",
    };
    await boot({ url: "/search?ex_q=" + encodeURIComponent(SHARE_CLAUSE), children: sampled });
    expect(document.getElementById("fs-tree-status").textContent).toBe("fs.tree_partial");
    await boot({ url: "/search?ex_q=" + encodeURIComponent(SHARE_CLAUSE) });
    expect(document.getElementById("fs-tree-status").textContent).toBe("");
  });

  it("expands a closed source with a url facet scoped to it", async () => {
    const { get } = await boot({ url: "/search?q=foo" });
    get.mockClear();
    document.querySelector('#fs-tree [data-id="host:srv"] .fs-twisty').click();
    await settle();
    const children = searchCalls(get).find(p => p["facet.field"] && p["facet.field"][0] === "url");
    expect(children).toMatchObject({ q: "foo", num: 1, ex_q: ["host:srv"] });
    expect(document.querySelector('#fs-tree [data-id="url:smb://srv/share/"]')).not.toBeNull();
  });

  it("opens a chain of single sub-folders in one go, and stops where there is a choice", async () => {
    const flow = await loadSearchFlow(THEME, CFG);
    const urls = ["smb://srv/data/files/Sales/a.txt", "smb://srv/data/files/HR/b.txt"];
    flow.get.mockImplementation(async (path, params) => {
      if (path !== "/search") return {};
      const facet = params["facet.field"] || [];
      if (params.num === 1 && facet[0] === "host") return { facet_field: [{ name: "host", result: [{ value: "srv", count: 2 }] }] };
      if (params.num === 1 && facet[0] === "url") {
        return { facet_field: [{ name: "url", result: urls.map(value => ({ value, count: 1 })) }], record_count: 2, record_count_relation: "EQUAL_TO" };
      }
      return makeSearchEnv([]);
    });
    setLocation("/");
    mountIndexBody(THEME);
    flow.mod.attach();
    flow.mod.renderHomeBrowse();
    await settle();
    document.querySelector('#home-tree [data-id="host:srv"] .fs-twisty').click();
    await settle();
    await settle();
    const ids = [...document.querySelectorAll("#home-tree [role=treeitem]")].map(n => n.dataset.id);
    expect(ids).toEqual([
      "host:srv", "url:smb://srv/data/", "url:smb://srv/data/files/", "url:smb://srv/data/files/HR/", "url:smb://srv/data/files/Sales/",
    ]);
    const open = [...document.querySelectorAll("#home-tree [aria-expanded=true]")].map(n => n.dataset.id);
    expect(open).toEqual(["host:srv", "url:smb://srv/data/", "url:smb://srv/data/files/"]);
  });

  it("warns when permissions are still loading, and says so when the facet is missing", async () => {
    await boot({ url: "/search?q=foo", roots: { facet_field: [{ name: "host", result: [{ value: "srv", count: 3 }] }], permission_state: "PENDING" } });
    const warn = document.getElementById("fs-tree-warning");
    expect(warn.classList.contains("d-none")).toBe(false);
    expect(warn.textContent).toBe("errors.user_permissions_loading");
    await boot({ url: "/search?q=foo", roots: { record_count: 3 } });
    expect(document.getElementById("fs-tree-status").textContent).toBe("fs.tree_unavailable");
  });

  it("reports a failed load with a retry instead of an empty tree", async () => {
    const flow = await loadSearchFlow(THEME, CFG);
    flow.get.mockImplementation(async (path, params) => {
      if (path === "/search" && params.num === 1) throw Object.assign(new Error("boom"), { httpStatus: 500 });
      return path === "/search" ? makeSearchEnv(DOCS) : {};
    });
    setLocation("/search?q=foo");
    mountIndexBody(THEME);
    flow.mod.attach();
    flow.mod.runFromUrl();
    await settle();
    expect(document.querySelector("#fs-tree-status button").textContent).toBe("fs.tree_retry");
    expect(document.querySelectorAll("#results .fs-row").length).toBe(3);
  });
});

describe("what Fess actually returns", () => {
  it("shows and copies a file: document's path from url, not from url_link (which drops the first segment)", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await boot({ url: "/search?q=foo", main: [doc("f1", "file:/data/files/Sales/Q%201%20report.xlsx", {
      url_link: "file://data/files/Sales/Q 1 report.xlsx", mimetype: "application/vnd.ms-excel", filetype: "excel", content_length: "2516",
    })] });
    const row = rows()[0];
    expect(row.querySelector(".fs-c-loc").textContent).toBe("/data/files/Sales");
    expect(row.querySelector(".fs-c-size").textContent).toBe("2.5 KB");
    row.querySelector('.fs-act[title="fs.copy_path"]').click();
    await settle();
    expect(writeText).toHaveBeenCalledWith("/data/files/Sales/Q 1 report.xlsx");
    expect(row.querySelector(".fs-name").getAttribute("href")).toMatch(/^go\/\?rt=/);
  });

  it("reads smb: URLs stored decoded (spaces, Japanese) as they are", async () => {
    await boot({ url: "/search?q=foo", main: [doc("s1", "smb://samba01/share/Incident Reports/総務部/a b.docx")] });
    expect(rows()[0].querySelector(".fs-c-loc").textContent).toBe("\\\\samba01\\share\\Incident Reports\\総務部");
  });
});

describe("the folder tree and the url_link Fess builds for each browser", () => {
  // A file: document's url_link depends on the User-Agent (Chromium file://data/...,
  // Firefox file://///data/..., Safari file:////data/...) and is not a path; the tree
  // must show only the folders of the stored url.
  const FOLDERS = ["host:localhost", "url:file:/data/", "url:file:/data/files/", "url:file:/data/files/notes/", "url:file:/data/files/reports/"];
  const files = urlLink => [
    doc("r1", "file:/data/files/reports/q1.txt", { url_link: urlLink + "/reports/q1.txt" }),
    doc("n1", "file:/data/files/notes/n1.txt", { url_link: urlLink + "/notes/n1.txt" }),
  ];
  const treeIds = () => [...document.querySelectorAll("#fs-tree [role=treeitem]")].map(n => n.dataset.id);

  async function bootFiles(urlLink, q = "report") {
    const docs = files(urlLink);
    const flow = await boot({
      url: "/search?q=" + q, main: docs,
      roots: { facet_field: [{ name: "host", result: [{ value: "localhost", count: 2 }] }], record_count: 2, record_count_relation: "EQUAL_TO" },
      children: { facet_field: [{ name: "url", result: docs.map(d => ({ value: d.url, count: 1 })) }], record_count: 2, record_count_relation: "EQUAL_TO" },
    });
    document.querySelector('#fs-tree [data-id="host:localhost"] .fs-twisty').click();
    await settle();
    await settle();
    return flow;
  }

  describe.each([
    ["Chromium", "file://data/files"],
    ["Firefox", "file://///data/files"],
    ["Safari", "file:////data/files"],
  ])("%s", (_browser, urlLink) => {
    it("opens the real folders under the source", async () => {
      await bootFiles(urlLink);
      expect(treeIds()).toEqual(FOLDERS);
    });

    it("grows no folder when the page changes", async () => {
      await bootFiles(urlLink);
      document.querySelector("#pagination li:last-child a").click();
      await settle();
      expect(treeIds()).toEqual(FOLDERS);
    });

    it("grows no folder when the sort changes", async () => {
      await bootFiles(urlLink);
      document.querySelector('.fs-sort-btn[data-col="size"]').click();
      await settle();
      expect(treeIds()).toEqual(FOLDERS);
    });

    it("grows no folder when a folder is chosen", async () => {
      const { mod } = await bootFiles(urlLink);
      document.querySelector('#fs-tree [data-id="url:file:/data/files/reports/"]').click();
      await settle();
      expect(mod._state.scope).toEqual({ type: "url", prefix: "file:/data/files/reports/" });
      expect(treeIds()).toEqual(FOLDERS);
    });
  });
});

describe("a path too deep for an ex_q clause", () => {
  const deepUrl = "file:/data/" + "%E7%B7%8F%E5%8B%99%E9%83%A8/".repeat(60) + "x.txt";

  it("searches from the nearest folder that fits, and says so", async () => {
    const { mod } = await boot({ url: "/search?q=foo", main: [doc("deep", deepUrl)] });
    rows()[0].querySelector(".fs-loc-btn").click();
    await settle();
    expect(scopeClause(mod._state.scope).length).toBeLessThanOrEqual(1000);
    expect(mod._state.scope.prefix.startsWith("file:/data/")).toBe(true);
    const notice = document.getElementById("fs-notice");
    expect(notice.classList.contains("d-none")).toBe(false);
    expect(notice.textContent).toContain("fs.scope_too_long");
  });

  it("says nothing when the folder fits", async () => {
    await boot({ url: "/search?q=foo" });
    rows()[0].querySelector(".fs-loc-btn").click();
    await settle();
    expect(document.getElementById("fs-notice").classList.contains("d-none")).toBe(true);
  });
});

describe("sorting", () => {
  it("a column heading sorts by it, pushes the sort into the address bar, and flips on a second click", async () => {
    const { get } = await boot({ url: "/search?q=foo" });
    document.querySelector('.fs-sort-btn[data-col="size"]').click();
    await settle();
    expect(lastMain(get).sort).toBe("content_length.desc");
    expect(new URLSearchParams(location.search).get("sort")).toBe("content_length.desc");
    document.querySelector('.fs-sort-btn[data-col="size"]').click();
    await settle();
    expect(lastMain(get).sort).toBe("content_length.asc");
    expect(document.querySelector('[role="columnheader"][aria-sort="ascending"] .fs-sort-btn').dataset.col).toBe("size");
  });

  it("the toolbar select and direction button sort too, and relevance is offered only with a keyword", async () => {
    const { get } = await boot({ url: "/search?q=foo" });
    const select = document.getElementById("fs-sort-select");
    expect([...select.options].map(o => o.value)).toEqual(["relevance", "name", "modified", "size", "type", "location"]);
    select.value = "name";
    select.dispatchEvent(new Event("change"));
    await settle();
    expect(lastMain(get).sort).toBe("filename.asc");
    document.getElementById("fs-sort-dir").click();
    await settle();
    expect(lastMain(get).sort).toBe("filename.desc");
    select.value = "relevance";
    select.dispatchEvent(new Event("change"));
    await settle();
    expect(lastMain(get)).not.toHaveProperty("sort");

    await boot({ url: "/search?ex_q=" + encodeURIComponent(SHARE_CLAUSE) });
    expect([...document.getElementById("fs-sort-select").options].map(o => o.value)).not.toContain("relevance");
  });

  it("falls back to the default order, with a notice and results, when the server answers 400 for a sort", async () => {
    const flow = await loadSearchFlow(THEME, CFG);
    flow.get.mockImplementation(async (path, params) => {
      if (path !== "/search") return {};
      if (params.num === 1) return { facet_field: [{ name: "host", result: [] }] };
      if (params.sort === "filetype.asc") throw Object.assign(new Error("Unsupported sort"), { httpStatus: 400, code: "invalid_request" });
      return makeSearchEnv(DOCS);
    });
    setLocation("/search?q=foo&sort=filetype.asc");
    mountIndexBody(THEME);
    flow.mod.attach();
    flow.mod.runFromUrl();
    await settle();
    const mains = flow.get.mock.calls.filter(c => c[0] === "/search" && c[1].num !== 1).map(c => c[1]);
    expect(mains.map(p => p.sort)).toEqual(["filetype.asc", undefined]);
    expect(document.querySelectorAll("#results .fs-row").length).toBe(3);
    const notice = document.getElementById("fs-notice");
    expect(notice.classList.contains("d-none")).toBe(false);
    expect(notice.textContent).toContain("fs.sort_unsupported");
    expect(document.getElementById("search-error").classList.contains("d-none")).toBe(true);
    expect(flow.mod._state.sort).toBe("");
    // the column that failed no longer offers a sort
    expect(document.querySelector('.fs-sort-btn[data-col="type"]').disabled).toBe(true);
  });

  it("still shows a real 400 (a bad query) as an error when no sort was in effect", async () => {
    const flow = await loadSearchFlow(THEME, CFG);
    flow.get.mockImplementation(async (path, params) => {
      if (path === "/search" && params.num !== 1) throw Object.assign(new Error("bad query"), { httpStatus: 400, code: "invalid_request" });
      return {};
    });
    setLocation("/search?q=foo");
    mountIndexBody(THEME);
    flow.mod.attach();
    flow.mod.runFromUrl();
    await settle();
    expect(document.getElementById("search-error").textContent).toBe("bad query");
    expect(document.getElementById("fs-notice").classList.contains("d-none")).toBe(true);
  });
});

describe("filters", () => {
  it("shows the file types the server counted, and choosing one narrows the search and the address bar", async () => {
    const { get, mod } = await boot({ url: "/search?q=foo" });
    expect(lastMain(get)["facet.field"]).toEqual(["filetype", "label"]);
    expect(lastMain(get)["facet.query"]).toHaveLength(9);
    const chips = [...document.querySelectorAll("#fs-filters .fs-fchip")].map(c => c.textContent);
    expect(chips.some(c => c.startsWith("Text"))).toBe(true);
    expect(chips.some(c => c.startsWith("PDF"))).toBe(true);
    document.querySelector("#fs-filters .fs-fchip").click();
    await settle();
    expect(lastMain(get).ex_q).toEqual(["filetype:txt"]);
    expect(new URLSearchParams(location.search).getAll("ex_q")).toEqual(["filetype:txt"]);
    expect(mod._state.facets.filetype).toEqual(["txt"]);
  });

  it("two file types become one OR group; a preset replaces the one in its group", async () => {
    const { get } = await boot({ url: "/search?q=foo" });
    const click = text => [...document.querySelectorAll("#fs-filters .fs-fchip")].find(c => c.textContent.startsWith(text)).click();
    click("Text");
    await settle();
    click("PDF");
    await settle();
    expect(lastMain(get).ex_q).toEqual(["(filetype:txt OR filetype:pdf)"]);
  });

  it("keeps the other file types on offer once one is chosen, by counting them without that choice", async () => {
    const { get } = await boot({ url: "/search?q=foo&ex_q=" + encodeURIComponent("filetype:pdf") });
    const side = searchCalls(get).find(p => p.num === 1 && p["facet.field"].join() === "filetype");
    expect(side).toBeDefined();
    expect(side.q).toBe("foo");
    expect(side.ex_q).toBeUndefined();
    const chips = [...document.querySelectorAll("#fs-filters .fs-fchip")].map(c => c.textContent);
    expect(chips.some(c => c.startsWith("Text"))).toBe(true);
    expect(document.querySelector('#fs-filters .fs-fchip[aria-pressed="true"]').textContent).toMatch(/^PDF/);
  });

  it("does not ask for that when no file type is chosen, and keeps the other filters in it when one is", async () => {
    const { get } = await boot({ url: "/search?q=foo" });
    expect(searchCalls(get).some(p => p.num === 1 && p["facet.field"].join() === "filetype")).toBe(false);
    const second = await boot({ url: "/search?q=foo&ex_q=" + encodeURIComponent("filetype:pdf") + "&ex_q=" + encodeURIComponent("content_length:[0 TO 9999]") });
    const side = searchCalls(second.get).find(p => p.num === 1 && p["facet.field"].join() === "filetype");
    expect(side.ex_q).toEqual(["content_length:[0 TO 9999]"]);
  });

  it("restores filters from a shared link and removes one from its chip", async () => {
    const { get, mod } = await boot({
      url: "/search?q=foo&ex_q=" + encodeURIComponent("filetype:pdf") + "&ex_q=" + encodeURIComponent("content_length:[0 TO 9999]"),
      mainExtra: { facet_query: [{ value: "content_length:[0 TO 9999]", count: 2 }, { value: "content_length:[10000 TO 99999]", count: 0 }] },
    });
    expect(mod._state.facets.filetype).toEqual(["pdf"]);
    expect(mod._state.facetQueries).toEqual(["content_length:[0 TO 9999]"]);
    const chips = [...document.querySelectorAll("#active-chips .active-chip")].map(c => c.textContent);
    expect(chips).toHaveLength(2);
    document.querySelector("#active-chips .active-chip-remove").click();
    await settle();
    expect(lastMain(get).ex_q).toEqual(["content_length:[0 TO 9999]"]);
  });

  it("keeps the whole size group, uncounted, when the response carried no counts for it", async () => {
    await boot({ url: "/search?q=foo", mainExtra: { facet_query: undefined } });
    const sizeRows = [...document.querySelectorAll("#fs-filters .fs-fgroup")].find(g => g.querySelector("legend").textContent === "fs.filter_size");
    expect(sizeRows.querySelectorAll(".fs-fchip").length).toBe(5);
    expect(sizeRows.querySelector(".fs-fchip-count")).toBeNull();
  });
});

describe("rows and their actions", () => {
  it("opens the original through go/ and never through the raw file-system URL", async () => {
    await boot({ url: "/search?q=foo" });
    for (const row of rows()) {
      for (const a of row.querySelectorAll("a[href]")) {
        expect(a.getAttribute("href")).toMatch(/^go\/\?rt=/);
        expect(a.getAttribute("href")).not.toMatch(/smb:|file:/);
        expect(a.getAttribute("rel")).toBe("noopener");
      }
    }
  });

  it("shows name, location, modified, size and a kind icon, with the server's highlighting kept", async () => {
    await boot({ url: "/search?q=foo", main: [doc("h1", "smb://srv/share/dir%20a/h1.pdf", { content_title: "x <strong>hit</strong> &amp; y", mimetype: "application/pdf", filetype: "pdf" })] });
    const row = rows()[0];
    expect(row.querySelector(".fs-name").innerHTML).toContain("<strong>hit</strong>");
    expect(row.querySelector(".fs-name").textContent).toBe("x hit & y");
    expect(row.querySelector(".fs-c-loc").textContent).toBe("\\\\srv\\share\\dir a");
    expect(row.querySelector(".fs-c-size").textContent).toBe("1.0 KB");
    expect(row.querySelector(".fs-ico-pdf")).not.toBeNull();
    expect(row.querySelector(".fs-c-type").textContent).toBe("fs.kind_pdf");
  });

  it("copies the OS path, not the URL, and says so", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await boot({ url: "/search?q=foo" });
    rows()[0].querySelector('.fs-act[title="fs.copy_path"]').click();
    await settle();
    expect(writeText).toHaveBeenCalledWith("\\\\srv\\share\\dir\\a1.txt");
    // the live region is rewritten on the next turn so that a repeated message is read again
    await new Promise(r => setTimeout(r, 60));
    expect(document.getElementById("fs-live").textContent).toBe("fs.path_copied");
  });

  it("offers the favourite star only when the server enables favourites", async () => {
    await boot({ url: "/search?q=foo" });
    expect(document.querySelector(".favorite-btn")).toBeNull();
    await boot({ url: "/search?q=foo", cfg: { ...CFG, features: { ...CFG.features, user_favorite: true } } });
    expect(document.querySelectorAll(".favorite-btn").length).toBe(3);
  });

  it("switches between details, list and tiles, remembers the choice, and works with storage blocked", async () => {
    await boot({ url: "/search?q=foo" });
    const list = document.getElementById("results");
    expect(list.dataset.view).toBe("details");
    document.querySelector('#fs-view-toggle [data-view="tiles"]').click();
    expect(list.dataset.view).toBe("tiles");
    expect(localStorage.getItem("filesearch.view")).toBe("tiles");
    expect(document.querySelector('#fs-view-toggle [data-view="tiles"]').getAttribute("aria-pressed")).toBe("true");
    expect(rows().length).toBe(3);
    // a later visit starts in the saved view
    await boot({ url: "/search?q=foo" });
    expect(document.getElementById("results").dataset.view).toBe("tiles");
  });

  it("falls back to details when localStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
    await boot({ url: "/search?q=foo" });
    expect(document.getElementById("results").dataset.view).toBe("details");
    document.querySelector('#fs-view-toggle [data-view="compact"]').click();
    expect(document.getElementById("results").dataset.view).toBe("compact");
  });
});

describe("keyboard and the preview pane", () => {
  const key = (el, k, opts = {}) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts }));

  it("arrow keys move the selection (roving tabindex) and the preview follows", async () => {
    await boot({ url: "/search?q=foo" });
    const first = rows()[0];
    first.focus();
    key(first, "ArrowDown");
    const [r0, r1] = rows();
    expect(r1.getAttribute("aria-selected")).toBe("true");
    expect(r1.tabIndex).toBe(0);
    expect(r0.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(r1);
    expect(document.getElementById("fs-pv-name").textContent).toBe("w2.docx");
    expect(document.getElementById("fs-preview-body").hidden).toBe(false);
    expect(document.getElementById("fs-pv-path").textContent).toBe("\\\\srv\\share\\w2.docx");
  });

  it("Enter opens the original, Space toggles the pane, Left goes to the tree", async () => {
    await boot({ url: "/search?q=foo" });
    const first = rows()[0];
    first.focus();
    const opened = vi.fn(ev => ev.preventDefault());
    first.querySelector(".fs-name").addEventListener("click", opened);
    key(first, "Enter");
    expect(opened).toHaveBeenCalledTimes(1);
    const workspace = document.getElementById("fs-workspace");
    key(first, " ");
    expect(workspace.dataset.preview).toBe("closed");
    key(first, " ");
    expect(workspace.dataset.preview).toBe("open");
    key(first, "ArrowLeft");
    expect(document.activeElement.getAttribute("role")).toBe("treeitem");
  });

  it("a key typed in a control inside the row is left to the control", async () => {
    await boot({ url: "/search?q=foo" });
    const row = rows()[0];
    const btn = row.querySelector(".fs-loc-btn");
    key(btn, "ArrowDown");
    expect(rows()[1].getAttribute("aria-selected")).toBe("false");
  });

  it("/ focuses the search box unless typing, and Esc closes the preview", async () => {
    await boot({ url: "/search?q=foo" });
    document.getElementById("results-view").removeAttribute("hidden");
    const ev = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement.id).toBe("query");
    const typed = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    document.getElementById("query").dispatchEvent(typed);
    expect(typed.defaultPrevented).toBe(false);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(document.getElementById("fs-workspace").dataset.preview).toBe("closed");
  });

  it("says plainly that a Word document has no preview, after the selection settles", async () => {
    await boot({ url: "/search?q=foo" });
    rows()[1].querySelector(".fs-c-name").click();
    expect(document.getElementById("fs-pv-stage").textContent).not.toContain("fs.preview_none");
    await new Promise(r => setTimeout(r, 320));
    expect(document.getElementById("fs-pv-stage").textContent).toContain("fs.preview_none");
  });

  it("previews plain text through go/ as text, never as markup", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, headers: { get: () => "text/plain; charset=UTF-8" }, body: null,
      arrayBuffer: async () => new TextEncoder().encode("<script>alert(1)</script> plain").buffer,
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await boot({ url: "/search?q=foo" });
      rows()[0].querySelector(".fs-c-name").click();
      await new Promise(r => setTimeout(r, 320));
      await settle();
      const pre = document.querySelector("#fs-pv-stage pre.fs-pv-text");
      expect(pre.textContent).toBe("<script>alert(1)</script> plain");
      expect(pre.querySelector("script")).toBeNull();
      expect(fetchMock.mock.calls[0][0]).toMatch(/^go\/\?rt=/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("loads only the selected row's preview: moving on cancels the one before", async () => {
    const urls = [];
    vi.stubGlobal("fetch", vi.fn(async (u) => { urls.push(u); return { ok: true, status: 200, headers: { get: () => null }, body: null, arrayBuffer: async () => new TextEncoder().encode("x").buffer }; }));
    try {
      await boot({ url: "/search?q=foo" });
      const r0 = rows()[0];
      r0.focus();
      key(r0, "ArrowDown");
      key(rows()[1], "ArrowUp");
      await new Promise(r => setTimeout(r, 340));
      // three selections in a row cost one request: only the settled one loaded
      expect(urls.length).toBe(1);
      expect(urls[0]).toContain("docId=a1");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("leaving the results", () => {
  it("clears the preview and shuts the folder drawer on a route change away from the search", async () => {
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    await boot({ url: "/search?q=foo" });
    rows()[0].querySelector(".fs-c-name").click();
    document.getElementById("fs-tree-toggle").click();
    expect(document.getElementById("fs-workspace").dataset.sheet).toBe("open");
    expect(document.getElementById("fs-workspace").dataset.tree).toBe("open");
    document.dispatchEvent(new CustomEvent("fess:route:change", { detail: { path: "/help" } }));
    expect(document.getElementById("fs-workspace").dataset.sheet).toBe("closed");
    expect(document.getElementById("fs-workspace").dataset.tree).toBe("closed");
    expect(document.getElementById("fs-preview-body").hidden).toBe(true);
  });
});

describe("home", () => {
  it("lists the sources without a keyword by asking for every document", async () => {
    const flow = await loadSearchFlow(THEME, CFG);
    install(flow.get);
    setLocation("/");
    mountIndexBody(THEME);
    flow.mod.attach();
    flow.mod.renderHomeBrowse();
    await settle();
    const roots = searchCalls(flow.get).find(p => p["facet.field"] && p["facet.field"][0] === "host");
    expect(roots).toMatchObject({ q: "", ex_q: ["url:*"], num: 1 });
    const items = document.querySelectorAll("#home-tree [role=treeitem]");
    expect([...items].map(i => i.dataset.id)).toEqual(["host:srv"]);
  });

  it("goes to the results with the source as the scope when one is chosen", async () => {
    const flow = await loadSearchFlow(THEME, CFG);
    install(flow.get);
    setLocation("/");
    mountIndexBody(THEME);
    flow.mod.attach();
    flow.mod.renderHomeBrowse();
    await settle();
    document.querySelector('#home-tree [data-id="host:srv"]').click();
    expect(flow.navigate).toHaveBeenCalledWith("search?ex_q=host%3Asrv");
  });

  it("lists recent searches, newest first, with the keyword search linking to them", async () => {
    await boot({ url: "/search?q=alpha" });
    await boot({ url: "/search?q=beta" });
    const links = [...document.querySelectorAll("#fs-recent a")].map(a => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([["beta", "search?q=beta"], ["alpha", "search?q=alpha"]]);
    document.querySelector("#fs-recent [data-fs-clear-recent]").click();
    expect(document.getElementById("fs-recent").classList.contains("d-none")).toBe(true);
  });
});

describe("preview content", () => {
  const key = (el, k) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  const bytesResponse = (bytes, headers = {}) => ({
    ok: true, status: 200, headers: { get: n => headers[n.toLowerCase()] ?? null }, body: null,
    arrayBuffer: async () => new TextEncoder().encode(bytes).buffer,
  });
  const select = async (index) => {
    rows()[index].querySelector(".fs-c-name").click();
    await new Promise(r => setTimeout(r, 320));
    await settle();
  };

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:test/1");
    URL.revokeObjectURL = vi.fn();
  });

  it("shows a PDF in an unsandboxed frame from a pinned-type Blob, after checking its signature", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => bytesResponse("%PDF-1.4 body")));
    try {
      await boot({ url: "/search?q=foo" });
      await select(2);
      const frame = document.querySelector("#fs-pv-stage iframe.fs-pv-frame");
      expect(frame).not.toBeNull();
      expect(frame.getAttribute("src")).toBe("blob:test/1");
      expect(frame.hasAttribute("sandbox")).toBe(false);
      const blob = URL.createObjectURL.mock.calls[0][0];
      expect(blob.type).toBe("application/pdf");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not show a file that calls itself a PDF but is not one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => bytesResponse("<html><script>alert(1)</script>")));
    try {
      await boot({ url: "/search?q=foo" });
      await select(2);
      expect(document.querySelector("#fs-pv-stage iframe")).toBeNull();
      expect(document.getElementById("fs-pv-stage").textContent).toContain("fs.preview_none");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows the cached copy in a frame with no scripts and no access to the page", async () => {
    const cached = doc("c1", "https://wiki.example.com/page.html", { mimetype: "text/html", filetype: "html", has_cache: "true" });
    const flow = await loadSearchFlow(THEME, CFG);
    install(flow.get, { main: [cached] });
    const base = flow.get.getMockImplementation();
    flow.get.mockImplementation(async (path, params, opts) => (path.startsWith("/cache/")
      ? { doc_id: "c1", mimetype: "text/html", content: "<html><head></head><body>hi</body></html>", url: "https://wiki.example.com/page.html", charset: "UTF-8" }
      : base(path, params, opts)));
    setLocation("/search?q=foo");
    mountIndexBody(THEME);
    flow.mod.attach();
    flow.mod.runFromUrl();
    await settle();
    await select(0);
    const frame = document.querySelector("#fs-pv-stage iframe");
    expect(frame.getAttribute("sandbox")).toBe("allow-popups allow-popups-to-escape-sandbox");
    expect(frame.getAttribute("sandbox")).not.toMatch(/allow-scripts|allow-same-origin/);
    const html = await URL.createObjectURL.mock.calls[0][0].text();
    expect(html).toContain('<base href="https://wiki.example.com/page.html">');
    expect(flow.get.mock.calls.some(c => c[0] === "/cache/c1")).toBe(true);
  });

  it("shows an image through its go/ URL and a too-large file as such", async () => {
    await boot({ url: "/search?q=foo", main: [
      doc("i1", "smb://srv/share/pic.png", { mimetype: "image/png", filetype: "png" }),
      doc("big", "smb://srv/share/big.pdf", { mimetype: "application/pdf", filetype: "pdf", content_length: 80 * 1024 * 1024 }),
    ] });
    await select(0);
    expect(document.querySelector("#fs-pv-stage img.fs-pv-image").getAttribute("src")).toMatch(/^go\/\?rt=/);
    await select(1);
    expect(document.getElementById("fs-pv-stage").textContent).toContain("fs.preview_too_large");
  });

  it("offers the cached copy as a link only for a document that has one", async () => {
    await boot({ url: "/search?q=foo", main: [doc("c2", "smb://srv/share/c2.txt", { has_cache: "true" })] });
    rows()[0].querySelector(".fs-c-name").click();
    const links = [...document.querySelectorAll("#fs-pv-actions a")].map(a => a.getAttribute("href"));
    expect(links.some(h => h.startsWith("cache/?docId=c2"))).toBe(true);
    await boot({ url: "/search?q=foo" });
    rows()[0].querySelector(".fs-c-name").click();
    expect([...document.querySelectorAll("#fs-pv-actions a")].some(a => a.getAttribute("href").startsWith("cache/"))).toBe(false);
  });

  it("shows the thumbnail when the server makes them, and the icon while it is not there yet", async () => {
    const cfg = { ...CFG, features: { ...CFG.features, thumbnail_enabled: true } };
    await boot({ url: "/search?q=foo", cfg, main: [doc("t1", "smb://srv/share/t1.docx", { mimetype: "application/msword", filetype: "word", thumbnail: "smb://srv/share/t1.docx" })] });
    rows()[0].querySelector(".fs-c-name").click();
    const img = document.querySelector("#fs-pv-stage img.fs-pv-thumb");
    expect(img.getAttribute("src")).toMatch(/^thumbnail\/\?docId=t1&queryId=/);
    expect(document.querySelector("#fs-pv-stage .fs-pv-hero")).not.toBeNull();
    img.dispatchEvent(new Event("load"));
    expect(document.querySelector("#fs-pv-stage .fs-pv-hero").hidden).toBe(true);
  });

  it("on a narrow screen the preview is a sheet: a click opens it, an arrow key does not, Esc closes it", async () => {
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    await boot({ url: "/search?q=foo" });
    const ws = document.getElementById("fs-workspace");
    expect(ws.dataset.sheet).toBe("closed");
    rows()[0].focus();
    key(rows()[0], "ArrowDown");
    expect(ws.dataset.sheet).toBe("closed");
    rows()[1].querySelector(".fs-c-name").click();
    expect(ws.dataset.sheet).toBe("open");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(ws.dataset.sheet).toBe("closed");
    rows()[1].querySelector(".fs-c-name").click();
    document.getElementById("fs-preview-close").click();
    expect(ws.dataset.sheet).toBe("closed");
  });

  it("the folder drawer opens from the location bar and closes with Esc", async () => {
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    await boot({ url: "/search?q=foo" });
    const ws = document.getElementById("fs-workspace");
    document.getElementById("fs-tree-toggle").click();
    expect(ws.dataset.tree).toBe("open");
    expect(document.getElementById("fs-tree-toggle").getAttribute("aria-expanded")).toBe("true");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(ws.dataset.tree).toBe("closed");
    // choosing a folder closes the drawer too
    document.getElementById("fs-tree-toggle").click();
    document.querySelector('#fs-tree [data-id="host:srv"]').click();
    await settle();
    expect(ws.dataset.tree).toBe("closed");
  });
});
