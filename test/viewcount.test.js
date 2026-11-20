// SPDX-License-Identifier: Apache-2.0
// The view count on a result card of docuforge, helpdesk, mosaic, nomadkit, rawblock, semanticlens
// and voicebox is pluralised (docsearch has its own copy of this in docsearch.viewcount.test.js).
//
// The bundles had one message, "{n} views", so a document viewed once read "1 views". The theme's i18n
// has no plural syntax (t() only substitutes {n}), so the card picks between result.click_count and
// result.click_count_one with Intl.PluralRules of the UI locale: a locale whose "one" category covers the
// count reads the singular message, every other count (and every locale without a singular, such as
// ja or ko) the plain one.
//
// The theme's real bundles are loaded through the real i18n.js init.

import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadSearch } from "./helpers/loadSearch.js";
import { modulePath } from "./helpers/themes.js";

const THEMES = ["docuforge", "helpdesk", "mosaic", "nomadkit", "rawblock", "semanticlens", "voicebox"];
const LOCALES = ["de", "en", "es", "fr", "hi", "id", "it", "ja", "ko", "nl", "pl", "pt-BR", "ru", "tr", "zh-CN", "zh-TW"];

afterEach(() => vi.unstubAllGlobals());

describe.each(THEMES)("%s: the view count of a result", (THEME) => {
  const bundleDir = join(dirname(dirname(modulePath(THEME, "app.js"))), "i18n");
  const bundle = (loc) => JSON.parse(readFileSync(join(bundleDir, `messages.${loc}.json`), "utf8"));

  /** The text of the info line of a card built in `locale`. */
  async function viewCount(locale, clickCount) {
    const cfg = { features: { search_log_enabled: true } };
    const mod = await loadSearch(THEME, cfg);
    const i18n = await import(`../themes/${THEME}/assets/i18n.js`);
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => bundle(locale) }));
    await i18n.init(locale);
    vi.unstubAllGlobals();
    const li = mod.buildResultCard({ doc_id: "d1", title: "T", url: "https://ex.com/a", click_count: clickCount }, "q1", 1);
    return li.querySelector(".info").textContent.replace(/\s+/g, " ");
  }

  it("reads '1 view' in English, not '1 views'", async () => {
    const text = await viewCount("en", 1);
    expect(text).toContain("1 view");
    expect(text).not.toContain("1 views");
  });

  it.each([[2, "2 views"], [42, "42 views"], [101, "101 views"]])("keeps the plural for %i in English", async (n, expected) => {
    expect(await viewCount("en", n)).toContain(expected);
  });

  it("shows no view count for a document nobody viewed", async () => {
    expect(await viewCount("en", 0)).not.toMatch(/view/);
  });

  it.each([
    ["de", 1, "1 Aufruf"], ["de", 3, "3 Aufrufe"],
    ["fr", 1, "1 vue"], ["fr", 5, "5 vues"],
    ["es", 1, "1 vista"], ["pt-BR", 1, "1 visualização"], ["it", 1, "1 visualizzazione"],
    ["nl", 1, "1 weergave"], ["pl", 1, "1 wyświetlenie"], ["ru", 1, "1 просмотр"],
  ])("%s: %i reads %s", async (locale, n, expected) => {
    // the whole word: "1 Aufruf" is also the start of "1 Aufrufe"
    expect(await viewCount(locale, n)).toMatch(new RegExp(expected + "(?![\\p{L}])", "u"));
  });

  it.each(["ja", "ko", "zh-CN", "zh-TW", "id", "tr", "hi"])("%s: has no plural distinction, so 1 and 2 use the same message", async (locale) => {
    const one = await viewCount(locale, 1);
    const two = await viewCount(locale, 2);
    expect(one.replace("1", "#")).toBe(two.replace("2", "#"));
  });

  it("ships result.click_count_one in all 16 bundles, with the {n} placeholder", () => {
    for (const loc of LOCALES) expect(bundle(loc)["result.click_count_one"], loc).toMatch(/\{n\}/);
  });
});
