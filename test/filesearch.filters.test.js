// SPDX-License-Identifier: Apache-2.0
// filesearch: filters.js — file type / modified / size filters as ex_q clauses, the
// composition of the whole ex_q list (scope first), its reading back from the URL, and the
// rule for which facet rows to draw.

import { describe, it, expect } from "vitest";
import {
  DATE_PRESETS, SIZE_PRESETS, filetypeClause, parseFiletypeClause, presetFor,
  composeExQ, classifyExQ, facetQueryClauses, visibleRows,
} from "../themes/filesearch/assets/filters.js";

describe("presets", () => {
  it("date presets are cumulative windows on last_modified", () => {
    expect(DATE_PRESETS.map(p => p.id)).toEqual(["1d", "1w", "1m", "1y"]);
    expect(DATE_PRESETS[0].clause).toBe("last_modified:[now/d-1d TO *]");
    expect(DATE_PRESETS.every(p => p.clause.startsWith("last_modified:[now/d-") && p.clause.endsWith(" TO *]"))).toBe(true);
  });
  it("size presets are disjoint byte ranges on content_length", () => {
    expect(SIZE_PRESETS.map(p => p.id)).toEqual(["xs", "s", "m", "l", "xl"]);
    expect(SIZE_PRESETS[0].clause).toBe("content_length:[0 TO 9999]");
    expect(SIZE_PRESETS[4].clause).toBe("content_length:[10000000 TO *]");
    const ranges = SIZE_PRESETS.map(p => /\[(\d+) TO (\d+|\*)\]/.exec(p.clause));
    for (let i = 1; i < ranges.length; i++) expect(Number(ranges[i][1])).toBe(Number(ranges[i - 1][2]) + 1);
  });
  it("every preset has an i18n key", () => {
    for (const p of [...DATE_PRESETS, ...SIZE_PRESETS]) expect(p.labelKey).toMatch(/^fs\.(date|size)_/);
  });
  it("presetFor finds a preset by its clause", () => {
    expect(presetFor(DATE_PRESETS, "last_modified:[now/d-7d TO *]").id).toBe("1w");
    expect(presetFor(DATE_PRESETS, "nope")).toBeNull();
  });
  it("facetQueryClauses lists every preset clause, to be counted in one request", () => {
    expect(facetQueryClauses()).toHaveLength(DATE_PRESETS.length + SIZE_PRESETS.length);
  });
});

describe("filetype clause", () => {
  it("is one term for one type and an OR group for several", () => {
    expect(filetypeClause(["pdf"])).toBe("filetype:pdf");
    expect(filetypeClause(["pdf", "word"])).toBe("(filetype:pdf OR filetype:word)");
    expect(filetypeClause([])).toBe("");
  });
  it("drops anything that is not a plain type name, so a value can never inject query syntax", () => {
    expect(filetypeClause(["pdf", 'x" OR title:y', "a b", ""])).toBe("filetype:pdf");
    expect(filetypeClause(["a)"])).toBe("");
  });
  it("is read back to the same values", () => {
    expect(parseFiletypeClause("filetype:pdf")).toEqual(["pdf"]);
    expect(parseFiletypeClause("(filetype:pdf OR filetype:word)")).toEqual(["pdf", "word"]);
    expect(parseFiletypeClause("filetype:")).toBeNull();
    expect(parseFiletypeClause("filetype:a b")).toBeNull();
    expect(parseFiletypeClause("(filetype:pdf OR title:x)")).toBeNull();
    expect(parseFiletypeClause("title:pdf")).toBeNull();
  });
});

