// SPDX-License-Identifier: Apache-2.0
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerHtml, titleHtml, hasCache, cacheHref, bestBets, plainTitle }
  from "../themes/helpdesk/assets/helpdesk.js";

test("answerHtml passes content_description through untouched", () => {
  // content_description arrives ALREADY escaped by ViewHelper.escapeHighlight()
  // with only <strong> restored. Re-escaping it (as the baseline theme's
  // search.js does via renderHighlightedSnippet) turns &amp; into &amp;amp;
  // and shows literal entities on screen.
  const raw = "Reset it from <strong>Settings</strong>.";
  assert.equal(answerHtml({ content_description: raw }), raw);
});

test("answerHtml does NOT double-escape entities", () => {
  // The server already sent these as entities via LaFunctions.escape(): '"' -> &#034;
  // (not &quot;) and "'" -> &#039;. A pricing FAQ is the worst case.
  const raw = 'Plan A &amp; Plan B cost &#034;$5&#034; &lt;=&gt; <strong>upgrade</strong> now. Don&#039;t miss it.';
  assert.equal(answerHtml({ content_description: raw }), raw);
  assert.doesNotMatch(answerHtml({ content_description: raw }), /&amp;amp;/);
});

test("answerHtml keeps a hostile payload inert (server escaped it already)", () => {
  // What the server actually sends for a page containing <img src=x onerror=...>
  const raw = "&lt;img src=x onerror=alert(1)&gt;";
  const html = answerHtml({ content_description: raw });
  assert.equal(html, raw);
  assert.doesNotMatch(html, /<img/);
});

test("answerHtml returns '' when there is no description", () => {
  // getContentDescription() returns StringUtil.EMPTY only when every highlighted
  // field (hl_content, digest) is blank — so there is no digest to fall back to.
  assert.equal(answerHtml({ content_description: "" }), "");
  assert.equal(answerHtml({}), "");
  assert.equal(answerHtml(null), "");
});

test("titleHtml passes content_title through untouched", () => {
  // content_title is escaped the exact same way as content_description:
  // DefaultSearcher.java:245 (getContentTitle) mirrors :246 (getContentDescription)
  // — LaFunctions.h() over the whole string, then literal <strong> spliced back
  // in around matches. Re-escaping client-side double-escapes it.
  const raw = "Reset it from <strong>Settings</strong>.";
  assert.equal(titleHtml({ content_title: raw }), raw);
});

test("titleHtml does NOT double-escape entities (apostrophes are the common case)", () => {
  // FAQ titles are English questions — "What's", "Don't" — so &#039; is the
  // most common real-world trigger for this bug, not just &amp;/&#034;.
  const raw = "What&#039;s included in Plan A &amp; Plan B &#034;bundle&#034;? <strong>FAQ</strong>";
  assert.equal(titleHtml({ content_title: raw }), raw);
  assert.doesNotMatch(titleHtml({ content_title: raw }), /&amp;amp;/);
});

test("titleHtml keeps <strong> highlight markup intact", () => {
  const raw = "How do I <strong>reset</strong> my password?";
  assert.equal(titleHtml({ content_title: raw }), raw);
});

test("titleHtml returns '' when there is no title", () => {
  assert.equal(titleHtml({ content_title: "" }), "");
  assert.equal(titleHtml({}), "");
  assert.equal(titleHtml(null), "");
});

test("hasCache handles the string 'true' — has_cache is NOT a boolean", () => {
  assert.equal(hasCache({ has_cache: "true" }), true);
  assert.equal(hasCache({ has_cache: true }), true);
  assert.equal(hasCache({ has_cache: "false" }), false);
  assert.equal(hasCache({}), false);
  assert.equal(hasCache(null), false);
});

test("cacheHref forwards hq — NOT queryId. /api/v2/cache takes hq only", () => {
  // CacheHandler.java:155 reads getParameterValues("hq") and nothing else.
  // Dropping hq loses highlighting on the cached page — a regression vs docuforge.
  assert.equal(cacheHref({ doc_id: "abc", has_cache: "true" }, "&hq=pass&hq=word", "ignored"),
    "/cache/?docId=abc&hq=pass&hq=word");
});

test("cacheHref falls back to the raw query when highlightParams is absent", () => {
  assert.equal(cacheHref({ doc_id: "abc", has_cache: "true" }, null, "pass word"),
    "/cache/?docId=abc&hq=pass%20word");
});

test("cacheHref url-encodes the docId", () => {
  assert.equal(cacheHref({ doc_id: "a b/c", has_cache: "true" }, null, "q"),
    "/cache/?docId=a%20b%2Fc&hq=q");
});

test("cacheHref returns null without a cache or a docId", () => {
  assert.equal(cacheHref({ doc_id: "abc", has_cache: "false" }, null, "q"), null);
  assert.equal(cacheHref({ has_cache: "true" }, null, "q"), null);
});

test("bestBets extracts related_contents and drops blanks", () => {
  assert.deepEqual(bestBets({ related_contents: ["<p>a</p>", "", "  ", "<p>b</p>"] }),
    ["<p>a</p>", "<p>b</p>"]);
});

test("bestBets returns [] when absent or empty", () => {
  assert.deepEqual(bestBets({ related_contents: [] }), []);
  assert.deepEqual(bestBets({}), []);
  assert.deepEqual(bestBets(null), []);
});

test("plainTitle strips <strong>/<em> highlight markup from content_title", () => {
  assert.equal(
    plainTitle({ content_title: "How do I <strong>reset</strong> my password?" }),
    "How do I reset my password?"
  );
});

test("plainTitle decodes the entities LaFunctions.escape() emits in content_title", () => {
  // The exact demo regression: visible title and aria-label must carry the same
  // characters — apostrophe, ampersand, and both quote marks.
  const raw = 'What&#039;s included in Plan A &amp; Plan B &#034;bundle&#034;? <strong>FAQ</strong>';
  assert.equal(
    plainTitle({ content_title: raw }),
    `What's included in Plan A & Plan B "bundle"? FAQ`
  );
});

test("plainTitle decodes &amp; LAST so a literal &amp;#039; is not double-decoded", () => {
  // If &amp; were decoded FIRST, "&amp;#039;" would become "&#039;" and then a
  // subsequent &#039; pass would wrongly turn it into "'". Decoding &amp; last
  // means the &#039; pass has already run, so the residual entity survives.
  assert.equal(plainTitle({ content_title: "&amp;#039;" }), "&#039;");
});

test("plainTitle does NOT decode the title/url fallback — those are raw, unescaped fields", () => {
  // content_title absent: falls back to d.title, which the server does NOT
  // escape. Decoding here (or routing it through innerHTML) would be unsafe.
  assert.equal(plainTitle({ title: "Q&amp;A literally in the title field" }),
    "Q&amp;A literally in the title field");
  assert.equal(plainTitle({ url: "https://example.com/a&amp;b" }),
    "https://example.com/a&amp;b");
});

test("plainTitle returns '' for a missing document, title, and url", () => {
  assert.equal(plainTitle(null), "");
  assert.equal(plainTitle({}), "");
});
