// SPDX-License-Identifier: Apache-2.0
// The results-status banner ("Results 1 - 2 of 42 for {bq}") with a blank query.
// Browsing a category tile runs /search?q=&fields.label=x, and a label facet in a shared
// URL runs /search?q=&ex_q=label:x; neither has a keyword to put in {bq}. The banner
// names the active labels instead (by label_options name, as the current-filters badge
// does), and with no label at all it uses the _noquery wording, which has no {bq}.
//
// Unlike search-flows.test.js, t() here reads the theme's real English bundle, so the
// assertions see the text a user sees rather than raw i18n keys.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { modulePath } from "./helpers/themes.js";
import { resetDom, mountBody, setLocation } from "./helpers/dom.js";
import {
  SEARCH_FIXTURE, FULL_CFG, SAMPLE_DOCS, makeSearchEnv, installDispatch, settle,
} from "./helpers/searchFlow.js";

// The nine themes that render #results-status (codesearch has its own summary line).
const STATUS_THEMES = [
  "docsearch", "docuforge", "helpdesk", "mosaic",
  "nomadkit", "rawblock", "semanticlens", "storefront", "voicebox",
];

const LABEL_OPTIONS = [
  { value: "fa", name: "Fixture A pages" },
  { value: "fb", name: "Fixture B pages" },
  { value: "fc" },
];

function englishBundle(theme) {
  const i18nDir = join(dirname(dirname(modulePath(theme, "app.js"))), "i18n");
  return JSON.parse(readFileSync(join(i18nDir, "messages.en.json"), "utf8"));
}

/** The banner text (without the exec-time suffix) the bundle's `key` renders to. */
function expected(messages, key, bq) {
  return messages[key]
    .replace("{b0}", "42").replace("{b1}", "1").replace("{b2}", "2")
    .replace("{bq}", bq);
}

beforeEach(() => {
  resetDom();
  sessionStorage.clear();
  window.scrollTo = () => {};
});
afterEach(() => setLocation("/"));

describe.each(STATUS_THEMES)("results-status banner [%s]", (theme) => {
  const messages = englishBundle(theme);
  const cfg = { ...FULL_CFG, label_options: LABEL_OPTIONS };

  async function render(url, overrides) {
    setLocation(url);
    const i18nPath = `../themes/${theme}/assets/i18n.js`;
    vi.doMock(i18nPath, async (importOriginal) => {
      const actual = await importOriginal();
      return { ...actual, t: (key) => messages[key] || key };
    });
    const flow = await loadSearchFlow(theme, cfg);
    vi.doUnmock(i18nPath);
    installDispatch(flow.get, overrides);
    mountBody(SEARCH_FIXTURE);
    flow.mod.runFromUrl();
    await settle();
    return document.getElementById("results-status");
  }

  it("keeps the query in the banner when there is one", async () => {
    const status = await render("/search?q=foo&fields.label=fb");
    expect(status.textContent).toContain(expected(messages, "labels.search_result_status", "foo"));
    expect(status.textContent).not.toContain("Fixture B pages");
  });

  it("names the category label, not an empty query, for a blank query", async () => {
    const status = await render("/search?q=&fields.label=fb&fields.label=fc");
    expect(status.textContent).toContain(
      expected(messages, "labels.search_result_status", "Fixture B pages, fc"));
    const bold = [...status.querySelectorAll("b")].map((b) => b.textContent);
    expect(bold).toContain("Fixture B pages, fc");
    expect(bold).not.toContain("");
  });

  it("names a label facet carried in ex_q for a blank query", async () => {
    const status = await render("/search?q=&ex_q=label%3Afa");
    expect(status.textContent).toContain(
      expected(messages, "labels.search_result_status", "Fixture A pages"));
  });

  it("uses the _noquery wording when there is neither a query nor a label", async () => {
    const status = await render("/search?q=&ex_q=filetype%3Ahtml");
    expect(status.textContent).toContain(expected(messages, "labels.search_result_status_noquery"));
    expect(messages["labels.search_result_status_noquery"]).not.toContain("{bq}");
    expect([...status.querySelectorAll("b")].map((b) => b.textContent)).toEqual(["1", "2", "42"]);
  });

  it("uses the _noquery_over wording for an estimated total", async () => {
    const status = await render("/search?q=&ex_q=filetype%3Ahtml", {
      search: makeSearchEnv(SAMPLE_DOCS, { record_count_relation: "GREATER_THAN_OR_EQUAL_TO" }),
    });
    expect(status.textContent)
      .toContain(expected(messages, "labels.search_result_status_noquery_over"));
    expect([...status.querySelectorAll("b")].map((b) => b.textContent)).toEqual(["1", "2", "42"]);
  });
});
