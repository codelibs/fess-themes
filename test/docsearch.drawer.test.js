// SPDX-License-Identifier: Apache-2.0
// docsearch: the search options drawer and the legacy header search form.
//
// Both are hidden from the eye in a way that leaves them in the tab order: the drawer slides
// in from beyond the right edge, the header form is clipped to a pixel. A closed drawer and
// the clipped form must be out of the tab order and the accessibility tree (visibility:
// hidden), and the drawer must close the way an overlay does: on Escape and on a click
// outside it, with the focus going back to the control that opened it.
//
// The theme's real index.html, styles.css, compat.js (the Collapse behind the toggles),
// app.js and palette.js run together; api and i18n are doubles.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { modulePath } from "./helpers/themes.js";
import { resetDom, setLocation } from "./helpers/dom.js";
import { bootApp } from "./helpers/loadShell.js";

const THEME = "docsearch";

let app;
let drawer;
let panel;
let toggle;

beforeAll(() => {
  // compat.js is a classic script that defines window.bootstrap and the click/Escape
  // listeners of the declarative toggles; run it once in this window.
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  (0, eval)(readFileSync(modulePath(THEME, "compat.js"), "utf8"));
});

beforeEach(async () => {
  resetDom();
  document.head.innerHTML = "";
  const style = document.createElement("style");
  style.textContent = readFileSync(modulePath(THEME, "styles.css"), "utf8");
  document.head.appendChild(style);
  window.scrollTo = () => {};
  localStorage.clear();
  setLocation("/help");
  app = await bootApp(THEME, { features: {}, notifications: {} });
  drawer = document.getElementById("searchOptions");
  panel = drawer.querySelector(".container");
  toggle = document.getElementById("home-options-toggle");
});
afterEach(() => {
  app.detach();
  vi.resetModules();
  setLocation("/");
});

const visibility = (el) => window.getComputedStyle(el).visibility;
const isOpen = () => drawer.classList.contains("show");
const key = (name, target = document.body) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));

describe("docsearch: closed drawer and legacy form are out of the tab order", () => {
  it("hides the closed drawer and every field in it", () => {
    expect(isOpen()).toBe(false);
    expect(visibility(panel)).toBe("hidden");
    for (const id of ["numSearchOption", "sortSearchOption", "geo-lat", "searchOptionsClearButton", "searchOptionsAdvanceLink"]) {
      expect(visibility(document.getElementById(id))).toBe("hidden");
    }
  });

  it("shows the drawer while it is open and hides it again once closed", () => {
    toggle.click();
    expect(isOpen()).toBe(true);
    expect(visibility(panel)).toBe("visible");
    expect(visibility(document.getElementById("numSearchOption"))).toBe("visible");
    toggle.click();
    expect(isOpen()).toBe(false);
    expect(visibility(panel)).toBe("hidden");
  });

  it("hides the clipped legacy header form and its controls, but not the visible palette trigger", () => {
    for (const id of ["search-form", "query", "searchButton", "searchOptionsButton"]) {
      expect(visibility(document.getElementById(id))).toBe("hidden");
    }
    expect(visibility(document.getElementById("palette-trigger"))).toBe("visible");
  });
});

describe("docsearch: closing the drawer", () => {
  it("moves the focus into the drawer when a toggle opens it", () => {
    toggle.focus();
    toggle.click();
    expect(document.activeElement).toBe(panel);
  });

  it("closes on Escape and puts the focus back on the control that opened it", () => {
    toggle.focus();
    toggle.click();
    expect(isOpen()).toBe(true);
    key("Escape", document.getElementById("numSearchOption"));
    expect(isOpen()).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("returns the focus to an options-bar link that opened it", () => {
    const link = document.createElement("a");
    link.href = "#searchOptions";
    link.setAttribute("data-bs-toggle", "collapse");
    document.getElementById("options-bar").appendChild(link);
    link.focus();
    link.click();
    expect(isOpen()).toBe(true);
    key("Escape");
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(link);
  });

  it("closes on a click outside the drawer, but not on one inside it", () => {
    toggle.click();
    document.getElementById("numSearchOption").click();
    panel.click();
    expect(isOpen()).toBe(true);
    document.getElementById("page-root").click();
    expect(isOpen()).toBe(false);
  });

  it("is closed, not reopened, by a second click on its toggle", () => {
    toggle.click();
    toggle.click();
    expect(isOpen()).toBe(false);
  });

  it("leaves Escape alone while the drawer is closed", () => {
    const other = document.getElementById("brand-link");
    other.focus();
    key("Escape");
    expect(document.activeElement).toBe(other);
  });

  it("leaves Escape to the command palette while it is open on top of the drawer", () => {
    toggle.click();
    // Ctrl+K opens the palette without a click, which would count as one outside the drawer.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(document.getElementById("palette").hidden).toBe(false);
    key("Escape", document.getElementById("palette-input"));
    expect(document.getElementById("palette").hidden).toBe(true);
    expect(isOpen()).toBe(true);
    key("Escape");
    expect(isOpen()).toBe(false);
  });
});
