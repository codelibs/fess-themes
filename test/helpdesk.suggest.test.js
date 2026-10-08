// SPDX-License-Identifier: Apache-2.0
// helpdesk: the home search box's suggest list (attachSuggest) had no keyboard model:
// ArrowDown/ArrowUp/Enter/Escape did nothing, and aria-selected / aria-activedescendant were never
// set, so a keyboard or screen-reader user could not pick a suggestion. It must also not act on a
// key that belongs to an IME conversion: the Enter that confirms it must not pick a suggestion or
// submit the search.
//
// Composition is simulated as the browsers report it: keydown with isComposing and keyCode 229
// (Safari: isComposing false after compositionend, keyCode still 229).

import { describe, it, expect, afterEach, vi } from "vitest";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { mountBody } from "./helpers/dom.js";
import { FULL_CFG, installDispatch } from "./helpers/searchFlow.js";

const THEME = "helpdesk";

afterEach(() => vi.useRealTimers());

const key = (target, name, init = {}) => {
  const ev = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
};
const COMPOSING = { isComposing: true, keyCode: 229 };

describe("helpdesk home suggest (attachSuggest): keyboard model", () => {
  async function boot(words = [{ text: "sug1" }, { text: "sug2" }, { text: "sug3" }]) {
    vi.useFakeTimers();
    const { mod, get } = await loadSearchFlow(THEME, FULL_CFG);
    installDispatch(get, { suggestWords: words });
    mountBody('<form id="f"><input id="sg" type="search"><ul id="sgd" class="d-none"></ul></form>');
    const input = document.getElementById("sg");
    const dd = document.getElementById("sgd");
    const submitted = vi.fn((ev) => ev.preventDefault());
    document.getElementById("f").addEventListener("submit", submitted);
    mod.attachSuggest(input, dd, { submitOnSelect: true });
    input.value = "su";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(150);
    return { input, dd, items: [...dd.querySelectorAll('[role="option"]')], submitted };
  }

  it("ArrowDown and ArrowUp move a highlight that aria-selected and aria-activedescendant follow", async () => {
    const { input, items } = await boot();
    expect(items.length).toBe(3);
    const ev = key(input, "ArrowDown");
    expect(ev.defaultPrevented).toBe(true);
    expect(items[0].getAttribute("aria-selected")).toBe("true");
    expect(items[0].classList.contains("active")).toBe(true);
    expect(input.getAttribute("aria-activedescendant")).toBe(items[0].id);
    key(input, "ArrowDown");
    expect(items[0].getAttribute("aria-selected")).toBe("false");
    expect(items[1].getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(items[1].id);
    key(input, "ArrowUp");
    key(input, "ArrowUp");
    // up from the first entry wraps to the last
    expect(items[2].getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(items[2].id);
    key(input, "ArrowDown");
    expect(items[0].getAttribute("aria-selected")).toBe("true");
  });

  it("Enter takes the highlighted entry and submits the form", async () => {
    const { input, dd, submitted } = await boot();
    key(input, "ArrowDown");
    key(input, "ArrowDown");
    const ev = key(input, "Enter", { keyCode: 13 });
    expect(ev.defaultPrevented).toBe(true);
    expect(input.value).toBe("sug2");
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(dd.classList.contains("d-none")).toBe(true);
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("leaves Enter to the form when nothing is highlighted", async () => {
    const { input } = await boot();
    const ev = key(input, "Enter", { keyCode: 13 });
    expect(ev.defaultPrevented).toBe(false);
    expect(input.value).toBe("su");
  });

  it("Escape closes the list and keeps what was typed", async () => {
    const { input, dd } = await boot();
    key(input, "ArrowDown");
    const ev = key(input, "Escape");
    expect(ev.defaultPrevented).toBe(true);
    expect(dd.classList.contains("d-none")).toBe(true);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    expect(input.value).toBe("su");
    // with the list closed, Escape is the browser's again
    expect(key(input, "Escape").defaultPrevented).toBe(false);
  });

  it("starts from no highlight again when the list is rebuilt", async () => {
    const { input, dd } = await boot();
    key(input, "ArrowDown");
    input.value = "sug";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(150);
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    key(input, "ArrowDown");
    expect(dd.querySelector('[role="option"]').getAttribute("aria-selected")).toBe("true");
  });

  it("ignores the keys of an IME conversion", async () => {
    const { input, dd, submitted } = await boot();
    key(input, "ArrowDown");
    const keys = [
      key(input, "ArrowDown", COMPOSING),
      key(input, "Enter", COMPOSING),
      key(input, "Enter", { isComposing: false, keyCode: 229 }),
      key(input, "Escape", COMPOSING),
    ];
    for (const ev of keys) expect(ev.defaultPrevented).toBe(false);
    expect(submitted).not.toHaveBeenCalled();
    expect(input.value).toBe("su");
    expect(dd.classList.contains("d-none")).toBe(false);
    expect(dd.querySelectorAll('[aria-selected="true"]').length).toBe(1);
  });
});
