// SPDX-License-Identifier: Apache-2.0
// filesearch: sorting.js — column headers <-> the `sort` parameter, the default order, and
// what to do when the server refuses a sort it was never told it may use.

import { describe, it, expect, beforeEach } from "vitest";
import {
  SORT_FIELDS, sortParam, parseSort, effectiveSort, describeSort, nextSort,
  sortFallback, markUnsupported, isSortSupported, resetUnsupported, needsServerSetting, firstSort,
} from "../themes/filesearch/assets/sorting.js";

beforeEach(() => resetUnsupported());

describe("column -> sort field", () => {
  it("maps the columns the way the list shows them", () => {
    expect(SORT_FIELDS).toEqual({
      name: "filename", modified: "last_modified", size: "content_length", type: "filetype", location: "url", relevance: "score",
    });
  });

  it("builds field.direction", () => {
    expect(sortParam("name", "asc")).toBe("filename.asc");
    expect(sortParam("modified", "desc")).toBe("last_modified.desc");
    expect(sortParam("size", "asc")).toBe("content_length.asc");
    expect(sortParam("type", "asc")).toBe("filetype.asc");
    expect(sortParam("location", "desc")).toBe("url.desc");
  });

  it("returns an empty string for relevance (the server default) and for an unknown column", () => {
    expect(sortParam("relevance", "desc")).toBe("");
    expect(sortParam("nope", "asc")).toBe("");
  });
});

describe("parseSort", () => {
  it("reads a sort parameter back into column and direction", () => {
    expect(parseSort("filename.asc")).toEqual({ column: "name", dir: "asc" });
    expect(parseSort("last_modified.desc")).toEqual({ column: "modified", dir: "desc" });
    expect(parseSort("score.desc")).toEqual({ column: "relevance", dir: "desc" });
  });
  it("ignores empty, malformed and unknown values", () => {
    for (const v of ["", undefined, "filename", "filename.up", "bogus.asc", "a.b.c"]) expect(parseSort(v), String(v)).toBeNull();
  });
  it("only reads the first key of a multi-key sort", () => {
    expect(parseSort("filetype.asc,filename.asc")).toEqual({ column: "type", dir: "asc" });
  });
});

describe("default order", () => {
  it("is relevance when there is a keyword and name ascending when browsing", () => {
    expect(effectiveSort("", true)).toBe("");
    expect(effectiveSort("", false)).toBe("filename.asc");
  });
  it("never overrides an explicit sort", () => {
    expect(effectiveSort("size.desc", false)).toBe("size.desc");
    expect(effectiveSort("last_modified.desc", true)).toBe("last_modified.desc");
  });
  it("describeSort reports which column is active and whether it is only the default", () => {
    expect(describeSort("", true)).toEqual({ column: "relevance", dir: "desc", isDefault: true });
    expect(describeSort("", false)).toEqual({ column: "name", dir: "asc", isDefault: true });
    expect(describeSort("last_modified.desc", true)).toEqual({ column: "modified", dir: "desc", isDefault: false });
  });
});

describe("nextSort (a click on a column header)", () => {
  it("starts a new column ascending, except date and size which start newest/largest first", () => {
    expect(nextSort("", "location", false)).toBe("url.asc");
    expect(nextSort("", "type", false)).toBe("filetype.asc");
    expect(nextSort("", "modified", false)).toBe("last_modified.desc");
    expect(nextSort("", "size", false)).toBe("content_length.desc");
  });
  it("flips the direction of the column already in effect, including the default one", () => {
    expect(nextSort("filename.asc", "name", false)).toBe("filename.desc");
    expect(nextSort("filename.desc", "name", false)).toBe("filename.asc");
    expect(nextSort("", "name", false)).toBe("filename.desc");
    expect(nextSort("last_modified.desc", "modified", true)).toBe("last_modified.asc");
  });
  it("relevance clears the sort", () => {
    expect(nextSort("filename.asc", "relevance", true)).toBe("");
  });
});

describe("firstSort (choosing a column from the sort menu)", () => {
  it("is the column's first direction, and empty for relevance", () => {
    expect(firstSort("name")).toBe("filename.asc");
    expect(firstSort("modified")).toBe("last_modified.desc");
    expect(firstSort("size")).toBe("content_length.desc");
    expect(firstSort("relevance")).toBe("");
  });
});

describe("400 fallback", () => {
  it("reverts an explicit sort the server answered 400 for", () => {
    expect(sortFallback({ httpStatus: 400, sort: "filetype.asc" })).toEqual({ sort: "", column: "type" });
    expect(sortFallback({ code: "invalid_request", sort: "url.desc" })).toEqual({ sort: "", column: "location" });
  });
  it("reverts a sort it does not recognise too, with no column to blame", () => {
    expect(sortFallback({ httpStatus: 400, sort: "weird.asc" })).toEqual({ sort: "", column: null });
  });
  it("does nothing without an explicit sort, or for another status", () => {
    expect(sortFallback({ httpStatus: 400, sort: "" })).toBeNull();
    expect(sortFallback({ httpStatus: 500, sort: "filetype.asc" })).toBeNull();
    expect(sortFallback({ httpStatus: 401, sort: "filename.asc" })).toBeNull();
    expect(sortFallback({})).toBeNull();
  });
  it("remembers which columns the server refused", () => {
    expect(isSortSupported("type")).toBe(true);
    markUnsupported("type");
    expect(isSortSupported("type")).toBe(false);
    expect(isSortSupported("name")).toBe(true);
    resetUnsupported();
    expect(isSortSupported("type")).toBe(true);
  });
  it("names the columns that need query.additional.sort.fields", () => {
    expect(needsServerSetting("type")).toBe(true);
    expect(needsServerSetting("location")).toBe(true);
    expect(needsServerSetting("name")).toBe(false);
    expect(needsServerSetting("modified")).toBe(false);
  });
});
