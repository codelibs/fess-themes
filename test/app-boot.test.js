// SPDX-License-Identifier: Apache-2.0
// app.js boot: the UI language comes from the server's ui_locale (?browser_lang=,
// session, Accept-Language — as on the JSP pages).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { themes } from "./helpers/themes.js";
import { resetDom } from "./helpers/dom.js";
import { bootApp } from "./helpers/loadShell.js";

describe.each(themes)("%s: app.js boot", (theme) => {
  beforeEach(() => resetDom());
  afterEach(() => vi.resetModules());

  it("passes the server's ui_locale to i18n.init", async () => {
    const { i18nInit } = await bootApp(theme, { features: {}, notifications: {}, ui_locale: "ja" });
    expect(i18nInit).toHaveBeenCalledWith("ja");
  });
});
