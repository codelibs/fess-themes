// SPDX-License-Identifier: Apache-2.0
// Behavioural tests for the shared markdown.js that ships inside every theme.
// These import and EXECUTE each theme's real, shipped markdown.js (which imports
// its sibling format.js). parseMarkdown returns an HTML string, so no DOM
// serialisation is needed here — the parseMarkdown -> sanitizeHtml pipeline is
// exercised separately in pipeline.test.js.
//
// Adapted from codelibs/fess PR #3194's bootstrap markdown.test.js.

import { describe, it, expect } from "vitest";
import { themes, loadModule } from "./helpers/themes.js";

const mods = Object.fromEntries(
  await Promise.all(themes.map(async (t) => [t, await loadModule(t, "markdown.js")]))
);

describe.each(themes)("markdown.js [%s]", (theme) => {
  const { parseMarkdown } = mods[theme];

  describe("ATX headings h1-h6", () => {
    it.each([
      ["#", "h1"],
      ["##", "h2"],
      ["###", "h3"],
      ["####", "h4"],
      ["#####", "h5"],
      ["######", "h6"],
    ])("%s renders as <%s>", (hashes, tag) => {
      expect(parseMarkdown(`${hashes} Title`)).toBe(`<${tag}>Title</${tag}>`);
    });

    it("clamps to h6: seven hashes are not a heading", () => {
      // HEADING_RE only accepts 1-6 hashes followed by a space, so a 7-hash line
      // is a plain paragraph, never <h7>.
      const out = parseMarkdown("####### Title");
      expect(out).not.toMatch(/<h7/);
      expect(out).toBe("<p>####### Title</p>");
    });
  });

  describe("horizontal rules and autolinks", () => {
    it.each(["---", "***", "___"])("%s renders as <hr>", (rule) => {
      expect(parseMarkdown(rule)).toBe("<hr>");
    });

    it("wraps a bare <https://...> as an external anchor", () => {
      expect(parseMarkdown("<https://example.com/a>")).toBe(
        '<p><a href="https://example.com/a" target="_blank" rel="nofollow noopener noreferrer">https://example.com/a</a></p>'
      );
    });

    it("does not autolink a javascript: angle-bracket URL", () => {
      // The autolink regex requires an http(s):// prefix, so a javascript:
      // angle-bracket never becomes an anchor — it stays escaped text.
      const out = parseMarkdown("<javascript:alert(1)>");
      expect(out).not.toContain("<a ");
      expect(out).toContain("&lt;javascript:alert(1)&gt;");
    });

    it("does not autolink a data: angle-bracket URL", () => {
      const out = parseMarkdown("<data:text/html,x>");
      expect(out).not.toContain("<a ");
    });
  });

  describe("tables and blockquotes", () => {
    it("renders a GFM table with thead and tbody", () => {
      const out = parseMarkdown("| a | b |\n|---|---|\n| 1 | 2 |");
      expect(out).toBe(
        '<table class="table"><thead><tr><th>a</th><th>b</th></tr></thead>' +
          "<tbody><tr><td>1</td><td>2</td></tr></tbody></table>"
      );
    });

    it("renders a simple blockquote", () => {
      expect(parseMarkdown("> quoted")).toBe("<blockquote>quoted</blockquote>");
    });
  });

  describe("nested lists and blockquotes", () => {
    it("renders a flat unordered list", () => {
      expect(parseMarkdown("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    });

    it("renders a flat ordered list", () => {
      expect(parseMarkdown("1. a\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>");
    });

    it("nests an indented unordered sub-list inside its parent item", () => {
      expect(parseMarkdown("- a\n  - b")).toBe("<ul><li>a<ul><li>b</li></ul></li></ul>");
    });

    it("nests an ordered sub-list", () => {
      expect(parseMarkdown("1. a\n  1. b")).toBe("<ol><li>a<ol><li>b</li></ol></li></ol>");
    });

    it("nests a blockquote via a doubled marker", () => {
      expect(parseMarkdown("> outer\n>> inner")).toBe(
        "<blockquote>outer<br><blockquote>inner</blockquote></blockquote>"
      );
    });

    it("still nests when an item skips an indent level", () => {
      // A sub-item indented past the next level exercises the deep-jump branch
      // of the list renderer; b must still render nested under a.
      const out = parseMarkdown("- a\n    - b");
      expect(out.startsWith("<ul><li>a")).toBe(true);
      expect(out).toContain("<li>b</li>");
    });
  });

  describe("inline constructs", () => {
    it("renders **bold** and *italic*", () => {
      expect(parseMarkdown("**b** and *i*")).toBe("<p><strong>b</strong> and <em>i</em></p>");
    });

    it("renders __bold__ and _italic_ underscore variants", () => {
      expect(parseMarkdown("__b__ and _i_")).toBe("<p><strong>b</strong> and <em>i</em></p>");
    });

    it("renders inline `code` without applying emphasis inside it", () => {
      expect(parseMarkdown("use `a**b**c` here")).toBe("<p>use <code>a**b**c</code> here</p>");
    });

    it("renders a fenced code block, escaping its contents", () => {
      expect(parseMarkdown("```\n<b>&\n```")).toBe("<pre><code>&lt;b&gt;&amp;</code></pre>");
    });

    it("renders a heading line embedded in a multi-line paragraph block", () => {
      // A block whose lines are not uniformly headings/list/quote/table falls to
      // the mixed-paragraph path, which still renders an individual heading line.
      const out = parseMarkdown("intro\n## Mid\noutro");
      expect(out).toContain("<h2>Mid</h2>");
    });

    it("keeps a safe [text](https) link and marks it external", () => {
      expect(parseMarkdown("[t](https://example.com)")).toBe(
        '<p><a href="https://example.com" target="_blank" rel="nofollow noopener noreferrer">t</a></p>'
      );
    });

    it("drops a javascript: link, leaving only its text", () => {
      const out = parseMarkdown("[t](javascript:alert(1))");
      expect(out).not.toContain("<a ");
      expect(out).toContain("t");
    });

    it("escapes raw HTML so no live tag is emitted", () => {
      const out = parseMarkdown("<img src=x onerror=alert(1)>");
      expect(out).not.toContain("<img");
      expect(out).toContain("&lt;img");
    });

    it("returns empty string for empty or non-string input", () => {
      expect(parseMarkdown("")).toBe("");
      expect(parseMarkdown(null)).toBe("");
      expect(parseMarkdown(undefined)).toBe("");
    });
  });
});
