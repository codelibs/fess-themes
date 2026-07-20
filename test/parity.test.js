// SPDX-License-Identifier: Apache-2.0
// Cross-theme parity: fess-themes ships one copy of each shared core module per
// theme, and — since the sync to the canonical bootstrap copies — they are
// intended to be FULLY byte-identical, line 2 (the former per-theme brand
// comment) included. Nothing else in the repo enforces this — verify-bundles.mjs
// checks only locale bundles, and CLAUDE.md documents the invariant by hand.
// This suite locks it for the two modules the harness exercises (format.js and
// markdown.js): every theme's copy must be byte-for-byte identical, so a plain
// full-source comparison suffices (no line-2 normalization).
//
// Self-contained within fess-themes — it reads only files under themes/.

import { describe, it, expect } from "vitest";
import { themes, readModuleSource } from "./helpers/themes.js";

describe.each(["format.js", "markdown.js"])("cross-theme parity: %s", (moduleName) => {
  it("is byte-identical across all 10 themes (line 2 included)", () => {
    expect(themes.length).toBe(10);
    const reference = readModuleSource(themes[0], moduleName);
    for (const theme of themes) {
      const source = readModuleSource(theme, moduleName);
      expect(source, `${theme}/assets/${moduleName} diverges from ${themes[0]}`).toBe(reference);
    }
  });

  it("line 2 (the former per-theme brand comment) is now uniform", () => {
    // Previously the single intentional divergence point; the canonical sync
    // neutralized it, so every theme's line 2 must now be identical.
    const line2s = new Set(themes.map((t) => readModuleSource(t, moduleName).split("\n")[1]));
    expect(line2s.size).toBe(1);
  });
});
