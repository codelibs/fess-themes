import { test } from "node:test";
import assert from "node:assert/strict";
import { contentTypeKey, contentTypeLabelKey, deriveBreadcrumb, contentTypeIcon }
  from "../themes/docsearch/assets/docsearch.js";

test("contentTypeKey by mimetype", () => {
  assert.equal(contentTypeKey({ mimetype: "application/pdf" }), "pdf");
  assert.equal(contentTypeKey({ mimetype: "text/html", url: "https://x/docs/a" }), "page");
  assert.equal(contentTypeKey({ mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "word");
});
test("contentTypeKey fallback filetype then url ext then default", () => {
  assert.equal(contentTypeKey({ filetype: "pdf" }), "pdf");
  assert.equal(contentTypeKey({ url: "https://x/readme.md" }), "text");
  assert.equal(contentTypeKey({ url: "https://x/app.py" }), "code");
  assert.equal(contentTypeKey({}), "page");                 // tolerate missing mimetype/filetype
});
test("contentTypeLabelKey", () => {
  assert.equal(contentTypeLabelKey({ mimetype: "application/pdf" }), "content_type.pdf");
});
test("contentTypeIcon static svg, no script", () => {
  const svg = contentTypeIcon({ mimetype: "application/pdf" });
  assert.match(svg, /^<svg /); assert.doesNotMatch(svg, /<script/i);
});
test("deriveBreadcrumb from url path, cap 4", () => {
  assert.deepEqual(
    deriveBreadcrumb({ url: "https://h/docs/admin/opensearch/config.html" }),
    ["docs", "admin", "opensearch", "config.html"]);
  const long = deriveBreadcrumb({ url: "https://h/a/b/c/d/e/f/g.html" });
  assert.ok(long.length <= 4); assert.equal(long.at(-1), "g.html");
});
test("deriveBreadcrumb missing url falls back to site", () => {
  assert.deepEqual(deriveBreadcrumb({ site: "example.com/docs" }), ["docs"]);
  assert.deepEqual(deriveBreadcrumb({}), []);
});
