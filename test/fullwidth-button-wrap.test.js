// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// rawblock and voicebox give every .btn white-space: nowrap, so the full-width passkey button of the sign-in dialog could not
// wrap its upper-case label: in Russian it was 423 px (rawblock) and 379 px (voicebox) wide in a 375 px window.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = (t) => readFileSync(join(root, "themes", t, "assets", "styles.css"), "utf8");

describe.each(["rawblock", "voicebox"])("%s: a full-width button wraps its label", (t) => {
  it("keeps .btn on one line but lets .btn.w-100 wrap, after the .btn rule", () => {
    const s = css(t);
    const btn = s.search(/\n\.btn \{[^}]*white-space: nowrap;/);
    const wrap = s.search(/\n\.btn\.w-100 \{ white-space: normal; \}/);
    expect(btn).toBeGreaterThanOrEqual(0);
    expect(wrap).toBeGreaterThan(btn);
  });
});
