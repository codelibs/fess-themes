// SPDX-License-Identifier: Apache-2.0
// docsearch: what runSearch() leaves on the page, and the stylesheet contract of the layout and
// colour fixes.
//
//   - The document title carries the query literally (`$&`, `$$`)
//   - The status line's "(0.06 seconds)" reads `exec_time` (a decimal string on the v2 API)
//   - The pager is made of real links with aria-current and page names
//   - A favorited star is "Added to favorites" and not clickable, since the API cannot remove one
//
// The cases are shared with the other themes that keep the bootstrap runSearch() contract
// (helpers/resultsContract.js); jsdom has no layout engine, so the stylesheet is read back from the
// theme's real styles.css (the pixels and the measured ratios were checked in a browser).

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { modulePath } from "./helpers/themes.js";

import {
  defineExecTimeTests, defineTitleTests, definePagerTests, defineFavoriteTests,
} from "./helpers/resultsContract.js";

const THEME = "docsearch";

defineExecTimeTests(THEME);
defineTitleTests(THEME);
definePagerTests(THEME);
defineFavoriteTests(THEME);

describe(`${THEME} layout: stylesheet contract`, () => {
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

  it("styles a favorited star as not clickable", () => {
    expect(declared('.result-card .favorite-btn[aria-disabled="true"]', "cursor")).toBe("default");
  });
});
