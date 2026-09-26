// SPDX-License-Identifier: Apache-2.0
// Label display names (fess#3493 parity): /api/v2/ui/config returns each label_options
// entry as { value, name }. Every place that shows a label chosen from label_options must
// show its name, falling back to the value only when the label has none: the label select
// in the search-options drawer, the current-filters badge and the options bar (search.js),
// the advanced-search checkboxes (advance.js) and the chat filter panel (chat.js).
// The sidebar label facet reads /api/v2/labels instead, whose entries are
// { value, label }; that shape is unchanged and is not covered here.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { themes } from "./helpers/themes.js";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { resetDom, mountBody, setLocation } from "./helpers/dom.js";
import { SEARCH_FIXTURE, FULL_CFG, installDispatch, settle } from "./helpers/searchFlow.js";

// A label whose name differs from its value, and one without a name.
const LABEL_OPTIONS = [
  { value: "fa", name: "Fixture A pages" },
  { value: "fb", name: "Fixture B pages" },
  { value: "fc" },
];

// Themes whose search.js keeps the bootstrap drawer, current-filters and options bar.
const SEARCH_THEMES = themes.filter((t) => t !== "codesearch");

/** Import a theme's module with api.getConfig() returning `config`. */
async function loadWithConfig(theme, moduleName, config) {
  vi.resetModules();
  const apiPath = `../themes/${theme}/assets/api.js`;
  vi.doMock(apiPath, async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, getConfig: () => config };
  });
  const mod = await import(`../themes/${theme}/assets/${moduleName}`);
  vi.doUnmock(apiPath);
  return mod;
}

beforeEach(() => {
  resetDom();
  sessionStorage.clear();
  window.scrollTo = () => {};
});
afterEach(() => setLocation("/"));

describe.each(SEARCH_THEMES)("label names in search.js [%s]", (theme) => {
  const cfg = { ...FULL_CFG, label_options: LABEL_OPTIONS };

  it("lists the labels by name in the search-options label select", async () => {
    setLocation("/search?q=foo");
    const flow = await loadSearchFlow(theme, cfg);
    installDispatch(flow.get);
    mountBody(SEARCH_FIXTURE);
    flow.mod.attach();
    const options = [...document.getElementById("labelSearchOption").options];
    expect(options.map((o) => [o.value, o.textContent])).toEqual([
      ["fa", "Fixture A pages"],
      ["fb", "Fixture B pages"],
      ["fc", "fc"],
    ]);
  });

  it("shows the selected label by name in the current-filters badge and the options bar", async () => {
    setLocation("/search?q=foo&fields.label=fb");
    const flow = await loadSearchFlow(theme, cfg);
    installDispatch(flow.get);
    mountBody(SEARCH_FIXTURE);
    flow.mod.runFromUrl();
    await settle();
    const badges = document.getElementById("current-filters").textContent;
    expect(badges).toContain("Fixture B pages");
    expect(badges).not.toContain("fb");
    const bar = document.getElementById("options-bar").textContent;
    expect(bar).toContain("Fixture B pages");
    expect(bar).not.toContain("fb");
  });
});

describe.each(themes)("label names in advance.js [%s]", (theme) => {
  it("labels each label checkbox with the label name, not its value", async () => {
    setLocation("/advance");
    const advance = await loadWithConfig(theme, "advance.js", { label_options: LABEL_OPTIONS });
    mountBody('<div id="advance-view"></div>');
    advance.attach();
    expect(document.querySelector('label[for="adv-label-fa"]').textContent).toBe("Fixture A pages");
    expect(document.querySelector('label[for="adv-label-fb"]').textContent).toBe("Fixture B pages");
    // A label without a name falls back to its value.
    expect(document.querySelector('label[for="adv-label-fc"]').textContent).toBe("fc");
  });
});

describe.each(themes)("label names in chat.js [%s]", (theme) => {
  it("shows the label name, not its value, next to each chat filter checkbox", async () => {
    setLocation("/chat");
    const chat = await loadWithConfig(theme, "chat.js", {
      features: { rag_chat_enabled: true },
      label_options: LABEL_OPTIONS,
    });
    mountBody('<section id="chat-view" hidden></section>');
    chat.attachStandalone();
    const rows = [...document.querySelectorAll('#chat-view input[data-filter-type="label"]')]
      .map((cb) => [cb.getAttribute("data-filter-value"), cb.parentElement.textContent]);
    expect(rows).toEqual([
      ["fa", "Fixture A pages"],
      ["fb", "Fixture B pages"],
      ["fc", "fc"],
    ]);
  });
});
