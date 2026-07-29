// SPDX-License-Identifier: Apache-2.0
// Source contract: a comparison against a v2 API error code must accept the
// LOWERCASE wire code the server actually sends.
//
// Fess's V2ErrorCode pairs a SCREAMING_SNAKE_CASE Java constant with a lowercase
// snake_case wire code (AUTH_REQUIRED -> "auth_required"). The server writes the WIRE
// CODE onto the error envelope, each theme's api.js copies it onto the thrown ApiError
// verbatim (`new ApiError(err.code || "UNKNOWN", ...)`), and no theme normalises the
// case anywhere. So a branch that compares err.code only to the Java CONSTANT NAME is
// dead: it can never match a real server response, and the user silently gets the wrong
// message (or, where a `|| e.httpStatus === 4xx` fallback exists, the right message for
// the wrong reason — which is why the defect survived so long).
//
// Writing a behavioural test for each of the ~40 comparison sites across ten themes is
// not practical, and behavioural tests only cover the sites someone remembered to write
// one for. This suite instead reads the shipped source of every theme and fails on ANY
// uppercase-only comparison, so neither a new branch nor a new theme can reintroduce
// the defect. The companion wire-error-codes.test.js stays: this contract proves a
// comparison is not misspelled, only that one proves the right message is produced.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { themes, modulePath } from "./helpers/themes.js";

/**
 * V2ErrorCode's constant -> wire code table, from the fess repo
 * (src/main/java/org/codelibs/fess/api/v2/V2ErrorCode.java). Hardcoded because that
 * source lives in a different repository; the bootstrap reference copy of this suite
 * (fess: src/test/js/themes/bootstrap/wire-error-codes.contract.test.js) parses the
 * enum directly, so a constant added there fails that suite and this table is updated
 * along with it.
 */
const WIRE_CODES = new Map([
  ["INVALID_REQUEST", "invalid_request"],
  ["AUTH_REQUIRED", "auth_required"],
  ["FORBIDDEN", "forbidden"],
  ["NOT_FOUND", "not_found"],
  ["CONFLICT", "conflict"],
  ["METHOD_NOT_ALLOWED", "method_not_allowed"],
  ["RATE_LIMITED", "rate_limited"],
  ["UNSUPPORTED_MEDIA_TYPE", "unsupported_media_type"],
  ["PAYLOAD_TOO_LARGE", "payload_too_large"],
  ["SERVICE_UNAVAILABLE", "service_unavailable"],
  ["NOT_ACCEPTABLE", "not_acceptable"],
  ["INTERNAL_ERROR", "internal_error"],
]);

/**
 * Uppercase string literals api.js mints CLIENT-SIDE that are deliberately NOT subject
 * to this contract:
 *
 *   NETWORK / PROTOCOL  — transport and envelope-shape failures detected before any
 *                         server error code exists (invalid JSON, missing envelope).
 *   UNKNOWN             — the fallback when the server omits error.code entirely
 *                         (`new ApiError(err.code || "UNKNOWN", ...)`).
 *   HTTP_ERROR          — a non-JSON HTTP failure with no v2 envelope at all.
 *   BUFFER_OVERFLOW     — a streaming-reader guard, purely local.
 *
 * These never travel over the wire, so there is no lowercase counterpart to compare
 * against and no server spelling they could disagree with. They are listed here (a) to
 * document why they are exempt and (b) so the disjointness assertion below fails loudly
 * if a future V2ErrorCode constant ever collides with one of these names — at which
 * point the same literal would mean two different things.
 */
const CLIENT_SENTINELS = ["NETWORK", "PROTOCOL", "UNKNOWN", "HTTP_ERROR", "BUFFER_OVERFLOW"];

/**
 * Every `<something>.code === "LITERAL"` / `code === "LITERAL"` comparison in a file.
 * `===` binds tighter than `||`/`&&`, so each match is one complete operand of the
 * surrounding condition.
 */
const COMPARISON = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*===\s*"([A-Z][A-Z0-9_]*)"/g;

/** The .js modules a theme ships under assets/ (path.join drops the empty segment). */
const assetsOf = (theme) =>
  readdirSync(modulePath(theme, "")).filter((f) => f.endsWith(".js")).sort();

/**
 * Collect every uppercase wire-code comparison in `theme`'s copy of `file` that does
 * NOT also test the lowercase spelling within the same condition. The convention every
 * fixed site follows is `x.code === "lower" || x.code === "UPPER"` on ONE line, so a
 * same-line check is both sufficient and deliberately strict: it keeps the two
 * spellings adjacent and reviewable instead of scattered across a condition.
 */
function scan(theme, file) {
  const lines = readFileSync(modulePath(theme, file), "utf8").split("\n");
  const found = [];
  let checked = 0;
  lines.forEach((line, i) => {
    for (const m of line.matchAll(COMPARISON)) {
      const [, lhs, upper] = m;
      if (!WIRE_CODES.has(upper)) continue; // client sentinel or unrelated literal
      checked++;
      const lower = WIRE_CODES.get(upper);
      if (!new RegExp(`===\\s*"${lower}"`).test(line)) {
        found.push(`themes/${theme}/assets/${file}:${i + 1}  ${lhs} === "${upper}" without "${lower}"`);
      }
    }
  });
  return { found, checked };
}

describe("v2 wire-code table", () => {
  it("maps every constant to a distinct lowercase snake_case wire code", () => {
    expect(WIRE_CODES.size).toBe(12);
    for (const [name, code] of WIRE_CODES) {
      expect(code, `${name} wire code`).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(code, `${name} wire code must differ from the constant name`).not.toBe(name);
    }
  });

  it("keeps the client-side sentinels disjoint from the wire codes", () => {
    for (const sentinel of CLIENT_SENTINELS) {
      expect(WIRE_CODES.has(sentinel), `${sentinel} is both a client sentinel and a wire code`).toBe(false);
    }
  });

  it("actually finds wire-code comparisons to check (guards against a vacuous pass)", () => {
    expect(themes.length).toBeGreaterThanOrEqual(10);
    const total = themes.reduce(
      (n, t) => n + assetsOf(t).reduce((m, f) => m + scan(t, f).checked, 0),
      0,
    );
    expect(total, "no wire-code comparisons found at all — the scan is broken").toBeGreaterThan(20);
  });
});

describe.each(themes)("%s: compares the lowercase v2 wire codes", (theme) => {
  it.each(assetsOf(theme))("%s pairs every uppercase wire code with its lowercase form", (file) => {
    const { found } = scan(theme, file);
    expect(found, `uppercase-only v2 error-code comparison(s):\n${found.join("\n")}`).toEqual([]);
  });
});
