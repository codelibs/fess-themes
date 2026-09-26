// SPDX-License-Identifier: Apache-2.0
// Popular words are gated on features.popular_word from /api/v2/ui/config. When the
// server disables them (web.api.popularword=false) /api/v2/popular-words answers 400,
// so the home view must not ask for them at all.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { themes } from "./helpers/themes.js";
import { resetDom, setLocation } from "./helpers/dom.js";
import { bootApp } from "./helpers/loadShell.js";

const popularWordsCalls = (get) => get.mock.calls.filter((c) => c[0] === "/popular-words").length;

const get = async (path) => (path === "/popular-words" ? { popular_words: ["alpha", "beta"] } : { authenticated: false });

describe.each(themes)("%s: popular words on the home view", (theme) => {
  let detach;
  beforeEach(() => {
    resetDom();
    setLocation("/");
  });
  afterEach(() => {
    if (detach) detach();
    detach = undefined;
    vi.resetModules();
  });

  it("does not request /popular-words when features.popular_word is false", async () => {
    const booted = await bootApp(theme, { features: { popular_word: false }, notifications: {} }, { get });
    detach = booted.detach;
    expect(popularWordsCalls(booted.get)).toBe(0);
    expect(document.querySelectorAll("#home-popular-words a").length).toBe(0);
  });

  it("does not request /popular-words when features.popular_word is absent", async () => {
    const booted = await bootApp(theme, { features: {}, notifications: {} }, { get });
    detach = booted.detach;
    expect(popularWordsCalls(booted.get)).toBe(0);
  });

  it("requests and renders popular words when features.popular_word is true", async () => {
    const booted = await bootApp(theme, { features: { popular_word: true }, notifications: {} }, { get });
    detach = booted.detach;
    expect(popularWordsCalls(booted.get)).toBeGreaterThan(0);
    expect(document.getElementById("home-popular-words").textContent).toContain("alpha");
  });
});
