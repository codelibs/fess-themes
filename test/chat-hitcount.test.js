// SPDX-License-Identifier: Apache-2.0
// The hit count the chat shows when its search phase completes is pluralised, in every theme.
//
// The bundles had one message, "{count} documents found", so one hit read "1 documents found". The
// theme's i18n has no plural syntax (t() only substitutes {count}), so chat.js picks between
// labels.chat_hit_count and labels.chat_hit_count_one with Intl.PluralRules of the UI locale: a
// locale whose "one" category covers the count reads the singular message, every other count (and
// every locale without a singular, such as ja) the plain one.
//
// The inline chat panel is mounted with the theme's real chat.js and bundle; api.js is a double that
// hands the stream's event callback to the test.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { themes, modulePath } from "./helpers/themes.js";
import { resetDom } from "./helpers/dom.js";

const LOCALES = ["de", "en", "es", "fr", "hi", "id", "it", "ja", "ko", "nl", "pl", "pt-BR", "ru", "tr", "zh-CN", "zh-TW"];

beforeEach(() => {
  resetDom();
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => vi.unstubAllGlobals());

describe.each(themes)("%s: the hit count of the chat's search phase", (theme) => {
  const bundleDir = join(dirname(dirname(modulePath(theme, "app.js"))), "i18n");
  const bundle = (loc) => JSON.parse(readFileSync(join(bundleDir, `messages.${loc}.json`), "utf8"));

  /** The text next to the search phase badge after the server reports `hit_count` hits, in `locale`. */
  async function hitCountText(locale, hitCount) {
    vi.resetModules();
    const apiPath = `../themes/${theme}/assets/api.js`;
    let onEvent = null;
    vi.doMock(apiPath, async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        getConfig: () => ({ features: { rag_chat_enabled: true } }),
        sseStream: (_path, _body, cb) => { onEvent = cb; return { abort() {} }; },
      };
    });
    const i18n = await import(`../themes/${theme}/assets/i18n.js`);
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => bundle(locale) }));
    await i18n.init(locale);
    vi.unstubAllGlobals();
    const chat = await import(`../themes/${theme}/assets/chat.js`);
    vi.doUnmock(apiPath);
    // codesearch has its own panel: the "ask" panel of its results page.
    const ask = theme === "codesearch";
    document.body.innerHTML = ask ? '<div id="ask-body"></div>' : '<div id="chat-column" class="d-none"></div>';
    if (ask) chat.attachAskPanel(() => ({ q: "question", fields: [], extraQ: [] }));
    else chat.attachInline();
    const column = document.getElementById(ask ? "ask-body" : "chat-column");
    column.querySelector("textarea, input[type=text]").value = "question";
    column.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r));
    onEvent({ type: "phase", data: { phase: "search", status: "complete", hit_count: hitCount } });
    const span = column.querySelector(".chat-hit-count");
    return span ? span.textContent.replace(/\s+/g, " ").trim() : null;
  }

  // helpdesk counts "answers", the others "documents"
  const noun = theme === "helpdesk" ? "answer" : "document";

  it("reads '1 document found' in English, not '1 documents found'", async () => {
    const text = await hitCountText("en", 1);
    expect(text).toContain(`1 ${noun} found`);
    expect(text).not.toContain(`1 ${noun}s`);
  });

  it.each([2, 42])("keeps the plural for %i in English", async (n) => {
    expect(await hitCountText("en", n)).toContain(`${n} ${noun}s found`);
  });

  it.each([["it", 1, "1 documento trovato"], ["it", 3, "3 documenti trovati"], ["nl", 1, "1 document gevonden"],
    ["pl", 1, "1 dokument znaleziono"], ["ru", 1, "Найден 1 документ"]])("%s: %i reads %s", async (locale, n, expected) => {
    expect(await hitCountText(locale, n)).toContain(expected);
  });

  it.each(["ja", "zh-TW", "id", "tr", "hi"])("%s: has no plural distinction, so 1 and 2 use the same message", async (locale) => {
    const one = await hitCountText(locale, 1);
    const two = await hitCountText(locale, 2);
    expect(one.replace("1", "#")).toBe(two.replace("2", "#"));
  });

  it("ships labels.chat_hit_count_one in all 16 bundles, with the {count} placeholder", () => {
    for (const loc of LOCALES) expect(bundle(loc)["labels.chat_hit_count_one"], loc).toMatch(/\{count\}/);
  });
});
