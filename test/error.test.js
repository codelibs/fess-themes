// SPDX-License-Identifier: Apache-2.0
// error.js (JSP retirement, spec §8.5): ErrorPageServlet now renders the active theme
// at the URL that failed, with the real HTTP status, instead of redirecting to a
// bootstrap page with ?url=. error.js is byte-identical across all 10 themes
// (parity.test.js), copied unchanged from the fess bootstrap theme, but is exercised
// here per theme (describe.each) rather than once against a single copy, matching
// this suite's convention for behaviour that ships in every theme's bundle.
//
// The real i18n.t() returns the requested key unchanged (messages are empty without
// init), which lets these assertions pin exactly which i18n key each element uses.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { themes, loadModule, modulePath } from "./helpers/themes.js";
import { resetDom, setLocation } from "./helpers/dom.js";

beforeEach(resetDom);
afterEach(() => setLocation("/"));

describe.each(themes)("%s: error page", (theme) => {
  it("shows the current path as the requested URL when the page is served in place", async () => {
    const { attach } = await loadModule(theme, "error.js");
    document.head.innerHTML = '<meta name="x-fess-error-code" content="404">';
    document.body.innerHTML = '<div id="error-view"></div>';
    setLocation("/missing/page");
    attach();
    expect(document.querySelector("#error-view .error-detail dd").textContent).toBe("/missing/page");
  });

  it("renders the 403 title", async () => {
    const { attach } = await loadModule(theme, "error.js");
    document.head.innerHTML = '<meta name="x-fess-error-code" content="403">';
    document.body.innerHTML = '<div id="error-view"></div>';
    attach();
    expect(document.querySelector("#error-view .error-title").textContent).toBe("error.title_403");
  });

  // A bookmarked /error/403 (or /error/forbidden) still resolves without the
  // meta tag, the same as the other reserved path segments (400/404/429/500/503).
  it.each([
    ["/error/403", "403"],
    ["/error/forbidden", "403"],
  ])("codeFromPath(%s) → %s", async (path, code) => {
    const { codeFromPath } = await loadModule(theme, "error.js");
    expect(codeFromPath(path)).toBe(code);
  });
});

// Bundle check: the three keys error.js's new behaviour depends on
// (error.title_403 / error.body_403 for the 403 render; error.detail_not_load_from_server
// for the /go errors.not_load_from_server detail, which otherwise renders nothing —
// t() skips a key whose lookup falls back to the key itself) must exist in every
// locale bundle of every theme. verify-bundles.mjs enforces key-set parity WITHIN a
// theme's own bundles; it does not know these three keys must exist at all.
const NEW_ERROR_KEYS = ["error.title_403", "error.body_403", "error.detail_not_load_from_server"];

describe.each(themes)("%s: error i18n bundles", (theme) => {
  const i18nDir = join(dirname(dirname(modulePath(theme, "app.js"))), "i18n");
  const bundles = readdirSync(i18nDir).filter((f) => /^messages\..+\.json$/.test(f));

  it("every one of the 16 bundles carries the three error keys", () => {
    expect(bundles.length).toBe(16);
    for (const file of bundles) {
      const messages = JSON.parse(readFileSync(join(i18nDir, file), "utf8"));
      for (const key of NEW_ERROR_KEYS) {
        expect(typeof messages[key], `${theme}/i18n/${file} ${key}`).toBe("string");
      }
    }
  });
});
