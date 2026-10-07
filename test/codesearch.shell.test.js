// SPDX-License-Identifier: Apache-2.0
// codesearch: the facet drawer below 960px and the "/" shortcut (app.js, index.html, styles.css).
//
// - Below 960px the facet rail is an off-canvas drawer. Only ".is-open" brings it back and
//   nothing used to add it, so the filters could not be reached: the results page now has a
//   Filters button that opens it, next to the Ask drawer it must not disturb.
// - The Help page lists "/ - Focus the search box"; there was no handler behind it.
//
// jsdom has no layout engine and does not evaluate media queries, so the button, the drawer
// state and the keys are driven for real, and the stylesheet is read back as parsed rules
// (which rule applies at which width). The pixels are checked in a browser.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { modulePath } from "./helpers/themes.js";
import { resetDom, setLocation } from "./helpers/dom.js";
import { bootApp } from "./helpers/loadShell.js";

const THEME = "codesearch";

let app;
let rail;
let toggle;
let scrim;
let askPanel;

beforeEach(async () => {
  resetDom();
  document.head.innerHTML = "";
  window.scrollTo = () => {};
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  setLocation("/help");
  app = await bootApp(THEME, { features: { rag_chat_enabled: true }, notifications: {} });
  rail = document.getElementById("facet-rail");
  toggle = document.getElementById("facet-toggle");
  scrim = document.getElementById("drawer-scrim");
  askPanel = document.getElementById("ask-panel");
});
afterEach(() => {
  app.detach();
  vi.resetModules();
  setLocation("/");
});

const key = (target, init) => {
  const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
};
const railOpen = () => rail.classList.contains("is-open");

