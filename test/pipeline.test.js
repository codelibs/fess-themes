// SPDX-License-Identifier: Apache-2.0
// Cross-module contract: chat.js renders assistant Markdown by piping
// parseMarkdown() straight into sanitizeHtml(). Neither module can be judged in
// isolation — markdown.js emits <h1>..<h6>, but what the user actually sees is
// whatever survives the sanitizer's ALLOWED_TAGS whitelist. This file exercises
// the real two-module pipeline end to end, per theme's own copies.
//
// This is precisely the defect class a source string-match cannot catch:
// markdown.js's HEADING_RE literally contains "#{1,6}", yet a heading level the
// whitelist omits is silently stripped before display. Before the H1/H5/H6 fix,
// the h1/h5/h6 cases below FAIL; with the fix applied they pass.
//
// Adapted from codelibs/fess PR #3194's bootstrap pipeline.test.js.

import { describe, it, expect } from "vitest";
import { themes, loadModule } from "./helpers/themes.js";

const md = Object.fromEntries(
  await Promise.all(themes.map(async (t) => [t, await loadModule(t, "markdown.js")]))
);
const fmt = Object.fromEntries(
  await Promise.all(themes.map(async (t) => [t, await loadModule(t, "format.js")]))
);

describe.each(themes)("chat pipeline [%s]", (theme) => {
  const { parseMarkdown } = md[theme];
  const { sanitizeHtml } = fmt[theme];

  /** The exact chat.js pipeline: parseMarkdown -> sanitizeHtml -> append. */
  const renderInto = (source) => {
    const bubble = document.createElement("div");
    bubble.appendChild(sanitizeHtml(parseMarkdown(source)));
    return bubble;
  };

  /** Serialised HTML the pipeline puts into the chat bubble. */
  const render = (source) => renderInto(source).innerHTML;

  describe("every heading level markdown emits must survive the sanitizer", () => {
    it.each([
      ["#", "h1"],
      ["##", "h2"],
      ["###", "h3"],
      ["####", "h4"],
      ["#####", "h5"],
      ["######", "h6"],
    ])("%s renders as a visible <%s>", (hashes, tag) => {
      // markdown.js produces <hN>; if ALLOWED_TAGS omits hN the sanitizer
      // unwraps it and the heading text collapses to a bare string. Assert the
      // tag actually reaches the DOM. This is the H1/H5/H6 regression guard.
      expect(render(`${hashes} Heading`)).toBe(`<${tag}>Heading</${tag}>`);
    });
  });

  describe("block constructs survive intact", () => {
    it("keeps a GFM table with its class and structure", () => {
      expect(render("| a | b |\n|---|---|\n| 1 | 2 |")).toBe(
        '<table class="table"><thead><tr><th>a</th><th>b</th></tr></thead>' +
          "<tbody><tr><td>1</td><td>2</td></tr></tbody></table>"
      );
    });

    it("keeps a blockquote", () => {
      expect(render("> quoted")).toBe("<blockquote>quoted</blockquote>");
    });

    it("keeps bold/italic emphasis", () => {
      expect(render("**b** and *i*")).toBe("<p><strong>b</strong> and <em>i</em></p>");
    });

    it("keeps a fenced code block", () => {
      expect(render("```\nx = 1\n```")).toBe("<pre><code>x = 1</code></pre>");
    });
  });

  describe("unsafe content never reaches the DOM", () => {
    it("renders a safe external link with its href and text", () => {
      const out = render("[docs](https://example.com/a)");
      expect(out).toContain('href="https://example.com/a"');
      expect(out).toContain(">docs</a>");
    });

    it("strips a javascript: link to plain text", () => {
      const out = render("[x](javascript:alert(1))");
      expect(out).not.toContain("<a");
      expect(out).not.toContain("javascript:");
    });

    it("never emits a live <script> element from raw HTML in the markdown", () => {
      // markdown.js escapes raw HTML to inert text, so the string "alert(1)"
      // legitimately survives as escaped prose; what must never exist is a live
      // <script> node. Assert on the DOM, not the serialised text.
      const bubble = renderInto("A <script>alert(1)</script> B");
      expect(bubble.querySelector("script")).toBeNull();
    });

    it("never emits a live element carrying an onerror handler", () => {
      const bubble = renderInto('<img src=x onerror="alert(1)">');
      expect(bubble.querySelector("img")).toBeNull();
      expect(bubble.querySelector("[onerror]")).toBeNull();
    });
  });
});
