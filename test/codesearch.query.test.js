// SPDX-License-Identifier: Apache-2.0
// codesearch: the query box -> Fess query translation (query.js).
//
// - A qualifier value is escaped for the Lucene classic parser. A value with a reserved
//   character (`path:src/main` - the "/" opens a regex) used to make the whole query invalid,
//   and Fess answered by escaping the WHOLE query, so the filter silently vanished.
// - `path:` is a path prefix when unquoted and without a wildcard, an exact path when quoted.
// - A quoted phrase stays one term; a leading "--" is text, not a negation.

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { loadModule, mountIndexBody } from "./helpers/themes.js";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { mountBody } from "./helpers/dom.js";
import { SEARCH_FIXTURE, SAMPLE_DOCS, makeSearchEnv, installDispatch, settle } from "./helpers/searchFlow.js";

let q;
beforeAll(async () => {
  q = await loadModule("codesearch", "query.js");
});

/** What the search box sends to Fess for `input`. */
const fess = (input) => q.toFessQuery(q.parseQuery(input));

describe("codesearch query.js: qualifiers", () => {
  it.each([
    ["repo:fess", "repository:fess"],
    ["org:codelibs", "organization:codelibs"],
    ["lang:java", "filetype:java"],
    ["-lang:xml", "NOT filetype:xml"],
    ["file:foo.ts", "filename:foo.ts"],
    ["file:*.java", "filename:*.java"],
    ["repo:fess-crawler", "repository:fess-crawler"],
    ["repo:fess -lang:python parse", "repository:fess NOT filetype:python parse"],
    ['repo:"my repo"', 'repository:"my repo"'],
    ["title:fess", "title:fess"],
    ["sort:content_length.desc fess", "sort:content_length.desc fess"],
    ["*:*", "*:*"],
  ])("leaves %s as it was: %s", (input, expected) => {
    expect(fess(input)).toBe(expected);
  });

  it.each([
    // the documented example and its neighbours: a path prefix
    ["path:src/main", "path:src\\/main*"],
    ["path:src/main/java", "path:src\\/main\\/java*"],
    ["path:src/main/", "path:src\\/main\\/*"],
    ["path:Foo.java", "path:Foo.java*"],
    ["-path:src/test", "NOT path:src\\/test*"],
    // a wildcard typed by the user is kept as typed
    ["path:*Suggester.java", "path:*Suggester.java"],
    ["path:src/*/X.java", "path:src\\/*\\/X.java"],
    ["path:src/ma?n", "path:src\\/ma?n"],
    // a quoted value is an exact path
    ['path:"src/main/java/X.java"', 'path:"src/main/java/X.java"'],
    ['path:"a b/c"', 'path:"a b/c"'],
    // a colon in the value
    ["path:a:b", "path:a\\:b*"],
  ])("path: %s -> %s", (input, expected) => {
    expect(fess(input)).toBe(expected);
  });

  it.each([
    ["file:a/b", "filename:a\\/b"],
    ["file:a:b", "filename:a\\:b"],
    ["file:a(b)", "filename:a\\(b\\)"],
    ["file:a[1].txt", "filename:a\\[1\\].txt"],
    ["file:a{b}", "filename:a\\{b\\}"],
    ["file:a^b", "filename:a\\^b"],
    ["file:a~b", "filename:a\\~b"],
    ["file:a!b", "filename:a\\!b"],
    ["file:-x", "filename:\\-x"],
    ["file:+x", "filename:\\+x"],
    ["file:a+b-c", "filename:a+b-c"],
    ["file:a&&b", "filename:a\\&\\&b"],
    ["file:a||b", "filename:a\\|\\|b"],
    ["file:a&b|c", "filename:a&b|c"],
    ["repo:a/b", "repository:a\\/b"],
    ["org:a/b", "organization:a\\/b"],
    ["lang:c++", "filetype:c++"],
    ["site:github.com/org/repo", "site:github.com\\/org\\/repo"],
    ["src/main/java/Foo.java:42", "src\\/main\\/java\\/Foo.java:42"],
  ])("escapes the reserved characters of a value: %s -> %s", (input, expected) => {
    expect(fess(input)).toBe(expected);
  });

  it("escapes a trailing backslash so it cannot swallow what follows", () => {
    expect(fess("file:a\\")).toBe("filename:a\\\\");
  });

  it("keeps a range as one clause, in front of the free text", () => {
    expect(fess("content_length:[1024 TO 10240]")).toBe("content_length:[1024 TO 10240]");
    expect(fess("content_length:{1024 TO 10240}")).toBe("content_length:{1024 TO 10240}");
    expect(fess("fess timestamp:[2020-01-01 TO *]")).toBe("timestamp:[2020-01-01 TO *] fess");
    expect(fess("-content_length:[1 TO 5]")).toBe("NOT content_length:[1 TO 5]");
    expect(q.parseQuery("content_length:[1 TO 5]").terms).toEqual([]);
  });

  it("does not take an unclosed bracket, or brackets without TO, for a range", () => {
    expect(fess("file:[abc")).toBe("filename:\\[abc");
    expect(fess("file:[abc]")).toBe("filename:\\[abc\\]");
    expect(q.parseQuery("file:[abc]").qualifiers[0].range).toBe(false);
  });

  it("turns what it emitted back into the same query when the box is submitted again", () => {
    // After a reload the box holds the Fess form, which is parsed and sent once more.
    for (const input of ["path:src/main", "path:src/*", 'path:"a b/c"', "file:a:b.txt", "repo:a/b",
      "content_length:[1 TO 5]", "file:a&&b", "file:a\\"]) {
      const once = fess(input);
      expect(fess(once)).toBe(once);
    }
  });

  it("reads a qualifier's value as it is typed", () => {
    expect(q.parseQuery('path:"src/main"').qualifiers).toEqual([
      { key: "path", value: "src/main", negate: false, quoted: true, range: false },
    ]);
    expect(q.parseQuery("-lang:xml").qualifiers).toEqual([
      { key: "lang", value: "xml", negate: true, quoted: false, range: false },
    ]);
  });
});

