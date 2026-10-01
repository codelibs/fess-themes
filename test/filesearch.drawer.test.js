// SPDX-License-Identifier: Apache-2.0
// filesearch: the search options drawer. It slides in from beyond the right edge, which hides
// it from the eye but not from the Tab key: a closed drawer must also be out of the tab order
// and the accessibility tree (visibility: hidden), and an open one must be reachable.
//
// The theme's real index.html, styles.css and compat.js (the Collapse that the Options
// button drives) run in a window of their own, since compat.js installs document-level
// listeners.

import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { modulePath, readIndexHtml } from "./helpers/themes.js";

const THEME = "filesearch";

describe("filesearch: options drawer", () => {
  let window;
  let drawer;
  let panel;
  let button;

  beforeEach(() => {
    const dom = new JSDOM(readIndexHtml(THEME), { runScripts: "outside-only" });
    window = dom.window;
    window.matchMedia = () => ({ matches: true });
    const style = window.document.createElement("style");
    style.textContent = readFileSync(modulePath(THEME, "styles.css"), "utf8");
    window.document.head.appendChild(style);
    window.eval(readFileSync(modulePath(THEME, "compat.js"), "utf8"));
    drawer = window.document.getElementById("searchOptions");
    panel = drawer.querySelector(".container");
    button = window.document.getElementById("searchOptionsButton");
  });

  const visibility = () => window.getComputedStyle(panel).visibility;

  it("is hidden while closed, so none of its fields can take focus", () => {
    expect(drawer.classList.contains("show")).toBe(false);
    expect(visibility()).toBe("hidden");
    expect(window.getComputedStyle(panel.querySelector("#numSearchOption")).visibility).toBe("hidden");
  });

  it("is visible once the Options button opens it, and hidden again when it closes", () => {
    button.click();
    expect(drawer.classList.contains("show")).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(visibility()).toBe("visible");
    expect(window.getComputedStyle(panel.querySelector("#searchOptionsClearButton")).visibility).toBe("visible");

    button.click();
    expect(drawer.classList.contains("show")).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(visibility()).toBe("hidden");
  });
});