describe("codesearch: the Filters button", () => {
  it("ships on the results page, labelled and wired to the rail, with the rail closed", () => {
    expect(toggle).not.toBeNull();
    expect(document.getElementById("results-view").contains(toggle)).toBe(true);
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("type")).toBe("button");
    expect(toggle.getAttribute("aria-controls")).toBe("facet-rail");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("data-i18n")).toBeNull();
    // the visible text is the existing "Filters" message
    expect(toggle.querySelector("[data-i18n]").getAttribute("data-i18n")).toBe("facet.filter_button");
    expect(railOpen()).toBe(false);
    expect(scrim.hidden).toBe(true);
  });

  it("is a header-style drawer toggle, so the stylesheet hides it above 960px", () => {
    expect(toggle.classList.contains("hbtn")).toBe(true);
    expect(toggle.classList.contains("drawer-toggle")).toBe(true);
  });

  it("opens the rail and the scrim, and says so", () => {
    toggle.click();
    expect(railOpen()).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(scrim.hidden).toBe(false);
  });

  it("closes the rail when it is pressed again", () => {
    toggle.click();
    toggle.click();
    expect(railOpen()).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(scrim.hidden).toBe(true);
  });

  it("closes on Escape and hands the focus back when it was inside the rail", () => {
    toggle.click();
    const box = document.createElement("input");
    rail.appendChild(box);
    box.focus();
    const ev = key(box, { key: "Escape" });
    expect(railOpen()).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(scrim.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("closes on a click on the scrim", () => {
    toggle.click();
    scrim.click();
    expect(railOpen()).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(scrim.hidden).toBe(true);
  });

  it("closes when the route changes", () => {
    toggle.click();
    document.dispatchEvent(new CustomEvent("fess:route:change"));
    expect(railOpen()).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(scrim.hidden).toBe(true);
  });

  it("leaves everything alone on Escape while the rail is closed", () => {
    askPanel.classList.add("is-open");
    scrim.hidden = false;
    key(document.body, { key: "Escape" });
    expect(askPanel.classList.contains("is-open")).toBe(true);
    expect(scrim.hidden).toBe(false);
  });

  it("closes the Ask drawer when it opens, and is closed by the Ask drawer opening", () => {
    askPanel.classList.add("is-open");
    toggle.click();
    expect(railOpen()).toBe(true);
    expect(askPanel.classList.contains("is-open")).toBe(false);
    expect(scrim.hidden).toBe(false);

    document.getElementById("ask-toggle").click();
    expect(askPanel.classList.contains("is-open")).toBe(true);
    expect(railOpen()).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(scrim.hidden).toBe(false);
  });

  it("does not touch the Ask drawer's own close button", () => {
    askPanel.classList.add("is-open");
    scrim.hidden = false;
    document.getElementById("ask-close").click();
    expect(askPanel.classList.contains("is-open")).toBe(false);
    expect(scrim.hidden).toBe(true);
  });
});

describe("codesearch: the drawer's stylesheet contract", () => {
  let sheet;
  beforeAll(() => {
    const style = document.createElement("style");
    style.textContent = readFileSync(modulePath(THEME, "styles.css"), "utf8");
    document.head.appendChild(style);
    sheet = style.sheet;
  });

  /** The value `prop` has for `selector`: the last rule of that selector, at the top level or inside the media rules named. */
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

  it("hides the button from 961px up and shows it (as a header button) below", () => {
    expect(declared(".drawer-toggle", "display", "min-width: 961px")).toBe("none");
    // nothing hides it at 960px or less: the base rule shows it
    expect(declared(".drawer-toggle", "display", "max-width: 960px")).toBeNull();
    expect(declared(".drawer-toggle", "display")).toBeNull();
    expect(declared(".hbtn", "display")).toBe("inline-flex");
  });

  it("slides the rail in with .is-open at 960px and below, and out otherwise", () => {
    expect(declared(".facet-rail", "transform", "max-width: 960px")).toBe("translateX(-102%)");
    expect(declared(".facet-rail.is-open", "transform", "max-width: 960px")).toBe("translateX(0)");
    expect(declared(".facet-rail", "position", "max-width: 960px")).toBe("fixed");
    // above 960px the rail is a sticky column, never transformed
    expect(declared(".facet-rail", "transform")).toBeNull();
  });

  it("hides the scrim above 960px", () => {
    expect(declared(".drawer-scrim", "display", "min-width: 961px")).toBe("none");
  });
});

describe('codesearch: "/" focuses the search box', () => {
  const input = () => document.getElementById("query-input");

  it("focuses the header box and selects its text", () => {
    input().value = "repo:fess parse";
    document.body.focus();
    const ev = key(document.body, { key: "/" });
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input());
    expect(input().selectionStart).toBe(0);
    expect(input().selectionEnd).toBe("repo:fess parse".length);
  });

  it("focuses it from a button too", () => {
    const ev = key(document.getElementById("help-link"), { key: "/" });
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input());
  });

  it("types a slash in the search box as usual", () => {
    input().focus();
    const ev = key(input(), { key: "/" });
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input());
  });

  it.each([
    ["a textarea", () => document.createElement("textarea")],
    ["a select", () => document.createElement("select")],
    ["another input", () => document.createElement("input")],
    ["an editable element", () => {
      const div = document.createElement("div");
      div.setAttribute("contenteditable", "true");
      return div;
    }],
    ["the inside of an editable element", () => {
      const div = document.createElement("div");
      div.setAttribute("contenteditable", "");
      div.appendChild(document.createElement("span"));
      document.body.appendChild(div);
      return div.firstChild;
    }],
  ])("types a slash in %s as usual", (_name, make) => {
    const field = make();
    if (!field.isConnected) document.body.appendChild(field);
    field.focus?.();
    const before = document.activeElement;
    const ev = key(field, { key: "/" });
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(before);
  });

  it("is not caught by an element that only looks editable", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "false");
    document.body.appendChild(div);
    const ev = key(div, { key: "/" });
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input());
  });

  it.each([["ctrl", { ctrlKey: true }], ["meta", { metaKey: true }], ["alt", { altKey: true }]])(
    "ignores %s+/", (_name, mods) => {
      document.body.focus();
      const ev = key(document.body, { key: "/", ...mods });
      expect(ev.defaultPrevented).toBe(false);
      expect(document.activeElement).not.toBe(input());
    });

  it("ignores other keys", () => {
    document.body.focus();
    const ev = key(document.body, { key: "?" });
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(input());
  });

  it("takes a slash typed with Shift, as on layouts where / needs it", () => {
    const ev = key(document.body, { key: "/", shiftKey: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input());
  });

  it("leaves a slash alone while a dialog is open", () => {
    document.getElementById("login-modal").classList.add("show");
    document.body.focus();
    const ev = key(document.body, { key: "/" });
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(input());
  });

  it("leaves a slash alone during an IME conversion", () => {
    document.body.focus();
    const ev = key(document.body, { key: "/", isComposing: true });
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe('codesearch: "/" on the home page', () => {
  beforeEach(async () => {
    app.detach();
    vi.resetModules();
    resetDom();
    setLocation("/");
    app = await bootApp(THEME, { features: {}, notifications: {} });
  });

  it("focuses the home box when the header box is not shown", () => {
    const home = document.getElementById("contentQuery");
    expect(document.getElementById("search-bar").hidden).toBe(true);
    home.value = "parse";
    document.body.focus();
    const ev = key(document.body, { key: "/" });
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(home);
    expect(home.selectionEnd).toBe("parse".length);
  });
});

describe('codesearch: "/" where there is no search box', () => {
  beforeEach(async () => {
    app.detach();
    vi.resetModules();
    resetDom();
    setLocation("/advance");
    app = await bootApp(THEME, { features: {}, notifications: {} });
  });

  it("does not swallow the key", () => {
    document.body.focus();
    const ev = key(document.body, { key: "/" });
    expect(ev.defaultPrevented).toBe(false);
  });
});
