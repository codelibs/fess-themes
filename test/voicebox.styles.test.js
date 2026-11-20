// SPDX-License-Identifier: Apache-2.0
// voicebox: the tertiary text colour (the footer, the info line of a result, the facet headings, the
// "more" links) reaches 4.5:1 on every surface it sits on.
//
// --bs-tertiary-color is --vb-text-tertiary, which was #A3A3A3: 2.42:1 on the page background. The
// light grey that was right on the black options drawer stays there as --vb-text-tertiary-on-dark.
// The ratios are computed here from the tokens in the real styles.css.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { modulePath } from "./helpers/themes.js";

const css = readFileSync(modulePath("voicebox", "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (c) => {
  const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** The custom properties declared in the first `:root { ... }` block. */
const root = Object.fromEntries([...css.match(/:root\s*\{([^}]*)\}/)[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]));

describe("voicebox: tertiary text contrast", () => {
  it("the footer and the bootstrap tertiary colour use --vb-text-tertiary", () => {
    expect(root["--bs-tertiary-color"]).toBe("var(--vb-text-tertiary)");
    expect(css).toMatch(/footer\[role="contentinfo"\]\s*\{[^}]*color:\s*var\(--bs-tertiary-color\)/);
  });

  it.each(["--vb-bg", "--vb-surface"])("--vb-text-tertiary on %s is at least 4.5:1", (surface) => {
    expect(ratio(rgb(root["--vb-text-tertiary"]), rgb(root[surface]))).toBeGreaterThanOrEqual(4.5);
  });

  it("the black options drawer keeps a light tertiary colour: --vb-text-tertiary-on-dark on --vb-primary is at least 4.5:1", () => {
    expect(ratio(rgb(root["--vb-text-tertiary-on-dark"]), rgb(root["--vb-primary"]))).toBeGreaterThanOrEqual(4.5);
    expect(css).toMatch(/#searchOptions label, #searchOptions legend \{[^}]*color:\s*var\(--vb-text-tertiary-on-dark\)/);
  });
});
