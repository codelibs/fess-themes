// SPDX-License-Identifier: Apache-2.0
// UI language: api.init() forwards ?browser_lang= to /api/v2/ui/config, and i18n.js
// prefers the server's ui_locale over navigator.language. api.js and i18n.js are
// byte-identical in every theme (parity.test.js), so docuforge's copies are tested.

import { describe, it, expect, afterEach, vi } from "vitest";
import { setLocation } from "./helpers/dom.js";

const API = "../themes/docuforge/assets/api.js";
const I18N = "../themes/docuforge/assets/i18n.js";

/** A fetch double answering every request with `body` as JSON. */
function stubFetch(body) {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function setLanguage(value) {
  Object.defineProperty(navigator, "language", { value, configurable: true });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setLocation("/");
});

describe("api.init", () => {
  it("forwards ?browser_lang= from the page URL to /ui/config", async () => {
    vi.resetModules();
    const fetchMock = stubFetch({ response: { status: 0, csrf_token: "t" } });
    setLocation("/?browser_lang=ja");
    const api = await import(API);
    await api.init();
    expect(fetchMock.mock.calls[0][0]).toBe("api/v2/ui/config?browser_lang=ja");
  });

  it("requests /ui/config without parameters when the page URL has no browser_lang", async () => {
    vi.resetModules();
    const fetchMock = stubFetch({ response: { status: 0, csrf_token: "t" } });
    const api = await import(API);
    await api.init();
    expect(fetchMock.mock.calls[0][0]).toBe("api/v2/ui/config");
  });
});

describe("i18n.pickLocale", () => {
  it.each([
    ["ja", "de-DE", "ja"],
    ["pt-BR", "en-US", "pt-BR"],
    ["fr-CA", "en-US", "fr"],
    ["", "de-DE", "de"],
    [undefined, "de-DE", "de"],
    ["xx", "ko-KR", "ko"],
  ])("preferred %s with navigator.language %s → %s", async (preferred, lang, expected) => {
    setLanguage(lang);
    const i18n = await import(I18N);
    expect(i18n.pickLocale(preferred)).toBe(expected);
  });

  it("loads the bundle of the preferred locale from beside the module", async () => {
    vi.resetModules();
    const fetchMock = stubFetch({ "page.title": "Fess KO" });
    setLanguage("ja-JP");
    const i18n = await import(I18N);
    await i18n.init("ko");
    expect(i18n.getLocale()).toBe("ko");
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/themes\/docuforge\/i18n\/messages\.ko\.json$/);
  });
});
