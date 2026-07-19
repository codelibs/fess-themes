// SPDX-License-Identifier: Apache-2.0
// Regression lock for the static-theme file: link fix. Each theme's search.js
// gates result links (buildGoUrl and/or safeHref) by URL scheme. The original
// allowlist admitted only http/https/ftp/ftps, so file:/smb: (file-system and
// SMB crawl results) collapsed to "#" and Fess's /go/ File Proxy was never
// reached. Every theme's scheme gate must also admit the file-system schemes
// ProtocolHelper.isFileSystemPath() recognises.
//
// Source-level (not behavioural): safeHref is module-private in the themes and
// codesearch exports neither helper, so a text assertion covers all 10 copies
// uniformly. Behavioural coverage lives in fess core's search.test.js. This
// reads only theme source (no import), so it does not touch the coverage gate.

import { describe, it, expect } from "vitest";
import { themes, readModuleSource } from "./helpers/themes.js";

// Schemes ProtocolHelper.isFileSystemPath() recognises — every theme's search.js
// scheme gate must admit these in addition to the web schemes.
const FS_SCHEMES = ["file:", "smb:", "smb1:", "storage:", "s3:", "gcs:"];

describe("static-theme file: link fix", () => {
  it("covers all 10 themes", () => {
    expect(themes.length).toBe(10);
  });

  describe.each(themes)("scheme gate: %s/assets/search.js", (theme) => {
    const src = readModuleSource(theme, "search.js");
    it.each(FS_SCHEMES)("admits the %s scheme", (scheme) => {
      expect(src, `${theme}/assets/search.js scheme gate is missing ${scheme}`)
        .toContain(`"${scheme}"`);
    });

    // Widening the scheme gate is necessary but NOT sufficient: a browser
    // refuses to navigate from an http(s) page to a file://smb:// href, so a
    // file-system result MUST be routed through Fess's same-origin /go/ File
    // Proxy. The substring gate above stayed green for codesearch even though it
    // linked straight to the raw file:// href; this asserts the /go/ route
    // exists so that gap cannot recur.
    it("routes result links through the /go/ File Proxy", () => {
      expect(src, `${theme}/assets/search.js never references the /go/ File Proxy`)
        .toContain("/go/");
    });
  });
});
