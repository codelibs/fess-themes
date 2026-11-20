// SPDX-License-Identifier: Apache-2.0
// The singular messages (result.click_count_one, labels.chat_hit_count_one) in every locale of every
// theme, run through the real t(). Intl.PluralRules puts more than 1 in the "one" category (21 and 101
// in Russian, 0 in French), so a singular text must carry the number and not a fixed "1".
//
// For each locale and each count the message the card or the chat would pick is formatted with the
// theme's real bundle: it is not empty, names the count, and has no unreplaced brace, "NaN" or
// "undefined" in it.

import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { themes, modulePath } from "./helpers/themes.js";

const COUNTS = [0, 1, 2, 5, 21, 1000];
const MESSAGES = [
  { plain: "result.click_count", one: "result.click_count_one", param: "n" },
  { plain: "labels.chat_hit_count", one: "labels.chat_hit_count_one", param: "count" },
];

afterEach(() => vi.unstubAllGlobals());

describe.each(themes)("%s: plural messages in every locale", (theme) => {
  const dir = join(dirname(dirname(modulePath(theme, "app.js"))), "i18n");
  const locales = readdirSync(dir).filter((f) => /^messages\..+\.json$/.test(f)).map((f) => f.slice(9, -5));

  it("has 16 locales", () => {
    expect(locales.length).toBe(16);
  });

  it.each(locales)("%s: every count reads as a sentence about that count", async (locale) => {
    const bundle = JSON.parse(readFileSync(join(dir, `messages.${locale}.json`), "utf8"));
    vi.resetModules();
    const i18n = await import(`../themes/${theme}/assets/i18n.js`);
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => bundle }));
    await i18n.init(locale);
    vi.unstubAllGlobals();
    for (const { plain, one, param } of MESSAGES) {
      if (!bundle[one]) continue;   // a theme that shows no view count has no result.click_count_one
      for (const n of COUNTS) {
        const key = new Intl.PluralRules(locale).select(n) === "one" ? one : plain;
        const text = i18n.t(key, { [param]: n });
        const where = `${theme} ${locale} ${key} n=${n}: "${text}"`;
        expect(text.trim(), where).not.toBe("");
        expect(text, where).toContain(String(n));
        expect(text, where).not.toMatch(/[{}]|NaN|undefined|null/);
      }
    }
  });
});
