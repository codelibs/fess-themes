// SPDX-License-Identifier: Apache-2.0
// The header search box's suggest list (search.js attach(), every theme): the keys of an IME
// conversion belong to the input method, not to the list. While a composition is open the
// arrows pick a candidate and Enter confirms the text; taking the highlighted suggestion and
// submitting on that Enter searched for something the user had not finished typing.
//
// Composition is simulated as the browsers report it: keydown with isComposing and keyCode 229
// (Safari: isComposing false after compositionend, keyCode still 229). docsearch has its own
// suite for its two lists and palette (docsearch.suggest.test.js, docsearch.palette.test.js);
// it is run here as well so the contract is checked in every theme.

import { describe, it, expect, afterEach, vi } from "vitest";
import { themes, mountIndexBody } from "./helpers/themes.js";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { resetDom } from "./helpers/dom.js";
import { FULL_CFG, installDispatch } from "./helpers/searchFlow.js";

// codesearch's header box is #query-input with its own list; every other theme uses #query.
const BOX = { codesearch: { input: "query-input", dropdown: "header-suggest-dropdown" } };
const boxOf = (theme) => BOX[theme] || { input: "query", dropdown: "suggest-dropdown" };

const COMPOSING = { isComposing: true, keyCode: 229 };
const SAFARI_CONFIRM = { isComposing: false, keyCode: 229 };

const key = (target, name, init = {}) => {
  const ev = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
};

afterEach(() => {
  vi.useRealTimers();
  resetDom();
});

describe.each(themes)("%s: header suggest and IME composition", (theme) => {
  async function boot() {
    vi.useFakeTimers();
    const flow = await loadSearchFlow(theme, FULL_CFG);
    installDispatch(flow.get, { suggestWords: [{ text: "sug1" }, { text: "sug2" }] });
    mountIndexBody(theme);
    flow.mod.attach();
    const { input: inputId, dropdown: dropdownId } = boxOf(theme);
    const input = document.getElementById(inputId);
    input.value = "su";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(300);
    return { ...flow, input, dd: document.getElementById(dropdownId) };
  }
  const selected = (dd) => [...dd.querySelectorAll('[aria-selected="true"]')].map((e) => e.textContent);

  it("does not take the highlighted suggestion on the Enter that confirms a conversion", async () => {
    const { input, navigate } = await boot();
    key(input, "ArrowDown");
    const ev = key(input, "Enter", COMPOSING);
    expect(ev.defaultPrevented).toBe(false);
    expect(input.value).toBe("su");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not take it on Safari's variant either, nor move the highlight with a candidate arrow", async () => {
    const { input, dd, navigate } = await boot();
    key(input, "ArrowDown");
    const keys = [
      key(input, "ArrowDown", COMPOSING),
      key(input, "ArrowUp", COMPOSING),
      key(input, "Enter", SAFARI_CONFIRM),
      key(input, "Tab", COMPOSING),
    ];
    for (const ev of keys) expect(ev.defaultPrevented).toBe(false);
    expect(input.value).toBe("su");
    expect(navigate).not.toHaveBeenCalled();
    expect(selected(dd)).toEqual(["sug1"]);
  });

  it("leaves the list open when the conversion is cancelled with Escape", async () => {
    const { input, dd } = await boot();
    key(input, "ArrowDown");
    const ev = key(input, "Escape", COMPOSING);
    expect(ev.defaultPrevented).toBe(false);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(dd.querySelectorAll('[role="option"]').length).toBe(2);
    expect(selected(dd)).toEqual(["sug1"]);
  });

  it("still walks the list and takes the highlighted suggestion on plain keys", async () => {
    const { input, dd, navigate } = await boot();
    key(input, "ArrowDown");
    key(input, "ArrowDown");
    expect(selected(dd)).toEqual(["sug2"]);
    const ev = key(input, "Enter", { keyCode: 13 });
    expect(ev.defaultPrevented).toBe(true);
    expect(input.value).toBe("sug2");
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("q=sug2"));
  });
});
