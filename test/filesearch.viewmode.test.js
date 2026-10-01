// SPDX-License-Identifier: Apache-2.0
// filesearch: viewmode.js — the details / compact / tiles choice survives a reload, and a
// browser that refuses storage (private window, blocked site data) must not break the page.

import { describe, it, expect } from "vitest";
import { VIEW_MODES, DEFAULT_VIEW, VIEW_KEY, loadViewMode, saveViewMode } from "../themes/filesearch/assets/viewmode.js";

const memory = (initial = {}) => {
  const data = { ...initial };
  return { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
};

describe("view mode persistence", () => {
  it("offers details, compact and tiles, details first", () => {
    expect(VIEW_MODES).toEqual(["details", "compact", "tiles"]);
    expect(DEFAULT_VIEW).toBe("details");
  });

  it("loads the saved mode", () => {
    expect(loadViewMode(() => memory({ [VIEW_KEY]: "tiles" }))).toBe("tiles");
  });

  it("falls back to the default for nothing saved or a value it does not know", () => {
    expect(loadViewMode(() => memory())).toBe("details");
    expect(loadViewMode(() => memory({ [VIEW_KEY]: "grid" }))).toBe("details");
  });

  it("saves a valid mode and refuses an invalid one", () => {
    const store = memory();
    expect(saveViewMode("compact", () => store)).toBe(true);
    expect(store.data[VIEW_KEY]).toBe("compact");
    expect(saveViewMode("nope", () => store)).toBe(false);
    expect(store.data[VIEW_KEY]).toBe("compact");
  });

  it("survives a localStorage that throws on access", () => {
    const blocked = () => { throw new DOMException("denied", "SecurityError"); };
    expect(loadViewMode(blocked)).toBe("details");
    expect(saveViewMode("tiles", blocked)).toBe(false);
  });

  it("survives a localStorage that throws on read or write", () => {
    const broken = { getItem() { throw new Error("read"); }, setItem() { throw new Error("quota"); } };
    expect(loadViewMode(() => broken)).toBe("details");
    expect(saveViewMode("tiles", () => broken)).toBe(false);
  });

  it("survives there being no storage at all", () => {
    expect(loadViewMode(() => null)).toBe("details");
    expect(saveViewMode("tiles", () => undefined)).toBe(false);
  });

  it("uses window.localStorage by default", () => {
    localStorage.clear();
    expect(saveViewMode("tiles")).toBe(true);
    expect(loadViewMode()).toBe("tiles");
    localStorage.clear();
  });
});
