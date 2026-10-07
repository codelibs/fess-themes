// SPDX-License-Identifier: Apache-2.0
// docsearch: the header nav (sign-in, AI search, theme toggle, help) below 768px. The nav is hidden there
// by the layout, so #headerNavToggle opens it as a menu; app.js closes the menu again after a
// choice, on a route change and on Escape. The theme's real index.html, compat.js (the
// Collapse the toggle drives) and app.js run together; api and i18n are doubles.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { modulePath } from "./helpers/themes.js";
import { resetDom, setLocation } from "./helpers/dom.js";
import { bootApp } from "./helpers/loadShell.js";

const THEME = "docsearch";

let app;
let nav;
let toggle;

beforeAll(() => {
  // compat.js is a classic script that defines window.bootstrap; run it once in this window.
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
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

describe("docsearch: header menu on a narrow screen", () => {
  it("ships the nav closed, behind a labelled toggle that controls it", () => {
    expect(isOpen()).toBe(false);
    expect(toggle.getAttribute("aria-controls")).toBe("header-nav");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // an icon-only button: its accessible name is the translated nav.menu text
    expect(toggle.getAttribute("data-i18n-aria-label")).toBe("nav.menu");
    expect(toggle.getAttribute("aria-label")).toBeTruthy();
    // help is one of the entries behind it
    expect(nav.contains(document.getElementById("help-link"))).toBe(true);
  });

  it("keeps the nav in line from 768px up and shows the toggle only below it", () => {
    expect(nav.classList.contains("collapse")).toBe(true);
    expect(nav.classList.contains("d-md-flex")).toBe(true);
    expect(nav.classList.contains("d-none")).toBe(false);
    expect(toggle.classList.contains("d-md-none")).toBe(true);
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
    const other = document.getElementById("brand-link");
    other.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).toBe(other);
  });
});
