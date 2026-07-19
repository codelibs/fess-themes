// SPDX-License-Identifier: Apache-2.0
// Cross-theme parity: fess-themes ships one copy of each shared core module per
// theme, and they are intended to be byte-identical EXCEPT the per-theme brand
// comment on line 2. Nothing else in the repo enforces this — verify-bundles.mjs
// checks only locale bundles, and CLAUDE.md documents the invariant by hand.
// This suite locks it for the two modules the harness exercises (format.js and
// markdown.js): drop line 2 from every theme's copy and require the remainder
// to be identical across all themes.
//
// Self-contained within fess-themes — it reads only files under themes/.

import { describe, it, expect } from "vitest";
import { themes, readModuleSource } from "./helpers/themes.js";

/**
 * Remove line 2 (the per-theme "// Common formatting utilities for the <X> SPA."
 * comment) so the rest can be compared across themes. Line 1 is the shared SPDX
 * header; line 2 is the only intentional per-theme divergence in these modules.
 */
function dropLine2(src) {
  const lines = src.split("\n");
  lines.splice(1, 1); // remove the 2nd line (index 1)
  return lines.join("\n");
}

describe.each(["format.js", "markdown.js"])("cross-theme parity: %s", (moduleName) => {
  it("is byte-identical across all 10 themes once line 2 is dropped", () => {
    expect(themes.length).toBe(10);
    const reference = dropLine2(readModuleSource(themes[0], moduleName));
    for (const theme of themes) {
      const normalised = dropLine2(readModuleSource(theme, moduleName));
      expect(normalised, `${theme}/assets/${moduleName} diverges from ${themes[0]}`).toBe(reference);
    }
  });

  it("differs only on line 2 (the per-theme brand comment)", () => {
    // Sanity check that line 2 really is the divergence point: the full sources
    // are NOT all identical, and the difference is confined to line 2.
    const line2s = new Set(themes.map((t) => readModuleSource(t, moduleName).split("\n")[1]));
    expect(line2s.size).toBeGreaterThan(1);
  });
});