describe("codesearch query.js: the box and phrases", () => {
  it.each([
    ['"new HashMap"', '"new HashMap"'],
    ['"foo bar"~3', '"foo bar"~3'],
    ['"case x: break"', '"case x: break"'],
    ['"import string"', '"import string"'],
    ['"HashMap"', '"HashMap"'],
    ['-"foo bar"', 'NOT "foo bar"'],
    ['repo:fess "new HashMap"', 'repository:fess "new HashMap"'],
    ['lang:java "case x: break" foo', 'filetype:java "case x: break" foo'],
    ['"a b"~2 "c d"', '"a b"~2 "c d"'],
  ])("keeps the phrase %s as one term: %s", (input, expected) => {
    expect(fess(input)).toBe(expected);
  });

  it("does not take a phrase holding a colon for a qualifier", () => {
    const parsed = q.parseQuery('"case x: break"');
    expect(parsed.qualifiers).toEqual([]);
    expect(parsed.terms).toEqual(['"case x: break"']);
  });

  it("keeps the ~N proximity attached to its phrase", () => {
    expect(q.parseQuery('"foo bar"~3').terms).toEqual(['"foo bar"~3']);
  });

  it.each([
    ["--verbose", '"--verbose"'],
    ["--verbose --quiet", '"--verbose" "--quiet"'],
    ["--lang:xml", '"--lang:xml"'],
    ["foo --bar", 'foo "--bar"'],
  ])("reads a leading -- as text: %s -> %s", (input, expected) => {
    expect(fess(input)).toBe(expected);
  });

  it("does not take a leading -- for a qualifier or a negation", () => {
    const parsed = q.parseQuery("--lang:xml");
    expect(parsed.qualifiers).toEqual([]);
    expect(parsed.terms).toEqual(["--lang:xml"]);
  });

  it.each([
    ["-Xmx512m", "NOT Xmx512m"],
    ["-foo bar", "NOT foo bar"],
    ["foo -bar", "foo NOT bar"],
  ])("a single leading - is still a negation: %s -> %s", (input, expected) => {
    expect(fess(input)).toBe(expected);
  });

  it.each([
    ["a OR b", "a OR b"],
    ["a or b", "a OR b"],
    ["parse tree", "parse tree"],
    ["repo:fess -lang:python parse", "repository:fess NOT filetype:python parse"],
  ])("leaves %s as it was: %s", (input, expected) => {
    expect(fess(input)).toBe(expected);
  });

  // Fess retries an unparsable query escaped, but its reserved characters do not include the
  // double quote: a dangling one would fail twice. The box has always dropped it.
  it("drops an unbalanced quote, as before, so the query stays valid", () => {
    expect(fess('"x')).toBe("x");
    expect(fess('"foo bar')).toBe("foo bar");
    expect(fess('repo:fess "foo')).toBe("repository:fess foo");
    expect(fess('path:"a b')).toBe('path:"a b"');
  });

  it("drops an empty phrase", () => {
    expect(fess('""')).toBe("");
    expect(fess('foo ""')).toBe("foo");
  });
});

