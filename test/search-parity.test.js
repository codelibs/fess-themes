// SPDX-License-Identifier: Apache-2.0
// Parity with the bootstrap theme in fess (JSP search pages): view counts, the permission
// notice, and the fess:auth:required signal that lets app.js ask for login again.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { themes } from "./helpers/themes.js";
import { mountBody, resetDom, setLocation } from "./helpers/dom.js";
import { loadSearch, loadSearchFlow } from "./helpers/loadSearch.js";
import { SEARCH_FIXTURE, FULL_CFG, SAMPLE_DOCS, makeSearchEnv, installDispatch, settle } from "./helpers/searchFlow.js";

/** Themes whose result card shows the view count (storefront and codesearch do not). */
const VIEW_COUNT_THEMES = ["docsearch", "docuforge", "helpdesk", "mosaic", "nomadkit", "rawblock", "semanticlens", "voicebox"];
/** Themes with the bootstrap runSearch contract (d-none banners). */
const DNONE_THEMES = themes.filter((t) => t !== "codesearch");

function viewedDoc(extra = {}) {
  return {
    doc_id: "doc-1", url: "https://example.com/a", url_link: "https://example.com/a",
    content_title: "Example Title", content_description: "An example description.",
    site: "example.com", site_path: "example.com/a", mimetype: "text/html", filetype: "html",
    last_modified: "2026-01-02T03:04:05", content_length: 2048, ...extra,
  };
}

beforeEach(() => {
  resetDom();
  window.scrollTo = () => {};
});
afterEach(() => setLocation("/"));

describe.each(VIEW_COUNT_THEMES)("view count on the result card [%s]", (theme) => {
  it("shows the count only while search logging is on and something was clicked", async () => {
    const on = await loadSearch(theme, { features: { search_log_enabled: true } });
    expect(on.buildResultCard(viewedDoc({ click_count: 7 }), "q1", 1).textContent).toContain("result.click_count");
    expect(on.buildResultCard(viewedDoc({ click_count: 0 }), "q1", 1).textContent).not.toContain("result.click_count");
    expect(on.buildResultCard(viewedDoc(), "q1", 1).textContent).not.toContain("result.click_count");
    const off = await loadSearch(theme, { features: { search_log_enabled: false } });
    expect(off.buildResultCard(viewedDoc({ click_count: 7 }), "q1", 1).textContent).not.toContain("result.click_count");
  });
});

describe.each(["storefront", "codesearch"])("no view count [%s]", (theme) => {
  it("never renders result.click_count", async () => {
    const { mod, get } = await loadSearchFlow(theme, { ...FULL_CFG, features: { ...FULL_CFG.features, search_log_enabled: true } });
    installDispatch(get, { search: makeSearchEnv(SAMPLE_DOCS.map((d) => ({ ...d, click_count: 9 }))) });
    mountBody(SEARCH_FIXTURE);
    mod._state.q = "foo";
    await mod.runSearch();
    await settle();
    expect(document.getElementById("results").textContent).not.toContain("result.click_count");
  });
});

describe.each(DNONE_THEMES)("permission notice [%s]", (theme) => {
  async function run(extra) {
    const { mod, get } = await loadSearchFlow(theme, FULL_CFG);
    installDispatch(get, { search: makeSearchEnv(SAMPLE_DOCS, extra) });
    mountBody(SEARCH_FIXTURE);
    mod._state.q = "foo";
    await mod.runSearch();
    await settle();
    return document.getElementById("results-warning");
  }

  it.each([
    ["PENDING", "errors.user_permissions_loading"],
    ["FAILED", "errors.user_permissions_unavailable"],
  ])("tells the user when permissions are %s", async (permissionState, key) => {
    const warn = await run({ permission_state: permissionState });
    expect(warn.classList.contains("d-none")).toBe(false);
    expect(warn.textContent).toBe(key);
  });

  it("puts the permission notice before a partial-result warning", async () => {
    const warn = await run({ permission_state: "FAILED", partial: true, timed_out: true });
    expect(warn.textContent).toBe("errors.user_permissions_unavailable labels.process_time_is_exceeded");
  });

  it("hides the banner for resolved permissions and a complete result", async () => {
    const warn = await run({ permission_state: "RESOLVED" });
    expect(warn.classList.contains("d-none")).toBe(true);
  });
});

describe("permission notice [codesearch]", () => {
  async function run(extra) {
    const { mod, get } = await loadSearchFlow("codesearch", FULL_CFG);
    installDispatch(get, { search: makeSearchEnv(SAMPLE_DOCS, extra) });
    mountBody(SEARCH_FIXTURE);
    document.getElementById("results-warning").hidden = true;
    mod._state.q = "foo";
    await mod.runSearch();
    await settle();
    return document.getElementById("results-warning");
  }

  it("shows the notice for pending permissions and hides it once they resolve", async () => {
    const pending = await run({ permission_state: "PENDING" });
    expect(pending.hidden).toBe(false);
    expect(pending.textContent).toBe("errors.user_permissions_loading");
    const resolved = await run({ permission_state: "RESOLVED" });
    expect(resolved.hidden).toBe(true);
  });

  it("ships the notice element, hidden, in index.html", async () => {
    const { parseIndexHtml } = await import("./helpers/themes.js");
    const warn = parseIndexHtml("codesearch").getElementById("results-warning");
    expect(warn).not.toBeNull();
    expect(warn.hasAttribute("hidden")).toBe(true);
  });
});

describe.each(themes)("fess:auth:required [%s]", (theme) => {
  it("is announced for auth_required only", async () => {
    const { mod, get } = await loadSearchFlow(theme, FULL_CFG);
    installDispatch(get);
    mountBody(SEARCH_FIXTURE);
    mod._state.q = "foo";
    let announced = 0;
    const onRequired = () => { announced += 1; };
    document.addEventListener("fess:auth:required", onRequired);
    try {
      get.mockRejectedValueOnce(Object.assign(new Error("auth"), { code: "auth_required" }));
      await mod.runSearch();
      get.mockRejectedValueOnce(new Error("boom"));
      await mod.runSearch();
    } finally {
      document.removeEventListener("fess:auth:required", onRequired);
    }
    expect(announced).toBe(1);
  });
});
