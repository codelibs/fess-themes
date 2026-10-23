// SPDX-License-Identifier: Apache-2.0
// docsearch: the message bundles are translated, not just present.
//
// verify-bundles.mjs only checks that every locale has every key. A key whose value is still the English
// sentence passes that check and shows English in a German page: the palette headings, the theme toggle,
// the AI disclaimer, the home tagline and (through data-i18n-aria-label) the screen-reader names of the
// search form, the drawer selects and the pager.
//
// - A sentence-length key must not read like the English one in any of the 14 translated locales
//   (an explicit list: the single words that are the same word in some language - "Code", "Pagination" - are not asked to differ)
// - Every placeholder ({0}, {n}, {count}, ...) the English value has is in the translation, and no other
// - Every data-i18n* key the shipped index.html names exists in every bundle

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { modulePath, parseIndexHtml } from "./helpers/themes.js";

const THEME = "docsearch";
const dir = join(dirname(dirname(modulePath(THEME, "app.js"))), "i18n");
const bundle = (loc) => JSON.parse(readFileSync(join(dir, `messages.${loc}.json`), "utf8"));
const locales = readdirSync(dir).map((f) => f.match(/^messages\.(.+)\.json$/)?.[1]).filter(Boolean).sort();
const en = bundle("en");
// ja is the source language of the Japanese strings, en the source of the rest
const translated = locales.filter((l) => l !== "en" && l !== "ja");

// Sentence-length values every translated locale must have turned into its own language.
const MUST_DIFFER = [
  "palette.title", "palette.open", "palette.placeholder", "palette.favorites", "palette.no_recent",
  "palette.save_search", "palette.remove_search", "palette.results", "palette.result_count", "palette.loading",
  "palette.nav_hint", "palette.select_hint", "palette.close_hint", "palette.ask_ai_group",
  "theme.toggle", "ai.ask_about", "ai.generated_label", "ai.disclaimer",
  "facet.selected_filters", "facet.clear_all", "facet.remove_filter", "home.tagline",
  "aria.site_search", "aria.search_query", "aria.search_suggestions", "aria.results_per_page", "aria.sort_order",
  "aria.language_filter", "aria.label_filter", "aria.home_search", "aria.search_results",
];
// "Documents", "Suggestions", "Recent", "Pagination" are the same word in French or Dutch; every other locale must differ.
const SAME_WORD_OK = {
  "palette.suggestions": ["fr"], "palette.documents": ["fr"], "palette.recent": ["nl"], "aria.pagination": ["fr"],
};
const SAME_WORD_KEYS = Object.keys(SAME_WORD_OK);
// Five sentences that only de, es, fr, ko, pt-BR and zh-CN still carried in English.
const SIX_LOCALES = ["de", "es", "fr", "ko", "pt-BR", "zh-CN"];
const SIX_KEYS = ["labels.advance_search_sort", "labels.advance_search_lang_multi", "labels.chat_fallback_model", "labels.chat_hit_count", "labels.chat_auth_required"];

describe(`${THEME}: bundles are translated`, () => {
  it("ships the 16 bundles", () => {
    expect(locales.length).toBe(16);
  });

  it.each(translated)("%s: no sentence-length key is left in English", (loc) => {
    const b = bundle(loc);
    const keys = [...MUST_DIFFER, ...(SIX_LOCALES.includes(loc) ? SIX_KEYS : [])];
    const left = keys.filter((k) => b[k] === en[k]);
    expect(left).toEqual([]);
  });

  it.each(translated)("%s: single words that equal English are on the allow-list", (loc) => {
    const b = bundle(loc);
    for (const key of SAME_WORD_KEYS) {
      if (b[key] === en[key]) expect(SAME_WORD_OK[key], `${loc} ${key}`).toContain(loc);
    }
  });

  it("ja carries the new aria keys in Japanese", () => {
    const ja = bundle("ja");
    for (const k of MUST_DIFFER.filter((k) => k.startsWith("aria."))) expect(ja[k], k).not.toBe(en[k]);
  });
});

describe(`${THEME}: placeholders survive translation`, () => {
  const tokens = (s) => [...s.matchAll(/\{[A-Za-z0-9_]+\}/g)].map((m) => m[0]).sort();

  it.each(locales.filter((l) => l !== "en"))("%s: same {placeholders} as English in every value", (loc) => {
    const b = bundle(loc);
    const bad = Object.keys(en).filter((k) => typeof b[k] === "string" && tokens(b[k]).join() !== tokens(en[k]).join());
    expect(bad).toEqual([]);
  });
});

describe(`${THEME}: index.html names only keys that exist`, () => {
  const doc = parseIndexHtml(THEME);
  const named = new Set();
  for (const attr of ["data-i18n", "data-i18n-aria-label", "data-i18n-placeholder", "data-i18n-alt"]) {
    doc.querySelectorAll(`[${attr}]`).forEach((e) => named.add(e.getAttribute(attr)));
  }

  it("names a key", () => {
    expect(named.size).toBeGreaterThan(40);
  });

  it.each(locales)("%s: has every one", (loc) => {
    const b = bundle(loc);
    expect([...named].filter((k) => typeof b[k] !== "string")).toEqual([]);
  });
});
