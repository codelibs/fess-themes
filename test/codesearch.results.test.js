// SPDX-License-Identifier: Apache-2.0
// codesearch: what runSearch() leaves on the page.
//
//   1. The document title carries the query literally. String.prototype.replace() treats `$&` and
//      `$$` in a replacement string as patterns, so "a$&b" used to come out as "a{0}b - Fess".
//
// The theme's real English bundle is loaded (through the real i18n.js init), so the assertions
// see the text a user sees rather than raw i18n keys.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { modulePath } from "./helpers/themes.js";
import { resetDom, mountBody, setLocation } from "./helpers/dom.js";
import { SEARCH_FIXTURE, FULL_CFG, SAMPLE_DOCS, makeSearchEnv, installDispatch, settle } from "./helpers/searchFlow.js";

const THEME = "codesearch";
const $ = (id) => document.getElementById(id);

const ENGLISH = JSON.parse(readFileSync(
  join(dirname(dirname(modulePath(THEME, "app.js"))), "i18n", "messages.en.json"), "utf8"));

/** The theme's search.js with its real i18n.js primed with the English bundle. */
async function loadEnglishFlow(cfg = FULL_CFG) {
  const flow = await loadSearchFlow(THEME, cfg);
  const i18n = await import(`../themes/${THEME}/assets/i18n.js`);
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ENGLISH }));
  try {
    await i18n.init("en");
  } finally {
    vi.unstubAllGlobals();
  }
  return flow;
}

beforeEach(() => {
  resetDom();
  window.scrollTo = () => {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLocation("/");
});

describe("codesearch: the document title of a search", () => {
  async function titleFor(q) {
    const flow = await loadEnglishFlow();
    installDispatch(flow.get, { search: makeSearchEnv(SAMPLE_DOCS) });
    mountBody(SEARCH_FIXTURE);
    flow.mod._state.q = q;
    await flow.mod.runSearch();
    await settle();
    return document.title;
  }

  it("is the query followed by the site name", async () => {
    expect(await titleFor("coffee")).toBe("coffee - Fess");
  });

  // Each of these is a special replacement pattern for String.prototype.replace().
  it.each([
    ["$&", "a$&b"],
    ["$$", "x$$y"],
    ["$`", "c$`d"],
    ["$'", "e$'f"],
    ["$1", "g$1h"],
    ["a placeholder", "{0} and {1}"],
  ])("inserts a query containing %s literally", async (_name, q) => {
    expect(await titleFor(q)).toBe(q + " - Fess");
  });
});

