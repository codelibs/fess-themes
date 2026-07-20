// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
//
// isSafeHref must FAIL LOUDLY when there is no DOM, rather than laundering a
// missing window/location into a false "unsafe" verdict.
//
// This file runs under the node environment (no jsdom), so `window` is
// undefined and `new URL(value, window.location.href)` raises a ReferenceError.
// A ReferenceError is NOT a TypeError, so the canonical catch rethrows it
// instead of returning false. Pre-sync, each theme's blanket `catch { return
// false }` swallowed it — this suite locks the corrected behaviour in.
//
// It also proves every theme's format.js imports cleanly under a DOM-less
// runtime (no module-scope document/window), matching bootstrap's
// DOM-free-importable contract after the sync.

import { describe, it, expect } from "vitest";
import { themes, loadModule } from "./helpers/themes.js";

describe.each(themes)("isSafeHref without a DOM [%s]", (theme) => {
  it("throws (does not return false) when window is unavailable", async () => {
    const { isSafeHref } = await loadModule(theme, "format.js");
    expect(() => isSafeHref("https://example.com/")).toThrow();
  });
});
