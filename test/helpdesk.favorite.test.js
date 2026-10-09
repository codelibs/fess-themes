// SPDX-License-Identifier: Apache-2.0
// helpdesk: the favorite star never promises what the API cannot do. /api/v2 can add a favorite
// but not remove one, so a favorited star is named "Added to favorites", is aria-disabled and sends
// nothing on a click (the cases are shared with the other themes that keep the bootstrap result
// DOM, helpers/resultsContract.js), and the stylesheet shows it as not clickable.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { modulePath } from "./helpers/themes.js";
import { defineFavoriteTests } from "./helpers/resultsContract.js";

const THEME = "helpdesk";

defineFavoriteTests(THEME);

describe(`${THEME}: the favorite star's stylesheet contract`, () => {
  let sheet;
  beforeAll(() => {
    const style = document.createElement("style");
    style.textContent = readFileSync(modulePath(THEME, "styles.css"), "utf8");
    document.head.appendChild(style);
    sheet = style.sheet;
  });

  it("styles a favorited star as not clickable", () => {
    let cursor = null;
    for (const rule of sheet.cssRules) {
      const names = (rule.selectorText || "").split(",").map((n) => n.trim());
      if (names.includes('.result-card .favorite-btn[aria-disabled="true"]')) cursor = rule.style.getPropertyValue("cursor");
    }
    expect(cursor).toBe("default");
  });
});
