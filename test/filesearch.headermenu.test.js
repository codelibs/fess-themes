// SPDX-License-Identifier: Apache-2.0
// filesearch: the header nav (sign-in, AI search, help) below 768px. The nav is hidden there
// by the layout, so #headerNavToggle opens it as a menu; app.js closes the menu again after a
// choice, on a route change and on Escape. The theme's real index.html, compat.js (the
// Collapse the toggle drives) and app.js run together; api and i18n are doubles.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { modulePath } from "./helpers/themes.js";
import { resetDom, setLocation } from "./helpers/dom.js";
import { bootApp } from "./helpers/loadShell.js";

const THEME = "filesearch";

let app;
let nav;
let toggle;

beforeAll(() => {
  // compat.js is a classic script that defines window.bootstrap; run it once in this window.
  window.matchMedia = () => ({ matches: true });
  (0, eval)(readFileSync(modulePath(THEME, "compat.js"), "utf8"));
});

beforeEach(async () => {
  resetDom();
  document.head.innerHTML = "";
  window.scrollTo = () => {};
  setLocation("/help");
  app = await bootApp(THEME, { features: {}, notifications: {} });
  nav = document.getElementById("header-nav");
  toggle = document.getElementById("headerNavToggle");
});
afterEach(() => {
  app.detach();
  vi.resetModules();
  setLocation("/");
});

const isOpen = () => nav.classList.contains("show");

describe("filesearch: header menu on a narrow screen", () => {
  it("ships the nav closed, behind a labelled toggle that controls it", () => {
    expect(isOpen()).toBe(false);
    expect(toggle.getAttribute("aria-controls")).toBe("header-nav");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // its accessible name is the translated nav.menu text (visually hidden: the button is an icon)
    expect(toggle.querySelector("[data-i18n]").getAttribute("data-i18n")).toBe("nav.menu");
    expect(toggle.textContent.trim()).not.toBe("");
    // help is one of the entries behind it
    expect(nav.contains(document.getElementById("help-link"))).toBe(true);
  });

  it("opens and closes with the toggle, keeping aria-expanded in step", () => {
    toggle.click();
    expect(isOpen()).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    toggle.click();
    expect(isOpen()).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes once an entry is chosen", () => {
    toggle.click();
    document.getElementById("help-link").click();
    expect(isOpen()).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes when the route changes", () => {
    toggle.click();
    document.dispatchEvent(new CustomEvent("fess:route:change"));
    expect(isOpen()).toBe(false);
  });

  it("closes on Escape and puts the focus back on the toggle", () => {
    toggle.click();
    document.getElementById("help-link").focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(toggle);
  });

  it("leaves Escape alone while the menu is closed", () => {
    const other = document.getElementById("query");
    other.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).toBe(other);
  });
});
