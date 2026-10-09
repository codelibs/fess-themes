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

describe("paging", () => {
  // /search?num=500 is capped by the server (page_size_max, 100 by default) and the answer says
  // so in page_size: the pager must step by the size that was served.
  const CAPPED = { page_size: 100, page_number: 1, page_numbers: ["1", "2", "3"], next_page: true, prev_page: false };
  const pageLink = n => [...document.querySelectorAll("#pagination .page-link")].find(a => a.textContent === String(n));

  it("pages by the size the server served when num is above its cap", async () => {
    const { get } = await boot({ url: "/search?q=foo&num=500", mainExtra: CAPPED });
    expect(lastMain(get)).toMatchObject({ num: 500, start: 0 });
    pageLink(2).click();
    await settle();
    expect(lastMain(get)).toMatchObject({ num: 100, start: 100 });
    expect(new URLSearchParams(location.search).get("start")).toBe("100");
    pageLink(3).click();
    await settle();
    expect(lastMain(get)).toMatchObject({ num: 100, start: 200 });
  });

  it("steps the Next link by that size too", async () => {
    const { get } = await boot({ url: "/search?q=foo&num=500", mainExtra: CAPPED });
    document.querySelector("#pagination li:last-child a").click();
    await settle();
    expect(lastMain(get)).toMatchObject({ num: 100, start: 100 });
  });

  it("steps the Previous link by that size too", async () => {
    const { get } = await boot({
      url: "/search?q=foo&num=500&start=200",
      mainExtra: { ...CAPPED, page_number: 3, prev_page: true },
    });
    document.querySelector("#pagination li:first-child a").click();
    await settle();
    expect(lastMain(get)).toMatchObject({ num: 100, start: 100 });
  });

  it("leaves a page size the server served as asked alone", async () => {
    const { get } = await boot({ url: "/search?q=foo&num=20", mainExtra: { ...CAPPED, page_size: 20 } });
    pageLink(2).click();
    await settle();
    expect(lastMain(get)).toMatchObject({ num: 20, start: 20 });
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

  describe("a sort chosen in the options drawer that the toolbar has no entry for", () => {
    const DRAWER_CFG = {
      ...CFG,
      sort_options: [
        ...CFG.sort_options,
        { value: "created.desc", label_key: "labels.search_result_sort_created_desc" },
        { value: "click_count.desc", label_key: "labels.search_result_sort_click_count_desc" },
      ],
    };
    const COLUMN_VALUES = ["relevance", "name", "modified", "size", "type", "location"];
    const select = () => document.getElementById("fs-sort-select");
    const markedHeaders = () => document.querySelectorAll('#fs-head [role="columnheader"][aria-sort="ascending"], #fs-head [role="columnheader"][aria-sort="descending"]');

    it("shows that sort in the toolbar, with no column marked, instead of Name", async () => {
      const { get } = await boot({ url: "/search?q=foo&sort=created.desc", cfg: DRAWER_CFG });
      expect(lastMain(get).sort).toBe("created.desc");
      const shown = select().selectedOptions[0];
      expect(shown.textContent).toBe("labels.search_result_sort_created_desc");
      expect(shown.disabled).toBe(true);
      expect(select().value).not.toBe("name");
      // the columns are still offered after it
      expect([...select().options].slice(1).map(o => o.value)).toEqual(COLUMN_VALUES);
      expect(markedHeaders().length).toBe(0);
      expect(document.getElementById("fs-sort-dir").disabled).toBe(true);
    });

    it("does the same without a keyword, where Name is the order the page falls back to", async () => {
      await boot({ url: "/search?ex_q=" + encodeURIComponent(SHARE_CLAUSE) + "&sort=click_count.desc", cfg: DRAWER_CFG });
      expect(select().selectedOptions[0].textContent).toBe("labels.search_result_sort_click_count_desc");
      expect(markedHeaders().length).toBe(0);
    });

    it("names a sort the drawer does not list by its value", async () => {
      await boot({ url: "/search?q=foo&sort=price.asc", cfg: DRAWER_CFG });
      expect(select().selectedOptions[0].textContent).toBe("price.asc");
      expect(markedHeaders().length).toBe(0);
    });

    it("a column heading then starts that column in its first direction, and the toolbar returns to the columns", async () => {
      // browsing: Name is the order the page falls back to, so a click must not read it as already in effect and flip it
      const { get } = await boot({ url: "/search?ex_q=" + encodeURIComponent(SHARE_CLAUSE) + "&sort=created.desc", cfg: DRAWER_CFG });
      document.querySelector('.fs-sort-btn[data-col="name"]').click();
      await settle();
      expect(lastMain(get).sort).toBe("filename.asc");
      expect([...select().options].map(o => o.value)).toEqual(COLUMN_VALUES.filter(v => v !== "relevance"));
      expect(select().value).toBe("name");
      expect(markedHeaders().length).toBe(1);
      expect(document.getElementById("fs-sort-dir").disabled).toBe(false);
    });

    it("the toolbar select can choose a column from it", async () => {
      const { get } = await boot({ url: "/search?q=foo&sort=created.desc", cfg: DRAWER_CFG });
      select().value = "size";
      select().dispatchEvent(new Event("change"));
      await settle();
      expect(lastMain(get).sort).toBe("content_length.desc");
      expect(select().value).toBe("size");
    });
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

  describe("the favourite star (the API can add a favourite, never remove one)", () => {
    const FAV_CFG = { ...CFG, features: { ...CFG.features, user_favorite: true } };

    /** Signed in; the server already lists `favorites` (doc ids) as favourites. */
    async function bootFavorites(favorites = []) {
      const flow = await loadSearchFlow(THEME, FAV_CFG);
      flow.isAuthenticated.mockReturnValue(true);
      install(flow.get);
      const base = flow.get.getMockImplementation();
      flow.get.mockImplementation(async (path, params) => (path === "/favorites" ? { data: favorites.map(doc_id => ({ doc_id })) } : base(path, params)));
      setLocation("/search?q=foo");
      mountIndexBody(THEME);
      flow.mod.attach();
      flow.mod.runFromUrl();
      await settle();
      return flow;
    }
    const star = i => rows()[i].querySelector(".favorite-btn");

    it("an unfavourited star offers to add, and is pressed and named a favourite once the add succeeded", async () => {
      const flow = await bootFavorites();
      flow.post.mockResolvedValue({ favorite: true, count: 3 });
      expect(star(0).getAttribute("aria-pressed")).toBe("false");
      expect(star(0).getAttribute("aria-label")).toBe("result.favorite_add");
      expect(star(0).hasAttribute("aria-disabled")).toBe(false);
      star(0).click();
      await settle();
      expect(flow.post).toHaveBeenCalledTimes(1);
      expect(flow.post.mock.calls[0][0]).toBe("/documents/a1/favorite");
      expect(star(0).getAttribute("aria-pressed")).toBe("true");
      expect(star(0).getAttribute("aria-label")).toBe("result.favorite_added");
      expect(star(0).title).toBe("result.favorite_added");
      expect(star(0).querySelector(".favorite-count").textContent).toBe("3");
    });

    it("a favourited star never offers removal, and a click on it sends nothing", async () => {
      const flow = await bootFavorites(["a1"]);
      expect(star(0).getAttribute("aria-pressed")).toBe("true");
      expect(star(0).getAttribute("aria-label")).toBe("result.favorite_added");
      expect(star(0).getAttribute("aria-label")).not.toBe("result.favorite_remove");
      expect(star(0).getAttribute("aria-disabled")).toBe("true");
      star(0).click();
      star(0).click();
      await settle();
      expect(flow.post).not.toHaveBeenCalled();
      expect(star(0).getAttribute("aria-pressed")).toBe("true");
      // the other rows are unaffected
      expect(star(1).getAttribute("aria-pressed")).toBe("false");
    });

    it("stays unpressed when the add did not happen", async () => {
      const flow = await bootFavorites();
      flow.post.mockResolvedValue({ favorite: false, count: 0 });
      star(0).click();
      await settle();
      expect(star(0).getAttribute("aria-pressed")).toBe("false");
      expect(star(0).getAttribute("aria-label")).toBe("result.favorite_add");
    });
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
    // the page's CSP (base-uri 'self') would refuse a <base> on the document's own address, so the frame gets none
    expect(html).toBe("<html><head></head><body>hi</body></html>");
    expect(flow.get.mock.calls.some(c => c[0] === "/cache/c1")).toBe(true);
  });

  it("previews a file crawled over http through its cached copy, never through go/, which redirects off this origin", async () => {
    // The redirect target is another origin: the page's connect-src / img-src 'self' refuse it and report a violation.
    const withCache = doc("t1", "http://wiki.example.com/notes.txt", { has_cache: "true" });
    const withoutCache = doc("t2", "https://wiki.example.com/other.txt");
    const pdf = doc("t3", "https://wiki.example.com/a.pdf", { mimetype: "application/pdf", filetype: "pdf" });
    const fetchMock = vi.fn(async () => { throw new Error("go/ must not be asked for a page crawled over http"); });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const flow = await loadSearchFlow(THEME, CFG);
      install(flow.get, { main: [withCache, withoutCache, pdf] });
      const base = flow.get.getMockImplementation();
      flow.get.mockImplementation(async (path, params, opts) => (path.startsWith("/cache/")
        ? { doc_id: "t1", mimetype: "text/plain", content: "notes", url: "http://wiki.example.com/notes.txt", charset: "UTF-8" }
        : base(path, params, opts)));
      setLocation("/search?q=foo");
      mountIndexBody(THEME);
      flow.mod.attach();
      flow.mod.runFromUrl();
      await settle();
      await select(0);
      expect(document.querySelector("#fs-pv-stage iframe")).not.toBeNull();
      expect(flow.get.mock.calls.some(c => c[0] === "/cache/t1")).toBe(true);
      await select(1);
      expect(document.querySelector("#fs-pv-stage iframe")).toBeNull();
      expect(document.getElementById("fs-pv-stage").textContent).toContain("fs.preview_none");
      await select(2);
      expect(document.getElementById("fs-pv-stage").textContent).toContain("fs.preview_none");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
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

describe("reopening the preview pane", () => {
  const key = (el, k) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  const bytesResponse = text => ({
    ok: true, status: 200, headers: { get: () => "text/plain; charset=UTF-8" }, body: null,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const select = async index => {
    rows()[index].querySelector(".fs-c-name").click();
    await wait(320);
    await settle();
  };
  const toggleTwice = async index => {
    key(rows()[index], " ");
    key(rows()[index], " ");
    await wait(320);
    await settle();
  };

  const wide = () => { window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })); };

  beforeEach(() => {
    wide();
    URL.createObjectURL = vi.fn(() => "blob:test/1");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => { vi.unstubAllGlobals(); wide(); });

  // go/ writes a click log entry for every request, so a second fetch is a second click.
  it("shows the text it already loaded instead of fetching (and click-logging) the original again", async () => {
    const fetchMock = vi.fn(async () => bytesResponse("first body"));
    vi.stubGlobal("fetch", fetchMock);
    await boot({ url: "/search?q=foo" });
    await select(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector("#fs-pv-stage pre.fs-pv-text").textContent).toBe("first body");

    key(rows()[0], " ");
    expect(document.getElementById("fs-workspace").dataset.preview).toBe("closed");
    key(rows()[0], " ");
    expect(document.getElementById("fs-workspace").dataset.preview).toBe("open");
    // nothing has to wait for the selection to settle: the content is back at once
    expect(document.querySelector("#fs-pv-stage pre.fs-pv-text").textContent).toBe("first body");
    await wait(320);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector("#fs-pv-stage pre.fs-pv-text").textContent).toBe("first body");
    // the metadata and actions are still the row's own
    expect(document.getElementById("fs-pv-name").textContent).toBe("a1.txt");
    expect(document.querySelectorAll("#fs-pv-actions a, #fs-pv-actions button").length).toBeGreaterThan(0);
  });

  it("does the same for a PDF (no second fetch, a fresh object URL for the same Blob) and a cached copy", async () => {
    const pdf = doc("p9", "smb://srv/share/p9.pdf", { mimetype: "application/pdf", filetype: "pdf" });
    const cached = doc("c9", "https://wiki.example.com/page.html", { mimetype: "text/html", filetype: "html", has_cache: "true" });
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, headers: { get: () => null }, body: null,
      arrayBuffer: async () => new TextEncoder().encode("%PDF-1.4 body").buffer,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const flow = await loadSearchFlow(THEME, CFG);
    install(flow.get, { main: [pdf, cached] });
    const base = flow.get.getMockImplementation();
    flow.get.mockImplementation(async (path, params, opts) => (path.startsWith("/cache/")
      ? { doc_id: "c9", mimetype: "text/html", content: "<html><head></head><body>hi</body></html>", url: "https://wiki.example.com/page.html", charset: "UTF-8" }
      : base(path, params, opts)));
    setLocation("/search?q=foo");
    mountIndexBody(THEME);
    flow.mod.attach();
    flow.mod.runFromUrl();
    await settle();

    await select(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const pdfBlob = URL.createObjectURL.mock.calls[0][0];
    await toggleTwice(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL.mock.calls.map(c => c[0])).toEqual([pdfBlob, pdfBlob]);
    expect(document.querySelectorAll("#fs-pv-stage iframe").length).toBe(1);

    await select(1);
    const cacheCalls = () => flow.get.mock.calls.filter(c => c[0] === "/cache/c9").length;
    expect(cacheCalls()).toBe(1);
    await toggleTwice(1);
    expect(cacheCalls()).toBe(1);
    expect(document.querySelectorAll("#fs-pv-stage iframe").length).toBe(1);
  });

  it("does the same for the sheet of a narrow screen, reopened with the toolbar button", async () => {
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const fetchMock = vi.fn(async () => bytesResponse("sheet body"));
    vi.stubGlobal("fetch", fetchMock);
    await boot({ url: "/search?q=foo" });
    const ws = document.getElementById("fs-workspace");
    await select(0);
    expect(ws.dataset.sheet).toBe("open");
    document.getElementById("fs-preview-close").click();
    expect(ws.dataset.sheet).toBe("closed");
    document.getElementById("fs-preview-toggle").click();
    expect(ws.dataset.sheet).toBe("open");
    await wait(320);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector("#fs-pv-stage pre.fs-pv-text").textContent).toBe("sheet body");
  });

  it("keeps the image element it already loaded", async () => {
    await boot({ url: "/search?q=foo", main: [doc("i1", "smb://srv/share/pic.png", { mimetype: "image/png", filetype: "png" })] });
    await select(0);
    const img = document.querySelector("#fs-pv-stage img.fs-pv-image");
    expect(img).not.toBeNull();
    await toggleTwice(0);
    expect(document.querySelector("#fs-pv-stage img.fs-pv-image")).toBe(img);
  });

  it("loads normally when the pane is closed and opened before the first load has started", async () => {
    const fetchMock = vi.fn(async () => bytesResponse("late body"));
    vi.stubGlobal("fetch", fetchMock);
    await boot({ url: "/search?q=foo" });
    rows()[0].querySelector(".fs-c-name").click();
    await toggleTwice(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector("#fs-pv-stage pre.fs-pv-text").textContent).toBe("late body");
  });

  it("shows the row selected meanwhile, not the one that was loaded before the pane closed", async () => {
    const fetchMock = vi.fn(async url => bytesResponse(String(url).includes("docId=a1") ? "body of a1" : "body of b2"));
    vi.stubGlobal("fetch", fetchMock);
    await boot({ url: "/search?q=foo", main: [doc("a1", "smb://srv/share/a1.txt"), doc("b2", "smb://srv/share/b2.txt")] });
    await select(0);
    key(rows()[0], " ");
    key(rows()[0], "ArrowDown");
    key(rows()[1], " ");
    await wait(320);
    await settle();
    expect(document.getElementById("fs-pv-name").textContent).toBe("b2.txt");
    expect(document.querySelector("#fs-pv-stage pre.fs-pv-text").textContent).toBe("body of b2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("is a new view, fetched again, when the selection moved to another row and came back", async () => {
    const fetchMock = vi.fn(async () => bytesResponse("body"));
    vi.stubGlobal("fetch", fetchMock);
    await boot({ url: "/search?q=foo", main: [doc("a1", "smb://srv/share/a1.txt"), doc("b2", "smb://srv/share/b2.txt")] });
    await select(0);
    await select(1);
    await select(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fetches again after a failed load, as a retry", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("network down");
      return bytesResponse("second try");
    });
    vi.stubGlobal("fetch", fetchMock);
    await boot({ url: "/search?q=foo" });
    await select(0);
    expect(document.querySelector("#fs-pv-stage pre.fs-pv-text")).toBeNull();
    expect(document.getElementById("fs-pv-stage").textContent).toContain("fs.preview_failed");
    await toggleTwice(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.querySelector("#fs-pv-stage pre.fs-pv-text").textContent).toBe("second try");
  });
});

describe("the empty state's popular words", () => {
  async function bootEmpty({ url, features = CFG.features } = {}) {
    const cfg = { ...CFG, features };
    const flow = await loadSearchFlow(THEME, cfg);
    install(flow.get, { main: [] });
    const base = flow.get.getMockImplementation();
    flow.get.mockImplementation(async (path, params, opts) => (path === "/popular-words"
      ? { popular_words: ["alpha", "beta"] }
      : base(path, params, opts)));
    setLocation(url);
    mountIndexBody(THEME);
    flow.mod.attach();
    flow.mod.runFromUrl();
    await settle();
    return flow;
  }
  const words = () => [...document.querySelectorAll("#popular-words a")].map(a => a.textContent);
  const popularCalls = get => get.mock.calls.filter(c => c[0] === "/popular-words").length;

  it("lists them when a search opened from its address finds nothing", async () => {
    await bootEmpty({ url: "/search?q=" + encodeURIComponent("zzqx nosuch") });
    expect(document.getElementById("empty-state").classList.contains("d-none")).toBe(false);
    expect(words()).toEqual(["alpha", "beta"]);
  });

  it("lists them for a folder with nothing in it too", async () => {
    await bootEmpty({ url: "/search?ex_q=" + encodeURIComponent(SHARE_CLAUSE) });
    expect(document.getElementById("empty-state").classList.contains("d-none")).toBe(false);
    expect(words()).toEqual(["alpha", "beta"]);
  });

  it("does not ask for them while there are results, or at startup (the home view lists its own)", async () => {
    const { get } = await boot({ url: "/search?q=foo" });
    expect(popularCalls(get)).toBe(0);
    const home = await bootEmpty({ url: "/" });
    expect(popularCalls(home.get)).toBe(0);
  });

  it("does not ask when the server turns popular words off", async () => {
    const { get } = await bootEmpty({ url: "/search?q=zzqx", features: { ...CFG.features, popular_word: false } });
    expect(popularCalls(get)).toBe(0);
    expect(words()).toEqual([]);
  });
});

describe("the cached copy in the preview frame", () => {
  const select = async index => {
    rows()[index].querySelector(".fs-c-name").click();
    await new Promise(r => setTimeout(r, 320));
    await settle();
  };
  /** Preview a cached copy whose /cache answer is `env`, and return the HTML handed to the frame. */
  async function previewCached(env) {
    const cached = doc("c1", "https://wiki.example.com/page.html", { mimetype: "text/html", filetype: "html", has_cache: "true" });
    const flow = await loadSearchFlow(THEME, CFG);
    install(flow.get, { main: [cached] });
    const base = flow.get.getMockImplementation();
    flow.get.mockImplementation(async (path, params, opts) => (path.startsWith("/cache/")
      ? { doc_id: "c1", mimetype: "text/html", charset: "UTF-8", ...env }
      : base(path, params, opts)));
    URL.createObjectURL = vi.fn(() => "blob:test/1");
    URL.revokeObjectURL = vi.fn();
    setLocation("/search?q=foo");
    mountIndexBody(THEME);
    flow.mod.attach();
    flow.mod.runFromUrl();
    await settle();
    await select(0);
    expect(document.querySelector("#fs-pv-stage iframe")).not.toBeNull();
    return URL.createObjectURL.mock.calls[0][0].text();
  }
  // What /api/v2/cache returns: cache.hbs puts the document's url_link in a <base> before the banner.
  const hbs = base => `<!DOCTYPE html>\n<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">\n${base}\n<div>banner</div>\n<img src="pic.png"><a href="next.html">next</a>\n<p>body</p>`;

  it("is given no <base> that points at another origin: the page's CSP (base-uri 'self') would refuse it with a console error", async () => {
    for (const href of ["file://data/share/doc.html", "file://///srv/share/doc.html", "http://wiki.example.com/dir/page.html", "https://other.example.org:8443/x/", "smb://srv/share/doc.html"]) {
      const tag = `<base href="${href}">`;
      const html = await previewCached({ content: hbs(tag), url: href });
      expect(html, href).not.toMatch(/<base[^>]*href/i);
      // everything else is the document, untouched: same relative links and images as before
      expect(html, href).toBe(hbs(tag).replace(tag, ""));
    }
  });

  it("drops a base the document carries itself, whatever its spelling, and keeps the rest of the tag", async () => {
    const content = `<html><head><BASE HREF='http://wiki.example.com/' target="_blank"><base href=http://other.example.org/x/><base target="_top"></head><body><a href="a.html">a</a></body></html>`;
    const html = await previewCached({ content, url: "http://wiki.example.com/" });
    expect(html).not.toMatch(/href\s*=\s*['"]?http/i);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('<base target="_top">');
    expect(html).toContain('<a href="a.html">a</a>');
  });

  it("keeps a <base> on the page's own origin, which the CSP allows, so its relative links and images still resolve", async () => {
    const own = `${window.location.origin}/wiki/page.html`;
    const content = hbs(`<base href="${own}">`);
    const html = await previewCached({ content, url: own });
    expect(html).toBe(content);
  });

  it("adds a base from the document's URL only when it is on the page's own origin and the HTML has none", async () => {
    const own = `${window.location.origin}/wiki/page.html`;
    expect(await previewCached({ content: "<html><head></head><body>x</body></html>", url: own })).toBe(`<html><head><base href="${own}"></head><body>x</body></html>`);
    expect(await previewCached({ content: "<html><head></head><body>x</body></html>", url: "https://wiki.example.com/page.html" })).toBe("<html><head></head><body>x</body></html>");
  });
});

describe("the filter buttons the help text describes", () => {
  const group = title => [...document.querySelectorAll("#fs-filters .fs-fgroup")].find(g => g.querySelector("legend").textContent === title);
  const labels = title => [...group(title).querySelectorAll(".fs-fchip-label")].map(l => l.textContent);
  const DAY = "last_modified:[now/d-1d TO *]";
  const WEEK = "last_modified:[now/d-7d TO *]";
  const MONTH = "last_modified:[now/d-1M TO *]";
  const YEAR = "last_modified:[now/d-1y TO *]";
  const MEDIUM = "content_length:[100000 TO 999999]";

  it("all the modified windows stay when one is chosen (they contain one another); the other size ranges go (they do not overlap)", async () => {
    // what Fess counts inside the narrowed search: the windows are nested, the size ranges are disjoint
    await boot({
      url: "/search?q=foo&ex_q=" + encodeURIComponent(WEEK) + "&ex_q=" + encodeURIComponent(MEDIUM),
      mainExtra: {
        facet_query: [
          { value: DAY, count: 4 }, { value: WEEK, count: 9 }, { value: MONTH, count: 9 }, { value: YEAR, count: 9 },
          { value: "content_length:[0 TO 9999]", count: 0 }, { value: "content_length:[10000 TO 99999]", count: 0 },
          { value: MEDIUM, count: 9 },
          { value: "content_length:[1000000 TO 9999999]", count: 0 }, { value: "content_length:[10000000 TO *]", count: 0 },
        ],
      },
    });
    expect(labels("fs.filter_modified")).toEqual(["fs.date_1d", "fs.date_1w", "fs.date_1m", "fs.date_1y"]);
    expect(labels("fs.filter_size")).toEqual(["fs.size_m"]);
  });
});
