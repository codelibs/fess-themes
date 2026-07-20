// SPDX-License-Identifier: Apache-2.0
// Characterization/pinning test for helpdesk's plainTitle() entity decode set.
//
// themes/helpdesk/assets/helpdesk.js is DOM-free by contract, so its plainTitle()
// does NOT route through format.js renderSnippetText() like the sibling themes'
// search.js plainTitle(). Instead it hand-rolls a CLOSED-SET HTML-entity decode of
// exactly the five entities LaFunctions.escape() emits (&lt; &gt; &#034; &#039;
// &amp;), decoding &amp; LAST so an escaped ampersand is not double-decoded.
//
// That closed set is correct only because it mirrors the server escape today.
// Nothing else catches silent drift: if a future edit narrows or reorders the set,
// the accessible name would start reading raw entities to screen-reader users
// again. This suite PINS the current decode behaviour so such an edit fails loudly.
//
// It asserts what the code does TODAY (a characterization test), not an idealized
// contract. helpdesk.js is DOM-free, so it loads cleanly under the jsdom/node
// runtime; it is not in the coverage include globs (format/markdown/search.js), so
// importing it here does not pull it into any coverage denominator.

import { describe, it, expect, beforeAll } from "vitest";
import { loadModule } from "./helpers/themes.js";

let plainTitle;
beforeAll(async () => {
  ({ plainTitle } = await loadModule("helpdesk", "helpdesk.js"));
});

describe("helpdesk plainTitle: pinned entity decode set", () => {
  // (a) Each of the five entities decodes on the content_title branch.
  it("decodes each of the five pinned entities", () => {
    expect(plainTitle({ content_title: "a &lt; b" })).toBe("a < b");
    expect(plainTitle({ content_title: "a &gt; b" })).toBe("a > b");
    expect(plainTitle({ content_title: "a &#034; b" })).toBe('a " b');
    expect(plainTitle({ content_title: "a &#039; b" })).toBe("a ' b");
    expect(plainTitle({ content_title: "a &amp; b" })).toBe("a & b");
  });

  it("decodes all five together in one title", () => {
    expect(
      plainTitle({ content_title: "&lt;x&gt; &#034;y&#034; &#039;z&#039; &amp;w" })
    ).toBe("<x> \"y\" 'z' &w");
  });

  // (b) Precedence: &amp; is decoded LAST, so an escaped ampersand followed by the
  // literal text of another entity does NOT double-decode.
  it("handles &amp; last so &amp;lt; stays a literal &lt;", () => {
    expect(plainTitle({ content_title: "&amp;lt;" })).toBe("&lt;");
    expect(plainTitle({ content_title: "&amp;gt;" })).toBe("&gt;");
    expect(plainTitle({ content_title: "&amp;#039;" })).toBe("&#039;");
    // A doubly-escaped ampersand collapses one level only.
    expect(plainTitle({ content_title: "&amp;amp;" })).toBe("&amp;");
  });

  // (c) Only the closed set is touched; other entities are left as literal text.
  it("leaves entities outside the pinned set untouched", () => {
    expect(plainTitle({ content_title: "5 &lt 6" })).toBe("5 &lt 6"); // no trailing ;
    expect(plainTitle({ content_title: "AT&T" })).toBe("AT&T"); // bare & is not &amp;
    expect(plainTitle({ content_title: "&nbsp; &copy;" })).toBe("&nbsp; &copy;");
    expect(plainTitle({ content_title: "&#038;" })).toBe("&#038;"); // numeric & not in set
  });

  // (d) Highlight markup (<strong>/<em>) is stripped, then the survivors decode; an
  // ESCAPED tag therefore reappears as literal text rather than being re-stripped.
  it("strips <strong>/<em> highlight tags on the content_title branch", () => {
    expect(plainTitle({ content_title: "x <strong>y</strong> z" })).toBe("x y z");
    expect(plainTitle({ content_title: "<em>a</em> <strong>b</strong>" })).toBe("a b");
    expect(plainTitle({ content_title: "<strong>What&#039;s</strong> new" })).toBe(
      "What's new"
    );
    // Escaped tag decodes AFTER stripping, so it survives as visible text.
    expect(plainTitle({ content_title: "&lt;strong&gt;hi&lt;/strong&gt;" })).toBe(
      "<strong>hi</strong>"
    );
  });

  // (e) Field precedence and the raw-fallback contract: content_title || title || url,
  // and the title/url fallback is NEVER decoded (those fields the server never escapes),
  // though <strong>/<em> stripping still runs on them.
  it("decodes only the content_title branch; title/url fall back verbatim (except tag strip)", () => {
    expect(plainTitle({ content_title: "CT", title: "T", url: "U" })).toBe("CT");
    // Non-empty content_title decodes...
    expect(plainTitle({ content_title: "AT&amp;T" })).toBe("AT&T");
    // ...but the raw title/url fallback is left encoded (no entity decode).
    expect(plainTitle({ title: "AT&amp;T" })).toBe("AT&amp;T");
    expect(plainTitle({ url: "a &lt; b" })).toBe("a &lt; b");
    // Literal angle brackets in raw fields are preserved (not treated as entities).
    expect(plainTitle({ title: "a<b>c" })).toBe("a<b>c");
    // Tag stripping still applies to the fallback branch.
    expect(plainTitle({ title: "a <strong>b</strong> c" })).toBe("a b c");
    // Empty content_title is falsy → falls through to title without decoding.
    expect(plainTitle({ content_title: "", title: "AT&amp;T" })).toBe("AT&amp;T");
  });

  // (f) Absent input yields the empty string.
  it("returns \"\" for null/undefined/empty documents", () => {
    expect(plainTitle(null)).toBe("");
    expect(plainTitle(undefined)).toBe("");
    expect(plainTitle({})).toBe("");
  });
});