describe("composeExQ", () => {
  const scope = { type: "url", prefix: "smb://srv/a/" };
  it("puts the scope first, then facet selections, facet queries and the rest", () => {
    expect(composeExQ({
      scope, facets: { label: ["x", "y"], filetype: ["pdf"] }, facetQueries: ["content_length:[0 TO 9999]"], exQ: ["title:z"],
    })).toEqual([
      "url:smb\\:\\/\\/srv\\/a\\/*", "label:x", "label:y", "filetype:pdf", "content_length:[0 TO 9999]", "title:z",
    ]);
  });
  it("ORs several file types into one clause", () => {
    expect(composeExQ({ facets: { filetype: ["pdf", "word"] } })).toEqual(["(filetype:pdf OR filetype:word)"]);
  });
  it("can leave the scope out (the tree asks about every folder under the same filters)", () => {
    expect(composeExQ({ scope, facets: { label: ["x"] } }, { withScope: false })).toEqual(["label:x"]);
  });
  it("is empty for an empty state", () => {
    expect(composeExQ({})).toEqual([]);
    expect(composeExQ({ facets: { label: [] } })).toEqual([]);
  });
});

describe("classifyExQ", () => {
  it("sorts clauses into the stores the UI reads", () => {
    const out = classifyExQ([
      "url:smb\\:\\/\\/srv\\/a\\/*", "label:x", "filetype:pdf", "(filetype:html OR filetype:word)",
      "last_modified:[now/d-7d TO *]", "content_length:[0 TO 9999]", "title:z",
    ]);
    expect(out.scope).toEqual({ type: "url", prefix: "smb://srv/a/" });
    expect(out.facets).toEqual({ label: ["x"], filetype: ["pdf", "html", "word"] });
    expect(out.facetQueries).toEqual(["last_modified:[now/d-7d TO *]", "content_length:[0 TO 9999]"]);
    expect(out.exQ).toEqual(["title:z"]);
  });
  it("keeps only the first scope; a second scope-looking clause stays an ordinary filter", () => {
    const out = classifyExQ(["host:a", "host:b"]);
    expect(out.scope).toEqual({ type: "host", host: "a" });
    expect(out.exQ).toEqual(["host:b"]);
  });
  it("ignores blanks and duplicates", () => {
    const out = classifyExQ(["", "label:x", "label:x", "label:"]);
    expect(out.facets).toEqual({ label: ["x"] });
    expect(out.exQ).toEqual(["label:"]);
  });
  it("round-trips through composeExQ", () => {
    const state = {
      scope: { type: "host", host: "ex.com:8080" },
      facets: { label: ["a"], filetype: ["pdf", "word"] },
      facetQueries: ["content_length:[10000 TO 99999]"],
      exQ: ["title:z"],
    };
    expect(classifyExQ(composeExQ(state))).toEqual(state);
  });
  it("returns empty stores for nothing", () => {
    expect(classifyExQ([])).toEqual({ scope: null, facets: {}, facetQueries: [], exQ: [] });
    expect(classifyExQ(undefined)).toEqual({ scope: null, facets: {}, facetQueries: [], exQ: [] });
  });
});

describe("visibleRows", () => {
  const rows = [{ id: "a", clause: "c:a" }, { id: "b", clause: "c:b" }, { id: "c", clause: "c:c" }];
  it("hides zero-count rows when the response counted every row, but never an active one", () => {
    const counts = new Map([["c:a", 3], ["c:b", 0], ["c:c", 0]]);
    expect(visibleRows(rows, counts, new Set(["c:c"])).map(r => [r.id, r.count, r.active])).toEqual([
      ["a", 3, false], ["c", 0, true],
    ]);
  });
  it("keeps every row, count-free, when the response carried no counts for the group", () => {
    expect(visibleRows(rows, new Map(), new Set()).map(r => [r.id, r.count])).toEqual([["a", null], ["b", null], ["c", null]]);
    expect(visibleRows(rows, undefined, new Set()).map(r => r.count)).toEqual([null, null, null]);
  });
  it("treats a partly counted group as uncounted: a missing count is not a zero", () => {
    const counts = new Map([["c:a", 3]]);
    expect(visibleRows(rows, counts, new Set()).map(r => [r.id, r.count])).toEqual([["a", null], ["b", null], ["c", null]]);
  });
  it("marks active rows", () => {
    expect(visibleRows(rows, new Map(), new Set(["c:b"])).filter(r => r.active).map(r => r.id)).toEqual(["b"]);
  });
});
