// SPDX-License-Identifier: Apache-2.0
// helpdesk: what the results view offers a keyboard or screen-reader user, and how it lays out.
//
//   1. The pager links are the URLs of their pages (not "#"), the current page is marked
//      aria-current="page", every page number has an accessible page name, and a disabled end
//      (no previous / next page) is not a link. A plain click still pages in place; a modified
//      one (new tab, new window) is the browser's.
//   2. The active-filter chip of a label names the label (label_options) like the options bar,
//      instead of printing "label: <value>".
//   3. Layout: jsdom has no layout engine, so the stylesheet's contract is read back from the
//      parsed rules of the theme's real styles.css (the declarations that carry each fix); the
//      pixels were checked in a browser. A question title wraps instead of ending in an
//      ellipsis, and a long unbroken token in the query, the featured answer or the cache
//      metadata wraps instead of widening the page.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { modulePath } from "./helpers/themes.js";
import { resetDom, mountBody, setLocation } from "./helpers/dom.js";
import {
  SEARCH_FIXTURE, FULL_CFG, SAMPLE_DOCS, makeSearchEnv, installDispatch, settle,
} from "./helpers/searchFlow.js";

const THEME = "helpdesk";
const $ = (id) => document.getElementById(id);

const ENGLISH = JSON.parse(readFileSync(
  join(dirname(dirname(modulePath(THEME, "app.js"))), "i18n", "messages.en.json"), "utf8"));

/** The theme's search.js with its real i18n.js primed with the English bundle. */
async function loadEnglishFlow(cfg) {
  const flow = await loadSearchFlow(THEME, cfg);
  const i18n = await import(`../themes/${THEME}/assets/i18n.js`);
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ENGLISH }));
  try {
    await i18n.init("en");
  } finally {
    vi.unstubAllGlobals();
  }
  return flow;
}

beforeEach(() => {
  resetDom();
  sessionStorage.clear();
  window.scrollTo = () => {};
});
afterEach(() => setLocation("/"));

const searchParams = (get) => get.mock.calls.filter((c) => c[0] === "/search").map((c) => c[1]);

describe("helpdesk: the pager", () => {
  // Page 2 of 3, ten per page: there is a page before and a page after.
  const env = (extra = {}) => makeSearchEnv(SAMPLE_DOCS, {
    page_number: 2, page_numbers: ["1", "2", "3"], prev_page: true, next_page: true, ...extra,
  });

  async function onPage2(extra) {
    setLocation("/search?q=foo&num=10&start=10");
    const flow = await loadEnglishFlow(FULL_CFG);
    installDispatch(flow.get, { search: env(extra) });
    mountBody(SEARCH_FIXTURE);
    flow.mod.runFromUrl();
    await settle();
    return flow;
  }

  const links = () => [...$("pagination").querySelectorAll("a.page-link")];
  const numbered = () => links().filter((a) => /^\d+$/.test(a.textContent));
  // Whether the page's own handler took the click (preventDefault) or left it to the browser.
  // The listener on document runs after it and then cancels the click itself: jsdom cannot
  // navigate, and says so on the console.
  const click = (a, init = {}) => {
    const outcome = {};
    const spy = (ev) => { outcome.defaultPrevented = ev.defaultPrevented; ev.preventDefault(); };
    document.addEventListener("click", spy);
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }));
    document.removeEventListener("click", spy);
    return outcome;
  };

  it("links each page number to the URL of that page, not to #", async () => {
    await onPage2();
    expect(numbered().map((a) => a.getAttribute("href"))).toEqual([
      "/search?q=foo&num=10",
      "/search?q=foo&num=10&start=10",
      "/search?q=foo&num=10&start=20",
    ]);
  });

  it("links previous and next to the pages before and after", async () => {
    await onPage2();
    const [prev, , , , next] = links();
    expect(prev.getAttribute("href")).toBe("/search?q=foo&num=10");
    expect(next.getAttribute("href")).toBe("/search?q=foo&num=10&start=20");
  });

  it("marks the current page, and only it, with aria-current", async () => {
    await onPage2();
    const current = links().filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["2"]);
    expect(current[0].closest("li").classList.contains("active")).toBe(true);
  });

  it("gives every page number an accessible page name", async () => {
    await onPage2();
    expect(numbered().map((a) => a.getAttribute("aria-label"))).toEqual(["Page 1", "Page 2", "Page 3"]);
  });

  it("opens a page in place on a plain click", async () => {
    const flow = await onPage2();
    const ev = click(numbered()[2]);
    await settle();
    expect(ev.defaultPrevented).toBe(true);
    expect(searchParams(flow.get).at(-1).start).toBe(20);
    expect(new URLSearchParams(location.search).get("start")).toBe("20");
  });

  it("leaves a click with Ctrl, Meta or Shift to the browser", async () => {
    const flow = await onPage2();
    const searches = searchParams(flow.get).length;
    for (const modifier of ["ctrlKey", "metaKey", "shiftKey"]) {
      expect(click(numbered()[2], { [modifier]: true }).defaultPrevented).toBe(false);
    }
    await settle();
    expect(searchParams(flow.get).length).toBe(searches);
  });

  it("does not make a link of a disabled end", async () => {
    await onPage2({ page_number: 1, prev_page: false });
    const [prev] = links();
    expect(prev.hasAttribute("href")).toBe(false);
    expect(prev.getAttribute("aria-disabled")).toBe("true");
    expect(prev.closest("li").classList.contains("disabled")).toBe(true);
    // the other end still is one
    expect(links().at(-1).getAttribute("href")).toContain("start=");
  });
});

