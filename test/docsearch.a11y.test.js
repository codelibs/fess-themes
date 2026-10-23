// SPDX-License-Identifier: Apache-2.0
// docsearch: keyboard and screen-reader behaviour of the results page.
//
// - A search without hits is announced; paging puts the focus on the results heading
// - Smooth scrolling is skipped under prefers-reduced-motion (pager and back-to-top)
// - The option chips are named by setting and value; a selected facet says so; the similar-results banner
//   closes with "Close"; the mobile "more" control is a button that expands the snippet
// - The static markup: a results heading, a labelled palette input, every aria-label translatable
//
// The theme's real index.html, search.js and app.js against an api double.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountIndexBody, parseIndexHtml } from "./helpers/themes.js";
import { resetDom, setLocation } from "./helpers/dom.js";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { bootApp } from "./helpers/loadShell.js";
import { FULL_CFG, SAMPLE_DOCS, installDispatch, makeSearchEnv, settle } from "./helpers/searchFlow.js";

const THEME = "docsearch";

// ---------------------------------------------------------------- static markup
describe("docsearch: index.html", () => {
  const doc = parseIndexHtml(THEME);

  it("has a results heading between the page title and the result titles, focusable by script", () => {
    const h = doc.getElementById("results-heading");
    expect(h.tagName).toBe("H2");
    expect(h.getAttribute("tabindex")).toBe("-1");
    expect(h.classList.contains("visually-hidden")).toBe(true);
    expect(h.getAttribute("data-i18n")).toBe("aria.search_results");
    expect(h.compareDocumentPosition(doc.getElementById("result")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("names the palette input", () => {
    const input = doc.getElementById("palette-input");
    expect(input.getAttribute("aria-label")).toBeTruthy();
    expect(input.getAttribute("data-i18n-aria-label")).toBe("palette.placeholder");
  });

  it("translates every static aria-label (an English literal alone stays English in every locale)", () => {
    const bare = [...doc.querySelectorAll("[aria-label]")].filter((e) => !e.hasAttribute("data-i18n-aria-label"));
    expect(bare.map((e) => `${e.tagName.toLowerCase()}#${e.id}: ${e.getAttribute("aria-label")}`)).toEqual([]);
  });
});

// ---------------------------------------------------------------- behaviour
describe("docsearch: what runSearch() leaves on the page", () => {
  let scrollTo;
  beforeEach(() => {
    resetDom();
    sessionStorage.clear();
    scrollTo = vi.fn();
    window.scrollTo = scrollTo;
    delete window.matchMedia;
  });
  afterEach(() => setLocation("/"));

  async function boot(docs = SAMPLE_DOCS, extra = {}) {
    setLocation("/search?q=foo");
    const flow = await loadSearchFlow(THEME, FULL_CFG);
    installDispatch(flow.get, { search: makeSearchEnv(docs, extra) });
    mountIndexBody(THEME);
    flow.mod.runFromUrl();
    await settle();
    return flow;
  }

  describe("a search without hits", () => {
    it("announces it in the live region, and clears the announcement on the next search with hits", async () => {
      const flow = await boot([]);
      const meta = document.getElementById("results-meta");
      expect(meta.getAttribute("aria-live")).toBe("polite");
      expect(meta.textContent).toBe("search.did_not_match");
      installDispatch(flow.get, { search: makeSearchEnv(SAMPLE_DOCS) });
      setLocation("/search?q=bar");
      flow.mod.runFromUrl();
      await settle();
      expect(meta.textContent).toBe("");
    });
  });

  describe("paging", () => {
    const pageLink = (n) => [...document.querySelectorAll("#pagination a.page-link")].find((a) => a.textContent === String(n));

    it("moves the focus to the results heading once the new page is in", async () => {
      await boot();
      pageLink(2).click();
      await settle();
      expect(document.activeElement).toBe(document.getElementById("results-heading"));
    });

    it("scrolls smoothly by default", async () => {
      await boot();
      pageLink(2).click();
      await settle();
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    });

    it("does not animate for a visitor who asked for reduced motion", async () => {
      window.matchMedia = (q) => ({ matches: q.includes("prefers-reduced-motion"), addEventListener() {}, removeEventListener() {} });
      await boot();
      pageLink(2).click();
      await settle();
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    });
  });

  describe("the similar-results banner", () => {
    it("closes with 'Close', not with its own sentence", async () => {
      const docs = SAMPLE_DOCS.map((d, i) => ({ ...d, similar_docs_count: 3, similar_docs_hash: "h" + i }));
      await boot(docs);
      document.querySelector("#results a.similar").click();
      await settle();
      const close = document.querySelector("#similar-doc-banner button");
      expect(close.getAttribute("aria-label")).toBe("aria.close");
    });
  });

  describe("the option chips", () => {
    it("are named by their setting and value, and point at the drawer they open", async () => {
      await boot();
      const chips = [...document.querySelectorAll("#options-bar a.badge")];
      expect(chips.length).toBe(4);
      const names = chips.map((c) => c.getAttribute("aria-label"));
      expect(names.every((n) => n.includes(": "))).toBe(true);
      expect(new Set(names).size).toBe(4);
      expect(names[0]).toBe("search.menu_sort: search.menu_score");
      for (const c of chips) {
        expect(c.getAttribute("aria-controls")).toBe("searchOptions");
        expect(c.getAttribute("aria-expanded")).toBe("false");
      }
    });
  });

  describe("the facets", () => {
    it("marks the selected value with aria-current and no other", async () => {
      await boot();
      const link = () => [...document.querySelectorAll("#facet-body li.list-group-item a")];
      expect(link().some((a) => a.hasAttribute("aria-current"))).toBe(false);
      link().find((a) => a.textContent.includes("Label A")).click();
      await settle();
      const marked = link().filter((a) => a.getAttribute("aria-current") === "true");
      expect(marked.map((a) => a.parentElement.className)).toEqual(["list-group-item active"]);
      expect(marked[0].textContent).toContain("Label A");
    });

    it("marks a selected facet-query value too", async () => {
      await boot();
      [...document.querySelectorAll("#facet-body li.list-group-item a")].find((a) => a.textContent.includes("labels.facet_filetype_html")).click();
      await settle();
      const marked = document.querySelectorAll('#facet-body li.active a[aria-current="true"]');
      expect(marked.length).toBe(1);
      expect(marked[0].textContent).toContain("labels.facet_filetype_html");
    });
  });

  describe("the phone's 'more' control", () => {
    it("is a button that expands the snippet, not a link to its own card", async () => {
      await boot();
      const card = document.querySelector("#results li");
      expect(card.querySelector('.more a[href^="#result"]')).toBeNull();
      const more = card.querySelector(".more button");
      expect(more.getAttribute("aria-expanded")).toBe("false");
      more.click();
      expect(card.classList.contains("is-expanded")).toBe(true);
      expect(more.getAttribute("aria-expanded")).toBe("true");
      more.click();
      expect(card.classList.contains("is-expanded")).toBe(false);
      expect(more.getAttribute("aria-expanded")).toBe("false");
    });
  });
});

describe("docsearch: back to top", () => {
  let app;
  beforeEach(async () => {
    resetDom();
    document.head.innerHTML = "";
    window.scrollTo = vi.fn();
    setLocation("/help");
  });
  afterEach(() => {
    app.detach();
    vi.resetModules();
    setLocation("/");
    delete window.matchMedia;
  });

  it.each([
    [false, "smooth"],
    [true, "auto"],
  ])("with prefers-reduced-motion %s scrolls with behavior %s", async (reduced, behavior) => {
    window.matchMedia = (q) => ({ matches: reduced && q.includes("prefers-reduced-motion"), addEventListener() {}, removeEventListener() {} });
    app = await bootApp(THEME, { features: {}, notifications: {} });
    window.scrollTo.mockClear();
    document.getElementById("back-to-top").click();
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior });
  });
});
