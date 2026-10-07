// SPDX-License-Identifier: Apache-2.0
// docsearch: layout and small-screen polish.
//
// jsdom has no layout engine, so what is checked here is the stylesheet's contract, read
// back from the parsed rules of the theme's real styles.css (the declarations that carry the
// fix, in the media query that scopes them); the pixels were checked in a browser. The
// stale "did not match" panel is behaviour: the theme's real search.js against an api double.
//
// - A long unbroken query is echoed back ("did not match", the status line); it must wrap
//   instead of making the page thousands of pixels wide.
// - On the dark page the home logo (dark blue, transparent) is drawn white, as the header's is.
// - Below 768px the header makes room for the menu button: the palette trigger shrinks.
// - A search that fails must not leave the previous search's "did not match" panel on screen.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { modulePath, mountIndexBody } from "./helpers/themes.js";
import { resetDom, setLocation } from "./helpers/dom.js";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { SEARCH_FIXTURE, FULL_CFG, installDispatch, makeSearchEnv, settle } from "./helpers/searchFlow.js";

const THEME = "docsearch";

let sheet;
beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = readFileSync(modulePath(THEME, "styles.css"), "utf8");
  document.head.appendChild(style);
  sheet = style.sheet;
});

/**
 * The value `prop` ends up with for `selector`: the last declaration among the rules whose
 * selector list names it exactly, at the top level or, with `media`, inside the media rules
 * whose condition contains that text.
 */
function declared(selector, prop, media = null) {
  let value = null;
  const scan = (rules) => {
    for (const rule of rules) {
      const names = (rule.selectorText || "").split(",").map((n) => n.trim());
      if (names.includes(selector) && rule.style.getPropertyValue(prop)) value = rule.style.getPropertyValue(prop);
    }
  };
  if (media) {
    for (const rule of sheet.cssRules) if (rule.media && rule.media.mediaText.includes(media)) scan(rule.cssRules);
  } else {
    scan(sheet.cssRules);
  }
  return value;
}

describe("docsearch layout: stylesheet contract", () => {
  it("lets the echoed query wrap anywhere", () => {
    expect(declared("#empty-did-not-match", "overflow-wrap")).toBe("anywhere");
    expect(declared("#results-status", "overflow-wrap")).toBe("anywhere");
  });

  it("draws the home logo white on the dark page only", () => {
    expect(declared('[data-theme="dark"] #home-view .home-logo', "filter")).toBe("brightness(0) invert(1)");
    expect(declared("#home-view .home-logo", "filter")).toBeNull();
  });

  it("lets the palette trigger shrink below 768px, where the menu button shares its row", () => {
    // the base rule keeps a 220px floor for wide screens ...
    expect(declared(".ds-palette-trigger", "min-width")).toBe("220px");
    // ... which would run past the right edge of a 320-375px phone
    expect(declared(".ds-palette-trigger", "min-width", "max-width: 767.98px")).toBe("0px");
    expect(declared("#search-form-wrap", "min-width", "max-width: 767.98px")).toBe("0px");
    expect(declared(".ds-pt-kbd", "display", "max-width: 767.98px")).toBe("none");
  });

  it("opens the header menu as a panel under the header below 768px", () => {
    expect(declared("#header-nav.show", "position", "max-width: 767.98px")).toBe("absolute");
    expect(declared("#header-nav.show", "top", "max-width: 767.98px")).toBe("100%");
  });

  it("stacks the title above the breadcrumb in a palette row", () => {
    expect(declared(".ds-palette-row-title", "display")).toBe("block");
    expect(declared(".ds-palette-row-sub", "display")).toBe("block");
  });
});

describe("docsearch: a failed search does not leave the previous panel behind", () => {
  beforeEach(() => {
    resetDom();
    sessionStorage.clear();
    window.scrollTo = () => {};
  });
  afterEach(() => setLocation("/"));

  async function bootWithEmptyResult() {
    setLocation("/search?q=nothing");
    const flow = await loadSearchFlow(THEME, FULL_CFG);
    installDispatch(flow.get, { search: makeSearchEnv([]) });
    mountIndexBody(THEME);
    flow.mod.runFromUrl();
    await settle();
    return flow;
  }

  const emptyPanel = () => document.getElementById("empty-state");
  const banner = () => document.getElementById("search-error");

  it("shows the did-not-match panel for a search without hits (the baseline)", async () => {
    await bootWithEmptyResult();
    expect(emptyPanel().classList.contains("d-none")).toBe(false);
    expect(document.getElementById("empty-did-not-match").textContent).toBe("search.did_not_match");
    expect(banner().classList.contains("d-none")).toBe(true);
  });

  it("hides it when the next search is refused (a query that is too long)", async () => {
    const flow = await bootWithEmptyResult();
    flow.get.mockImplementation(async (path) => {
      if (path === "/search") throw Object.assign(new Error("q exceeds the maximum length of 1000"), { httpStatus: 400, code: "invalid_request" });
      return {};
    });
    setLocation("/search?q=" + "a".repeat(1001));
    flow.mod.runFromUrl();
    await settle();
    expect(banner().classList.contains("d-none")).toBe(false);
    expect(banner().textContent).toBe("q exceeds the maximum length of 1000");
    expect(emptyPanel().classList.contains("d-none")).toBe(true);
  });

  it("hides it when the next search fails with a server error", async () => {
    const flow = await bootWithEmptyResult();
    flow.get.mockImplementation(async (path) => {
      if (path === "/search") throw Object.assign(new Error("boom"), { httpStatus: 500 });
      return {};
    });
    setLocation("/search?q=other");
    flow.mod.runFromUrl();
    await settle();
    expect(banner().classList.contains("d-none")).toBe(false);
    expect(emptyPanel().classList.contains("d-none")).toBe(true);
  });

  it("shows the panel again once a later search comes back empty", async () => {
    const flow = await bootWithEmptyResult();
    flow.get.mockImplementationOnce(async () => { throw Object.assign(new Error("boom"), { httpStatus: 500 }); });
    setLocation("/search?q=other");
    flow.mod.runFromUrl();
    await settle();
    expect(emptyPanel().classList.contains("d-none")).toBe(true);
    installDispatch(flow.get, { search: makeSearchEnv([]) });
    setLocation("/search?q=third");
    flow.mod.runFromUrl();
    await settle();
    expect(emptyPanel().classList.contains("d-none")).toBe(false);
    expect(banner().classList.contains("d-none")).toBe(true);
  });
});
