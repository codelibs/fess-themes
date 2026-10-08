// SPDX-License-Identifier: Apache-2.0
// A theme's entry page loads everything from the theme itself. Fess serves index.html with a
// Content-Security-Policy header of its own (default-src 'self'; style-src 'self' 'unsafe-inline'
// ...), and the browser applies it on top of the page's <meta> policy, so a stylesheet, script or
// font from another host is refused and reported as a CSP violation in the console on every page
// load: the <meta> tag cannot relax it. (Four themes linked Google Fonts for a while.)

import { describe, it, expect } from "vitest";
import { themes, parseIndexHtml } from "./helpers/themes.js";

describe.each(themes)("%s: index.html names no third-party host", (theme) => {
  const doc = parseIndexHtml(theme);

  it("loads no stylesheet, script, image, font or preconnect target from an absolute http(s) URL", () => {
    const urls = [...doc.querySelectorAll("link[href], script[src], img[src], iframe[src], source[src]")]
      .map((e) => e.getAttribute("href") || e.getAttribute("src"))
      .filter((u) => /^(https?:)?\/\//i.test(u));
    expect(urls).toEqual([]);
  });

  it("has a <meta> Content-Security-Policy that allows no host", () => {
    const meta = doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
    expect(meta).not.toBeNull();
    expect(meta.getAttribute("content")).not.toMatch(/https?:\/\/|\*\./);
  });
});
