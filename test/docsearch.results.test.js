// SPDX-License-Identifier: Apache-2.0
// docsearch: what runSearch() leaves on the page, and the stylesheet contract of the layout and
// colour fixes.
//
//   - The document title carries the query literally (`$&`, `$$`)
//   - The status line's "(0.06 seconds)" reads `exec_time` (a decimal string on the v2 API)
//   - The pager is made of real links with aria-current and page names
//   - A favorited star is "Added to favorites" and not clickable, since the API cannot remove one
//   - The cache metadata values stay inside the row
//   - The tertiary text colour keeps 4.5:1 against the surfaces it is drawn on, in the light and in the dark palette
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

  it("keeps a cache metadata value (URL, document id) inside the row: no start margin, wraps anywhere", () => {
    // the UA gives <dd> margin-inline-start: 40px, which pushed it past the right edge at 375px
    expect(declared(".cache-meta dd", "margin")).toBe("0px 0px 0.5rem");
    expect(declared(".cache-meta dd", "overflow-wrap")).toBe("anywhere");
  });

  it("styles a favorited star as not clickable", () => {
    expect(declared('.result-card .favorite-btn[aria-disabled="true"]', "cursor")).toBe("default");
  });
});

describe(`${THEME}: the tertiary text colour is readable`, () => {
  const css = readFileSync(modulePath(THEME, "styles.css"), "utf8");

  /** The custom properties declared by the first rule whose selector is `selector` and that declares --ds-bg. */
  function tokens(selector) {
    const re = new RegExp(`${selector.replace(/[[\]"]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g");
    for (const m of css.matchAll(re)) {
      if (!m[1].includes("--ds-bg")) continue;
      const out = {};
      for (const d of m[1].replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) out[d[1]] = d[2];
      return out;
    }
    throw new Error(`no ${selector} block with the colour tokens`);
  }

  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  // The footer copyright, the breadcrumb, the result meta line and the hints are drawn in
  // --ds-text-faint on the page background, the inset surface and (hovered rows) the accent tint.
  const SURFACES = ["--ds-bg", "--ds-surface", "--ds-surface-2", "--ds-accent-subtle"];

  it.each([
    ["light", ":root"],
    ["dark", '[data-theme="dark"]'],
  ])("--ds-text-faint reaches 4.5:1 on every surface in the %s palette", (_name, selector) => {
    const light = tokens(":root");
    const palette = { ...light, ...(selector === ":root" ? {} : tokens(selector)) };
    for (const surface of SURFACES) {
      expect(ratio(palette["--ds-text-faint"], palette[surface]), `${surface} ${palette[surface]}`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps white text readable on the neutral badge fill in both palettes", () => {
    const light = tokens(":root");
    const dark = tokens('[data-theme="dark"]');
    expect(ratio("#FFFFFF", light["--ds-neutral-fill"])).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#FFFFFF", dark["--ds-neutral-fill"])).toBeGreaterThanOrEqual(4.5);
  });
});