describe("codesearch query.js: the search box and its helpers", () => {
  afterEach(() => vi.useRealTimers());

  async function boot() {
    const flow = await loadSearchFlow("codesearch", {});
    flow.get.mockImplementation(async (path) => (path === "/suggest-words" ? { suggest_words: [{ text: "foobar" }] } : {}));
    mountIndexBody("codesearch");
    flow.mod.attach();
    return { ...flow, input: document.getElementById("query-input"), dd: document.getElementById("header-suggest-dropdown") };
  }

  async function type(input, value) {
    input.value = value;
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(150);
  }

  it("sends the type-ahead the words of a phrase without its quotes", async () => {
    vi.useFakeTimers();
    const { input, get } = await boot();
    await type(input, '"new HashMap" foo');
    expect(get.mock.calls.find((c) => c[0] === "/suggest-words")[1]).toMatchObject({ q: "new HashMap foo" });
  });

  it("keeps a quoted or range qualifier as typed when a suggestion replaces the terms", async () => {
    vi.useFakeTimers();
    const { input, dd } = await boot();
    await type(input, 'foo path:"src/main" content_length:[1 TO 5] -lang:xml');
    dd.querySelector('[role="option"]').dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(input.value).toBe('foobar path:"src/main" content_length:[1 TO 5] -lang:xml');
  });

  it("submits a phrase as the phrase", async () => {
    const { input, navigate } = await boot();
    input.value = '"new HashMap" lang:java';
    document.getElementById("search-bar").dispatchEvent(new Event("submit", { cancelable: true }));
    const url = new URLSearchParams(navigate.mock.calls[0][0].split("?")[1]);
    expect(url.get("q")).toBe('filetype:java "new HashMap"');
  });

  it("hands the Ask panel the clauses Fess is sent", async () => {
    const { mod } = await boot();
    document.getElementById("query-input").value = 'repo:fess path:src/main lang:java file:"my file.txt" -lang:xml';
    expect(mod.getSearchContext().extra_queries).toEqual([
      "repository:fess", "path:src\\/main*", "filetype:java", 'filename:"my file.txt"',
    ]);
  });
});

describe("codesearch query.js: facet qualifiers", () => {
  const values = ["fess", "fess-crawler", "Foo Bar.java", "my file (1).txt", "a:b.txt", "c++.md", "x.min.js"];

  it.each(values)("adds and removes %s, and submits it as it is", (value) => {
    const added = q.addQualifier("parse", "filename", value);
    const token = value.includes(" ") ? `filename:"${value}"` : `filename:${value}`;
    expect(added).toBe(`parse ${token}`);
    expect(q.removeQualifier(added, "filename", value)).toBe("parse");
    // the qualifier a facet click writes into the box reaches Fess as a single, valid clause
    const sent = fess(added);
    expect(sent.startsWith("filename:")).toBe(true);
    expect(sent.endsWith(" parse")).toBe(true);
  });

  it("writes a facet value the way it always did", () => {
    expect(q.addQualifier("", "repository", "fess")).toBe("repository:fess");
    expect(q.addQualifier("foo", "filetype", "java")).toBe("foo filetype:java");
    expect(q.addQualifier("", "filename", "my file.txt")).toBe('filename:"my file.txt"');
    expect(q.addQualifier("repository:fess", "repository", "fess")).toBe("repository:fess");
    expect(q.addQualifier("-repository:fess x", "repository", "fess")).toBe("x repository:fess");
    expect(q.removeQualifier('foo filename:"my file.txt" bar', "filename", "my file.txt")).toBe("foo bar");
    expect(q.removeQualifier("-filetype:xml foo", "filetype", "xml")).toBe("foo");
  });

  it("sends a facet value with a reserved character escaped", () => {
    expect(fess(q.addQualifier("", "filename", "a:b.txt"))).toBe("filename:a\\:b.txt");
    expect(fess(q.addQualifier("", "filename", "index[1].html"))).toBe("filename:index\\[1\\].html");
    expect(fess(q.addQualifier("", "filename", "my file (1).txt"))).toBe('filename:"my file (1).txt"');
    expect(fess(q.addQualifier("", "repository", "fess"))).toBe("repository:fess");
  });

  it("removes a quoted value that holds no space too", () => {
    expect(q.removeQualifier('path:"src/main/X.java" foo', "path", "src/main/X.java")).toBe("foo");
    expect(q.removeQualifier("path:src/main foo", "path", "src/main")).toBe("foo");
  });

  it("removes the qualifier a chip names, whatever the box holds", () => {
    // a chip removes the clause as the box spells it: typed, or the escaped form after a reload
    const typed = "foo path:src/main";
    const reloaded = fess(typed);
    expect(reloaded).toBe("path:src\\/main* foo");
    const [chip] = q.parseQuery(reloaded).qualifiers;
    expect(q.removeQualifier(reloaded, chip.key, chip.value)).toBe("foo");
  });
});

