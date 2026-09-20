// SPDX-License-Identifier: Apache-2.0
// Wording shared with the bootstrap theme in fess: the permission notice, the forced
// password change and the view count read like the JSP pages in every locale bundle.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { themes, modulePath } from "./helpers/themes.js";

const NEW_KEYS = ["auth.password_change_required", "errors.user_permissions_loading", "errors.user_permissions_unavailable"];

describe.each(themes)("%s: shared i18n wording", (theme) => {
  const i18nDir = join(dirname(dirname(modulePath(theme, "app.js"))), "i18n");
  const bundles = readdirSync(i18nDir).filter((f) => /^messages\..+\.json$/.test(f));

  it("every bundle carries the new keys and a {n} view count", () => {
    expect(bundles.length).toBe(16);
    for (const file of bundles) {
      const messages = JSON.parse(readFileSync(join(i18nDir, file), "utf8"));
      for (const key of NEW_KEYS) {
        expect(typeof messages[key], `${theme}/i18n/${file} ${key}`).toBe("string");
      }
      expect(messages["result.click_count"], `${theme}/i18n/${file}`).toContain("{n}");
    }
  });

  it("the English bundle uses the JSP wording", () => {
    const en = JSON.parse(readFileSync(join(i18nDir, "messages.en.json"), "utf8"));
    expect(en["result.click_count"]).toBe("{n} views");
    expect(en["auth.password_change_required"]).toBe("You need to update your password");
  });
});
