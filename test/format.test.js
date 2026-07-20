// SPDX-License-Identifier: Apache-2.0
// Behavioural tests for the shared format.js that ships inside every theme.
// These import and EXECUTE each theme's real, shipped format.js (adapted from
// codelibs/fess PR #3194's bootstrap format.test.js to the fess-themes API).
// Since the format.js sync to canonical, each theme exports the full bootstrap
// surface, including renderHighlightedSnippet AND renderSnippetText.
//
// sanitizeHtml returns a DocumentFragment (not a string), so it is serialised
// through a detached <div> to inspect the resulting markup — exactly how the
// theme's callers append it.

import { describe, it, expect } from "vitest";
import { themes, loadModule } from "./helpers/themes.js";
import { serializeFragment } from "./helpers/dom.js";

// Load every theme's own copy of format.js up front (top-level await, native ESM).
const mods = Object.fromEntries(
  await Promise.all(themes.map(async (t) => [t, await loadModule(t, "format.js")]))
);

describe.each(themes)("format.js [%s]", (theme) => {
  const {
    escapeHtml,
    formatFileSize,
    formatDate,
    isSafeHref,
    sanitizeHtml,
    renderHighlightedSnippet,
    renderSnippetText,
  } = mods[theme];

  /** Serialise the DocumentFragment sanitizeHtml() returns into an HTML string. */
  const clean = (html) => serializeFragment(sanitizeHtml(html));

  describe("escapeHtml", () => {
    it("escapes all five HTML metacharacters", () => {
      expect(escapeHtml("<a href=\"x\">&'</a>")).toBe(
        "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;"
      );
    });

    it("returns empty string for null/undefined", () => {
      expect(escapeHtml(null)).toBe("");
      expect(escapeHtml(undefined)).toBe("");
    });
  });

  describe("formatFileSize", () => {
    it.each([
      [0, "0 B"],
      [1023, "1023 B"],
      [1024, "1.0 KB"],
      [1048576, "1.0 MB"],
      [1073741824, "1.0 GB"],
    ])("formats %d bytes as %s", (bytes, expected) => {
      expect(formatFileSize(bytes)).toBe(expected);
    });

    it("returns empty string for invalid or negative input", () => {
      expect(formatFileSize(null)).toBe("");
      expect(formatFileSize(undefined)).toBe("");
      expect(formatFileSize("")).toBe("");
      expect(formatFileSize("abc")).toBe("");
      expect(formatFileSize(-1)).toBe("");
    });
  });

  describe("formatDate", () => {
    it("formats an ISO string as YYYY-MM-DD HH:MM in local time", () => {
      // Build the expectation from the same Date the code uses so the test is
      // independent of the runner's timezone.
      const d = new Date("2026-07-17T09:05:00");
      const pad = (x) => String(x).padStart(2, "0");
      const expected =
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
        `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      expect(formatDate("2026-07-17T09:05:00")).toBe(expected);
    });

    it("returns empty string for empty or invalid input", () => {
      expect(formatDate("")).toBe("");
      expect(formatDate(null)).toBe("");
      expect(formatDate("not-a-date")).toBe("");
    });
  });

  describe("isSafeHref", () => {
    it.each([
      "https://example.com",
      "http://example.com",
      "mailto:a@b.com",
      "tel:+1-555-0100",
      "/relative/path",
      "relative/path",
      "#frag",
    ])("accepts %s", (href) => expect(isSafeHref(href)).toBe(true));

    it.each([
      "javascript:alert(1)",
      "java\tscript:alert(1)", // tab-obfuscated scheme must still be rejected
      "java\nscript:alert(1)", // newline-obfuscated scheme
      " javascript:alert(1)", // leading whitespace stripped, still rejected
      "\u0001javascript:alert(1)", // leading C0 control char — URL parser normalises it away
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "http://%", // malformed: new URL() throws, so the catch branch returns false
      "",
    ])("rejects %s", (href) => expect(isSafeHref(href)).toBe(false));

    it("rejects non-string input", () => {
      expect(isSafeHref(null)).toBe(false);
      expect(isSafeHref(undefined)).toBe(false);
      expect(isSafeHref(42)).toBe(false);
    });
  });

  describe("sanitizeHtml: headings h1-h6 all survive (the H1/H5/H6 fix)", () => {
    // The regression this whole harness guards: format.js ALLOWED_TAGS must
    // keep H1..H6. Pre-fix, H1/H5/H6 were unwrapped to bare text.
    it.each(["h1", "h2", "h3", "h4", "h5", "h6"])("keeps <%s>", (tag) => {
      expect(clean(`<${tag}>x</${tag}>`)).toBe(`<${tag}>x</${tag}>`);
    });
  });

  describe("sanitizeHtml: allowed markup", () => {
    it("keeps <hr>", () => {
      expect(clean("<hr>")).toBe("<hr>");
    });

    it("keeps safe structural markup", () => {
      expect(clean("<p>text</p>")).toBe("<p>text</p>");
      expect(clean("<ul><li>a</li></ul>")).toBe("<ul><li>a</li></ul>");
      expect(clean("<blockquote>q</blockquote>")).toBe("<blockquote>q</blockquote>");
    });

    it("unwraps a disallowed inline tag but keeps its text", () => {
      // <b> is not in ALLOWED_TAGS (only STRONG/EM are), so it is unwrapped.
      expect(clean("<p><b>bold</b></p>")).toBe("<p>bold</p>");
    });
  });

  describe("sanitizeHtml: DROP_WITH_CONTENT drops the whole subtree", () => {
    const DROPPED = [
      "IFRAME", "NOEMBED", "NOFRAMES", "PLAINTEXT", "SCRIPT",
      "STYLE", "TEXTAREA", "TITLE", "XMP", "NOSCRIPT", "TEMPLATE",
    ];
    it.each(DROPPED)("%s: the element and its content are both removed", (tag) => {
      const t = tag.toLowerCase();
      const out = clean(`<div>KEEP<${t}>EVIL</${t}></div>`);
      expect(out).toContain("KEEP");
      expect(out).not.toContain("EVIL");
      expect(out.toLowerCase()).not.toContain(`<${t}`);
    });
  });

  describe("sanitizeHtml: object/embed are NOT dropped whole", () => {
    it("preserves <object> fallback prose by unwrapping it", () => {
      const out = clean("<div><object>fallback prose</object></div>");
      expect(out).toContain("fallback prose");
    });

    it("does not leave an <embed> element (void, unwrapped to nothing)", () => {
      const out = clean('<div>KEEP<embed src="x"></div>');
      expect(out).toContain("KEEP");
      expect(out.toLowerCase()).not.toContain("<embed");
    });
  });

  describe("sanitizeHtml: attribute and scheme filtering", () => {
    it("strips event-handler attributes", () => {
      const out = clean('<img src="x" onerror="alert(1)">');
      expect(out).not.toContain("onerror");
    });

    it("drops a javascript: href", () => {
      const out = clean('<a href="javascript:alert(1)">x</a>');
      expect(out).not.toContain("javascript:");
      expect(out).toContain("x");
    });

    it("keeps a safe href and marks external links", () => {
      const out = clean('<a href="https://example.com">x</a>');
      expect(out).toContain('href="https://example.com"');
      expect(out).toContain('rel="nofollow noopener noreferrer"');
      expect(out).toContain('target="_blank"');
    });

    it("keeps a safe non-external href without adding target/rel", () => {
      // A relative link is safe but not external, so it gets neither target nor
      // rel (exercises the non-external branch of the href handler).
      expect(clean('<a href="/local/path">x</a>')).toBe('<a href="/local/path">x</a>');
    });

    it("keeps allowed table attributes and drops the rest", () => {
      const out = clean(
        '<table class="t" onclick="x"><tbody><tr>' +
          '<th scope="col">h</th><td colspan="2" style="x">c</td>' +
          "</tr></tbody></table>"
      );
      expect(out).toContain('class="t"');
      expect(out).toContain('scope="col"');
      expect(out).toContain('colspan="2"');
      expect(out).not.toContain("onclick");
      expect(out).not.toContain("style");
    });

    it("drops a droppable child while unwrapping its disallowed parent", () => {
      // <b> unwraps; its comment child is removed rather than surfaced.
      expect(clean("<b>keep<!-- secret --></b>")).toBe("keep");
    });

    it("removes comment nodes", () => {
      expect(clean("<p>a</p><!-- secret -->")).toBe("<p>a</p>");
    });

    it("unwraps a disallowed element at the top level (no wrapper)", () => {
      // Exercises the fragment-level replace path: the top-level node is itself
      // disallowed and unwraps to its sanitized children.
      expect(clean("<b>bold</b>")).toBe("bold");
    });
  });

  describe("renderHighlightedSnippet: server snippet is parsed, not re-escaped", () => {
    it("keeps the highlight tags <strong>/<em>", () => {
      expect(renderHighlightedSnippet("a <strong>b</strong> c")).toBe("a <strong>b</strong> c");
      expect(renderHighlightedSnippet("<em>x</em>")).toBe("<em>x</em>");
    });

    it("unwraps any tag outside SNIPPET_TAGS", () => {
      expect(renderHighlightedSnippet("<p>x</p>")).toBe("x");
    });

    it("drops a raw-text element whole (no source leak)", () => {
      expect(renderHighlightedSnippet("<script>alert(1)</script>tail")).toBe("tail");
    });

    it("decodes server entities without double-escaping", () => {
      // The server sends a literal quote as the entity &#034;; parsing decodes
      // it back to " rather than painting the literal text &#034;.
      expect(renderHighlightedSnippet("&#034;q&#034;")).toBe('"q"');
    });

    it("returns empty string for empty input", () => {
      expect(renderHighlightedSnippet("")).toBe("");
      expect(renderHighlightedSnippet(null)).toBe("");
    });
  });

  describe("renderSnippetText: server snippet reduced to plain text", () => {
    // Verified against the canonical bootstrap impl (fess format.test.js):
    // it runs renderHighlightedSnippet's exact parse-and-sanitize path but
    // returns the fragment's text instead of its HTML.
    it("decodes entities to plain text and strips tags", () => {
      expect(renderSnippetText("AT&T")).toBe("AT&T");              // ampersand preserved as text
      expect(renderSnippetText("<strong>hi</strong>")).toBe("hi"); // live tag stripped to its text
    });

    it("returns empty string for empty input", () => {
      expect(renderSnippetText("")).toBe("");
      expect(renderSnippetText(null)).toBe("");
    });
  });
});