describe("codesearch query.js: facet and chip clicks send what a submit sends", () => {
  /** Run a search with `box` in the search box and the given facet fields on the page. */
  async function boot(box, facetField = []) {
    window.scrollTo = () => {};
    const flow = await loadSearchFlow("codesearch", {});
    installDispatch(flow.get, { search: makeSearchEnv(SAMPLE_DOCS, { facet_field: facetField }) });
    mountBody(SEARCH_FIXTURE);
    flow.mod._state.q = "foo";
    document.getElementById("query-input").value = box;
    await flow.mod.runSearch();
    await settle();
    return flow;
  }
  const sentQuery = (navigate) => new URLSearchParams(navigate.mock.calls.at(-1)[0].split("?")[1]).get("q");
  const facet = (name, ...values) => [{ name, result: values.map((value) => ({ value, count: 1 })) }];

  it("translates the shorthand typed in the box when a facet is ticked", async () => {
    // "repo:" and "path:src/main" are the box's own syntax: Fess knows neither
    const { navigate } = await boot("repo:fess path:src/main", facet("filetype", "java"));
    document.querySelector("#facet-rail .facet-check").click();
    expect(sentQuery(navigate)).toBe("repository:fess path:src\\/main* filetype:java");
    // the box itself keeps what the user typed, plus the facet
    expect(document.getElementById("query-input").value).toBe("repo:fess path:src/main filetype:java");
  });

  it("sends a facet value with a reserved character escaped", async () => {
    const { navigate } = await boot("", facet("filename", "a:b.txt"));
    document.querySelector("#facet-rail .facet-check").click();
    expect(sentQuery(navigate)).toBe("filename:a\\:b.txt");
  });

  it("sends a facet value with spaces quoted", async () => {
    const { navigate } = await boot("foo", facet("filename", "my file.txt"));
    document.querySelector("#facet-rail .facet-check").click();
    expect(sentQuery(navigate)).toBe('filename:"my file.txt" foo');
  });

  it("sends what is left when a facet is unticked", async () => {
    const { navigate } = await boot("repository:fess filetype:java", facet("filetype", "java"));
    const box = document.querySelector("#facet-rail .facet-check");
    expect(box.checked).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    expect(sentQuery(navigate)).toBe("repository:fess");
  });

  it("removes a chip and sends what is left, translated", async () => {
    const { navigate } = await boot('foo repo:fess path:"src/main/X.java"');
    const chips = [...document.querySelectorAll("#active-chips .active-chip")];
    expect(chips.map((c) => c.textContent)).toEqual(["facet.repository: fess ×", "path: src/main/X.java ×"]);
    chips[1].querySelector(".chip-remove").click();
    expect(sentQuery(navigate)).toBe("repository:fess foo");
  });

  it("removes the other chip too", async () => {
    const { navigate } = await boot('foo repo:fess path:"src/main/X.java"');
    document.querySelectorAll("#active-chips .chip-remove")[0].click();
    expect(sentQuery(navigate)).toBe('path:"src/main/X.java" foo');
  });
});
