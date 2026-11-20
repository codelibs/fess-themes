// SPDX-License-Identifier: Apache-2.0
// Every form control of a theme's index.html has an accessible name: an aria-label (static or
// data-i18n-aria-label, which i18n.js turns into one), an aria-labelledby, a <label for>, a wrapping
// <label> or a title. A control without one is announced by a screen reader as just "edit text" or
// "combo box". Hidden inputs and buttons (their text is their name) are not form controls here.
//
// The names of controls a script creates later are not covered: this reads the static markup.

import { describe, it, expect } from "vitest";
import { themes, parseIndexHtml } from "./helpers/themes.js";

const nameOf = (el, doc) => {
  if ((el.getAttribute("aria-label") || el.getAttribute("data-i18n-aria-label") || "").trim()) return "aria-label";
  if ((el.getAttribute("aria-labelledby") || "").trim()) return "aria-labelledby";
  if ((el.getAttribute("title") || "").trim()) return "title";
  if (el.id && doc.querySelector(`label[for="${el.id}"]`)) return "label[for]";
  if (el.closest("label")) return "label";
  return null;
};

describe.each(themes)("%s: form controls of index.html have an accessible name", (theme) => {
  it("names every input, select and textarea", () => {
    const doc = parseIndexHtml(theme);
    const unnamed = [...doc.querySelectorAll("input, select, textarea")]
      .filter((el) => !["hidden", "submit", "button", "reset", "image"].includes((el.getAttribute("type") || "").toLowerCase()))
      .filter((el) => !nameOf(el, doc))
      .map((el) => `${el.tagName.toLowerCase()}#${el.id || "-"}`);
    expect(unnamed).toEqual([]);
  });
});
