// SPDX-License-Identifier: Apache-2.0
// codesearch: the search-match highlight reaches 4.5:1 in the light AND the dark palette.
//
// The highlight (mark, .match, and the <strong>/<em> tags of a snippet) is --match text on a
// translucent --match-bg tint. In the light palette --match was #b8730a, 3.19:1 on that tint over a
// result card. The ratios are computed here from the tokens in the real styles.css, compositing the
// tint over each surface the highlight can sit on.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { modulePath } from "./helpers/themes.js";

const css = readFileSync(modulePath("codesearch", "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (c) => {
  const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** The custom properties declared in the first `selector { ... }` block. */
function tokens(selector) {
  const m = css.match(new RegExp(`${selector.replace(/[[\]"]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no ${selector} block`);
  return Object.fromEntries([...m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]));
}

/** The highlight text colour against its tint composited over `surface`. */
function highlightRatio(palette, surface) {
  const [, r, g, b, a] = palette["--match-bg"].match(/rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  const tint = [r, g, b].map((v, i) => Number(v) * Number(a) + rgb(surface)[i] * (1 - Number(a)));
  return ratio(rgb(palette["--match"]), tint);
}

const light = { ...tokens(":root"), ...tokens('[data-theme="light"]') };
const dark = tokens(":root");

describe("codesearch: search-match highlight contrast", () => {
  for (const [name, palette] of [["light", light], ["dark", dark]]) {
    for (const token of ["--surface", "--bg", "--raised"]) {
      it(`${name}: --match on --match-bg over ${token} is at least 4.5:1`, () => {
        expect(highlightRatio(palette, palette[token])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("mark, .match and the snippet tags all use the --match pair", () => {
    for (const selector of ["mark, .match", ".result-card .code-text strong,\\s*.result-card .code-text em", ".result-generic .result-snippet strong,\\s*.result-generic .result-snippet em"]) {
      const m = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
      expect(m, selector).not.toBeNull();
      expect(m[1]).toContain("background: var(--match-bg)");
      expect(m[1]).toContain("color: var(--match)");
    }
  });
});
