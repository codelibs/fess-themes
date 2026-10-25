// SPDX-License-Identifier: Apache-2.0
// docsearch: contrast, overflow, card layout and print, read back from the stylesheet.
//
// - The alert text colours and the text on an accent fill (option chips, primary badges) reach 4.5:1 in the
//   light AND the dark palette (the alert colours were light-theme literals: 1.8:1-1.9:1 on the dark page)
// - Native controls follow the palette (color-scheme)
// - A long unbroken run in a snippet or a breadcrumb wraps instead of widening the whole list
// - The type icon shares the title's row (and the title keeps its ellipsis); the copy button is a 24x24 target
// - The print sheet is always the light palette and carries only the results
//
// jsdom has no layout engine, so the stylesheet is read back from the theme's real styles.css (parsed rules,
// or the raw text for custom properties and rules jsdom's CSSOM drops); the pixels and the measured ratios
// were checked in a browser.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { modulePath } from "./helpers/themes.js";

const THEME = "docsearch";
const css = readFileSync(modulePath(THEME, "styles.css"), "utf8");

// ---------------------------------------------------------------- colour helpers
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** The body of the first `selector { ... }` block that declares --ds-bg. */
function paletteBlock(selector) {
  const re = new RegExp(`${selector.replace(/[[\]"]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g");
  for (const m of css.matchAll(re)) if (m[1].includes("--ds-bg")) return m[1].replace(/\/\*[\s\S]*?\*\//g, "");
  throw new Error(`no ${selector} block with the colour tokens`);
}
const hexTokens = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)].map((d) => [d[1], d[2]]));

const LIGHT = hexTokens(paletteBlock(":root"));
const DARK = { ...LIGHT, ...hexTokens(paletteBlock('[data-theme="dark"]')) };
const PALETTES = [["light", LIGHT], ["dark", DARK]];

/** The body of the `@media print { ... }` block (balanced braces). */
function printBlock() {
  const start = css.indexOf("@media print {\n  :root");
  if (start < 0) throw new Error("no print palette block");
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(css.indexOf("{", start) + 1, i);
  }
  throw new Error("unbalanced print block");
}

// ---------------------------------------------------------------- stylesheet contract
describe("docsearch: stylesheet contract", () => {
  let sheet;
  beforeAll(() => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    sheet = style.sheet;
  });

  /** The value `prop` ends up with for `selector`, at the top level or inside the media rules containing `media`. */
  function declared(selector, prop, media = null) {
    let value = null;
    const scan = (rules) => {
      for (const rule of rules) {
        const names = (rule.selectorText || "").split(",").map((n) => n.trim());
        if (names.includes(selector) && rule.style.getPropertyValue(prop)) value = rule.style.getPropertyValue(prop);
      }
    };
    if (media) {
      for (const rule of sheet.cssRules) if (rule.media && rule.media.mediaText.includes(media)) scan(rule.cssRules);
    } else {
      scan(sheet.cssRules);
    }
    return value;
  }

  describe("alerts", () => {
    const KINDS = [["info", "info"], ["success", "success"], ["warning", "warning"], ["danger", "error"]];

    it.each(KINDS)("alert-%s takes its text colour from a token, not a light-theme literal", (kind, token) => {
      const rule = css.match(new RegExp(`\\.alert-${kind}\\s*\\{[^}]*\\}`))[0];
      expect(rule).toContain(`color: var(--ds-${token}-text)`);
    });

    it.each(PALETTES)("alert text reaches 4.5:1 on its fill in the %s palette", (_name, p) => {
      for (const token of ["info", "success", "warning", "error"]) {
        expect(ratio(p[`--ds-${token}-text`], p[`--ds-${token}-subtle`]), `${token} ${p[`--ds-${token}-text`]} on ${p[`--ds-${token}-subtle`]}`)
          .toBeGreaterThanOrEqual(4.5);
      }
    });
  });

  describe("text on an accent fill (option chips, primary badges)", () => {
    it.each(PALETTES)("is 4.5:1 or more on the accent in the %s palette", (_name, p) => {
      expect(ratio(p["--ds-on-accent"], p["--ds-accent"])).toBeGreaterThanOrEqual(4.5);
    });

    it("is what .text-bg-primary and .bg-primary use", () => {
      expect(declared(".text-bg-primary", "color")).toContain("var(--ds-on-accent)");
      expect(declared(".bg-primary", "color")).toContain("var(--ds-on-accent)");
    });

    it("is what .btn-primary uses, at rest and on hover (white on the dark accent was 2.98:1)", () => {
      expect(declared(".btn-primary", "color")).toContain("var(--ds-on-accent)");
      expect(declared(".btn-primary:hover", "color")).toContain("var(--ds-on-accent)");
    });

    it.each(PALETTES)("keeps the hover fill of a primary button at 4.5:1 with that text in the %s palette", (_name, p) => {
      expect(ratio(p["--ds-on-accent"], p["--ds-accent-hover"])).toBeGreaterThanOrEqual(4.5);
    });
  });

  it("tells native controls which palette is active", () => {
    // jsdom's CSSOM drops color-scheme, so the raw blocks are read
    expect(paletteBlock(":root")).toMatch(/color-scheme:\s*light\b/);
    expect(paletteBlock('[data-theme="dark"]')).toMatch(/color-scheme:\s*dark\b/);
  });

  describe("long unbroken text", () => {
    it("wraps a snippet anywhere and lets the flex item shrink", () => {
      expect(declared("#result .description", "overflow-wrap")).toBe("anywhere");
      expect(declared("#result .description", "min-width")).toBe("0px");
      expect(declared("#results", "min-width")).toBe("0px");
    });

    it("wraps a breadcrumb segment anywhere and lets the breadcrumb shrink", () => {
      expect(declared(".ds-crumb", "overflow-wrap")).toBe("anywhere");
      expect(declared(".ds-crumb", "min-width")).toBe("0px");
      expect(declared(".ds-breadcrumb", "min-width")).toBe("0px");
    });
  });

  describe("result card", () => {
    it("lays the type icon and the title link out in one row", () => {
      expect(declared("#result .title", "display")).toBe("flex");
      expect(declared("#result .title", "align-items")).toBe("center");
    });

    it("keeps the single-line ellipsis on the title link (the h3 is a flex container now)", () => {
      expect(declared("#result .title a", "min-width")).toBe("0px");
      expect(declared("#result .title a", "overflow")).toBe("hidden");
      expect(declared("#result .title a", "text-overflow")).toBe("ellipsis");
      expect(declared("#result .title a", "white-space")).toBe("nowrap");
    });

    it("gives the copy-URL button a 24x24 minimum target", () => {
      expect(declared("#result .url-copy-btn", "min-width")).toBe("24px");
      expect(declared("#result .url-copy-btn", "min-height")).toBe("24px");
    });

    it("shows a whole snippet once the phone's 'more' control is pressed", () => {
      expect(declared("#result li.is-expanded .description", "white-space", "max-width: 575.98px")).toBe("normal");
      expect(declared("#result li.is-expanded .description", "overflow", "max-width: 575.98px")).toBe("visible");
    });
  });

  describe("print", () => {
    it("redefines every palette token the print block names as the light value, over the dark palette", () => {
      const block = printBlock();
      const printed = hexTokens(block.slice(0, block.indexOf("}")));
      expect(Object.keys(printed).length).toBeGreaterThan(15);
      for (const [token, value] of Object.entries(printed)) {
        expect(value.toLowerCase(), token).toBe(LIGHT[token].toLowerCase());
      }
      // every token the dark palette moves away from the light one is put back
      const darkOnly = hexTokens(paletteBlock('[data-theme="dark"]'));
      for (const token of Object.keys(darkOnly)) expect(printed[token], `${token} is restored for print`).toBeDefined();
      expect(block).toMatch(/:root,\s*\[data-theme="dark"\]\s*\{/);
      expect(block).toMatch(/color-scheme:\s*light/);
    });

    it("keeps the controls off the sheet", () => {
      const block = printBlock();
      for (const sel of ["#facet-body", "#facet-toggle-wrap", "#options-bar", "#current-filters", "#active-chips", "#subfooter", "#searchOptions"]) {
        expect(block, sel).toContain(sel);
      }
      expect(block).toMatch(/display:\s*none\s*!important/);
    });

    it("comes after the dark palette, which it has to override at equal specificity", () => {
      expect(css.indexOf("@media print {\n  :root")).toBeGreaterThan(css.indexOf('[data-theme="dark"] {'));
    });
  });
});
