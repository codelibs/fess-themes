// SPDX-License-Identifier: Apache-2.0
// Fess 15.9 inserts <base href="{context path}/"> into index.html. A root-absolute URL
// skips the context path, so a theme must use URLs relative to that base (and
// stylesheets relative to themselves).

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { themes, modulePath, readIndexHtml } from "./helpers/themes.js";

/** Substrings that only a root-absolute URL (or the removed #contextPath) produces. */
const ABSOLUTE_IN_JS = [
  '"/api/v2', '"/themes/', "`/themes/", 'navigate("/', '.href = "/', 'setAttribute("href", "/',
  'href: "/', "href: `/", 'href^="/', '"/go/', "`/go/", '"/thumbnail/', "`/thumbnail/",
  '"/cache/?', "`/cache/?", '"/osdd"', 'location.assign("/', "location.assign(`/",
  'getElementById("contextPath")', "ctxPath(",
];

describe.each(themes)("%s: URLs relative to <base href>", (theme) => {
  const assetsDir = dirname(modulePath(theme, "app.js"));

  it("index.html has no root-absolute href or src", () => {
    const found = readIndexHtml(theme).match(/(?:href|src)="\/[^"]*"/g) || [];
    expect(found).toEqual([]);
  });

  it("index.html no longer carries the unused #contextPath input", () => {
    expect(readIndexHtml(theme)).not.toContain('id="contextPath"');
  });

  it("asset modules use no root-absolute URL", () => {
    for (const file of readdirSync(assetsDir).filter((f) => f.endsWith(".js"))) {
      const src = readFileSync(join(assetsDir, file), "utf8");
      for (const absolute of ABSOLUTE_IN_JS) {
        expect(src.includes(absolute), `${theme}/assets/${file} contains ${absolute}`).toBe(false);
      }
    }
  });

  it("stylesheets reference no root-absolute url()", () => {
    for (const file of readdirSync(assetsDir).filter((f) => f.endsWith(".css"))) {
      const src = readFileSync(join(assetsDir, file), "utf8");
      expect(/url\(\s*["']?\//.test(src), `${theme}/assets/${file}`).toBe(false);
    }
  });
});
