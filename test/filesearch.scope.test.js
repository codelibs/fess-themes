// SPDX-License-Identifier: Apache-2.0
// filesearch: scope.js — the folder scope <-> ex_q clause round trip, the escaping the
// clause needs inside the Fess query string, and the "browse without a keyword" helper.

import { describe, it, expect } from "vitest";
import {
  escapeTerm, unescapeTerm, scopeClause, parseScopeClause, scopeKey, sameScope,
  browseAllQuery, hasCondition, withBrowseAll, BROWSE_ALL_CLAUSE,
} from "../themes/filesearch/assets/scope.js";

describe("escapeTerm / unescapeTerm", () => {
  it("backslash-escapes the characters the query parser treats as syntax", () => {
    expect(escapeTerm("smb://srv/share/dir/")).toBe("smb\\:\\/\\/srv\\/share\\/dir\\/");
    expect(escapeTerm("file:////srv/share/")).toBe("file\\:\\/\\/\\/\\/srv\\/share\\/");
    expect(escapeTerm("ex.com:8080")).toBe("ex.com\\:8080");
  });

  it("escapes whitespace, brackets, wildcards and boolean operators literally", () => {
    expect(escapeTerm("a b")).toBe("a\\ b");
    expect(escapeTerm('q"(x)[y]{z}')).toBe('q\\"\\(x\\)\\[y\\]\\{z\\}');
    expect(escapeTerm("a*b?c")).toBe("a\\*b\\?c");
    expect(escapeTerm("a&&b||c!d~e^f+g-h")).toBe("a\\&\\&b\\|\\|c\\!d\\~e\\^f\\+g\\-h");
    expect(escapeTerm("back\\slash")).toBe("back\\\\slash");
  });

  it("leaves percent-encoding and ordinary characters alone", () => {
    expect(escapeTerm("dir%20name")).toBe("dir%20name");
    expect(escapeTerm("日本語")).toBe("日本語");
    expect(escapeTerm("a_b.c")).toBe("a_b.c");
  });

  it("round-trips any string", () => {
    for (const s of ["smb://srv/s h/a*b/", "x\\y", "a:b", "", "((", "100% real"]) {
      expect(unescapeTerm(escapeTerm(s))).toBe(s);
    }
  });
});

describe("scopeClause / parseScopeClause", () => {
  it("builds a url prefix clause with a trailing wildcard", () => {
    expect(scopeClause({ type: "url", prefix: "smb://srv/share/dir/" }))
      .toBe("url:smb\\:\\/\\/srv\\/share\\/dir\\/*");
  });

  it("builds a host clause for a source root", () => {
    expect(scopeClause({ type: "host", host: "srv" })).toBe("host:srv");
    expect(scopeClause({ type: "host", host: "ex.com:8080" })).toBe("host:ex.com\\:8080");
  });

  it("returns an empty string for no scope", () => {
    expect(scopeClause(null)).toBe("");
    expect(scopeClause({ type: "url", prefix: "" })).toBe("");
    expect(scopeClause({ type: "host", host: "" })).toBe("");
  });

  it("parses what scopeClause wrote", () => {
    const scopes = [
      { type: "url", prefix: "file:////srv/share/dir with space/" },
      { type: "url", prefix: "https://ex.com/a/b/" },
      { type: "url", prefix: "s3://bucket/key/" },
      { type: "host", host: "localhost" },
      { type: "host", host: "ex.com:8080" },
    ];
    for (const s of scopes) expect(parseScopeClause(scopeClause(s))).toEqual(s);
  });

  it("rejects clauses that are not a folder scope", () => {
    for (const c of ["", "title:foo", "filetype:pdf", "url:*", "url:a*b*", "url:abc", "host:", "label:x",
      "url:smb\\:\\/\\/srv\\*", "(url:a* OR url:b*)"]) {
      expect(parseScopeClause(c), c).toBeNull();
    }
  });

  it("accepts a wildcard that is not preceded by an escaping backslash pair", () => {
    // two backslashes = an escaped backslash, then a real wildcard
    expect(parseScopeClause("url:a\\\\*")).toEqual({ type: "url", prefix: "a\\" });
  });

  it("ignores non-string input", () => {
    expect(parseScopeClause(undefined)).toBeNull();
    expect(parseScopeClause(42)).toBeNull();
  });
});

describe("scopeKey / sameScope", () => {
  it("keys a scope by kind and value", () => {
    expect(scopeKey({ type: "host", host: "srv" })).toBe("host:srv");
    expect(scopeKey({ type: "url", prefix: "smb://srv/a/" })).toBe("url:smb://srv/a/");
    expect(scopeKey(null)).toBe("");
  });

  it("compares scopes by key", () => {
    expect(sameScope({ type: "host", host: "a" }, { type: "host", host: "a" })).toBe(true);
    expect(sameScope({ type: "host", host: "a" }, { type: "url", prefix: "a" })).toBe(false);
    expect(sameScope(null, null)).toBe(true);
    expect(sameScope(null, { type: "host", host: "a" })).toBe(false);
  });
});

describe("browse without a keyword", () => {
  it("names the clause that matches every indexed document", () => {
    expect(BROWSE_ALL_CLAUSE).toBe("url:*");
  });

  it("browseAllQuery has an empty keyword and the match-all clause", () => {
    expect(browseAllQuery()).toEqual({ q: "", ex_q: ["url:*"] });
  });

  it("browseAllQuery returns a fresh object each call", () => {
    const a = browseAllQuery();
    a.ex_q.push("x");
    expect(browseAllQuery().ex_q).toEqual(["url:*"]);
  });

  it("hasCondition is true for a keyword, an ex_q clause, a field or an advanced condition", () => {
    expect(hasCondition({ q: "foo" })).toBe(true);
    expect(hasCondition({ q: "", ex_q: ["filetype:pdf"] })).toBe(true);
    expect(hasCondition({ q: "", "fields.label": ["a"] })).toBe(true);
    expect(hasCondition({ q: "", "as.q": ["a"] })).toBe(true);
    expect(hasCondition({ q: "  " })).toBe(false);
    expect(hasCondition({ q: "", ex_q: [], lang: ["ja"], sort: "filename.asc" })).toBe(false);
    expect(hasCondition({})).toBe(false);
  });

  it("withBrowseAll adds the match-all clause only when the request has no condition", () => {
    expect(withBrowseAll({ q: "", num: 1 })).toEqual({ q: "", num: 1, ex_q: ["url:*"] });
    const withKeyword = { q: "foo", num: 1 };
    expect(withBrowseAll(withKeyword)).toBe(withKeyword);
    const withEx = { q: "", ex_q: ["host:srv"] };
    expect(withBrowseAll(withEx)).toBe(withEx);
  });

  it("withBrowseAll does not mutate its argument", () => {
    const p = { q: "", num: 1 };
    withBrowseAll(p);
    expect(p).toEqual({ q: "", num: 1 });
  });
});