describe("helpdesk: label name in the active-filter chip", () => {
  const cfg = {
    ...FULL_CFG,
    label_options: [
      { value: "fa", name: "Fixture A pages" },
      { value: "fb", name: "Fixture B pages" },
      { value: "fc" },
    ],
  };

  async function open(url) {
    setLocation(url);
    const flow = await loadSearchFlow(THEME, cfg);
    installDispatch(flow.get);
    mountBody(SEARCH_FIXTURE);
    flow.mod.runFromUrl();
    await settle();
    return flow;
  }

  const chips = () => $("active-chips");

  it("names the label of a drawer / URL filter, not its value", async () => {
    await open("/search?q=foo&fields.label=fb");
    expect(chips().textContent).toContain("labels.facet_label_title: Fixture B pages");
    expect(chips().textContent).not.toContain("label: fb");
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

  it("keeps the value in the request and the URL", async () => {
    const flow = await open("/search?q=foo&fields.label=fb");
    expect(searchParams(flow.get)[0]["fields.label"]).toEqual(["fb"]);
    chips().querySelector(".active-chip-remove").click();
    await settle();
    expect(searchParams(flow.get).at(-1)["fields.label"]).toBeUndefined();
  });

  it("leaves the chip of another field as it was", async () => {
    await open("/search?q=foo&ex_q=host%3Aexample.com&fields.host=example.com");
    expect(chips().textContent).toContain("host: example.com");
  });
});

describe("helpdesk layout: stylesheet contract", () => {
  let sheet;
  beforeAll(() => {
    const style = document.createElement("style");
    style.textContent = readFileSync(modulePath(THEME, "styles.css"), "utf8");
    document.head.appendChild(style);
    sheet = style.sheet;
  });

  /** The value `prop` ends up with for `selector`: the last declaration among the top-level rules naming it exactly. */
  function declared(selector, prop) {
    let value = null;
    for (const rule of sheet.cssRules) {
      const names = (rule.selectorText || "").split(",").map((n) => n.trim());
      if (names.includes(selector) && rule.style.getPropertyValue(prop)) value = rule.style.getPropertyValue(prop);
    }
    return value;
  }

  it("lets a question title wrap instead of ending in an ellipsis", () => {
    // .text-truncate is nowrap + ellipsis; the title rule, which is more specific, undoes it
    expect(declared("#result .title.text-truncate", "white-space")).toBe("normal");
    expect(declared("#result .title.text-truncate", "overflow")).toBe("visible");
    expect(declared("#result .title.text-truncate", "overflow-wrap")).toBe("anywhere");
  });

  it("lets the echoed query wrap anywhere", () => {
    expect(declared("#empty-did-not-match", "overflow-wrap")).toBe("anywhere");
    expect(declared("#results-status", "overflow-wrap")).toBe("anywhere");
  });

  it("lets the featured answer and the inline answer wrap anywhere", () => {
    expect(declared(".hd-best-bet-body", "overflow-wrap")).toBe("anywhere");
    expect(declared(".hd-answer", "overflow-wrap")).toBe("anywhere");
  });

  it("keeps a cache metadata value (URL, document id) inside the row: no start margin, wraps anywhere", () => {
    // the UA gives <dd> margin-inline-start: 40px, which pushed it past the right edge at 375px
    expect(declared(".cache-meta dd", "margin")).toBe("0px 0px 0.5rem");
    expect(declared(".cache-meta dd", "overflow-wrap")).toBe("anywhere");
  });
});
