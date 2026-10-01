// SPDX-License-Identifier: Apache-2.0
// filesearch: recent.js — recent searches kept in localStorage, tolerant of its absence.

import { describe, it, expect } from "vitest";
import { RECENT_KEY, RECENT_MAX, getRecent, pushRecent, removeRecent, clearRecent } from "../themes/filesearch/assets/recent.js";

const memory = (initial) => {
  const data = initial === undefined ? {} : { [RECENT_KEY]: initial };
  return { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; }, data };
};

describe("recent searches", () => {
  it("starts empty", () => {
    expect(getRecent(() => memory())).toEqual([]);
  });

  it("keeps the newest first, without duplicates, capped", () => {
    const store = memory();
    for (const q of ["a", "b", "c", "a"]) pushRecent(q, () => store);
    expect(getRecent(() => store)).toEqual(["a", "c", "b"]);
    for (let i = 0; i < RECENT_MAX + 5; i++) pushRecent("q" + i, () => store);
    expect(getRecent(() => store)).toHaveLength(RECENT_MAX);
    expect(getRecent(() => store)[0]).toBe("q" + (RECENT_MAX + 4));
  });

  it("trims and ignores empty queries", () => {
    const store = memory();
    pushRecent("  hello  ", () => store);
    pushRecent("   ", () => store);
    pushRecent("", () => store);
    expect(getRecent(() => store)).toEqual(["hello"]);
  });

  it("removes one entry or all of them", () => {
    const store = memory();
    ["a", "b", "c"].forEach(q => pushRecent(q, () => store));
    removeRecent("b", () => store);
    expect(getRecent(() => store)).toEqual(["c", "a"]);
    clearRecent(() => store);
    expect(getRecent(() => store)).toEqual([]);
  });

  it("reads past corrupt stored data", () => {
    expect(getRecent(() => memory("not json"))).toEqual([]);
    expect(getRecent(() => memory('{"a":1}'))).toEqual([]);
    expect(getRecent(() => memory('["a",3,"b",null]'))).toEqual(["a", "b"]);
  });

  it("works without usable storage", () => {
    const blocked = () => { throw new DOMException("denied", "SecurityError"); };
    expect(getRecent(blocked)).toEqual([]);
    expect(pushRecent("a", blocked)).toEqual([]);
    expect(() => removeRecent("a", blocked)).not.toThrow();
    expect(() => clearRecent(blocked)).not.toThrow();
    expect(getRecent(() => null)).toEqual([]);
  });
});
