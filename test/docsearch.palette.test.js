// SPDX-License-Identifier: Apache-2.0
// docsearch: the command palette (palette.js). The theme's real index.html body and palette.js
// run against api and router doubles.
//
// - While an IME is composing, Enter confirms the conversion, the arrows pick a candidate and
//   Escape cancels it: none of them is for the palette. Composition is simulated with the
//   events a browser sends: compositionstart, keydown with isComposing and keyCode 229
//   (Safari reports the confirming Enter after compositionend, with isComposing false but
//   still keyCode 229), compositionend.
// - Escape closes the palette wherever the focus is inside it, and the focus goes back to the
//   control that opened it.
// - A suggestion row has an icon, like a document row.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountIndexBody } from "./helpers/themes.js";
import { resetDom } from "./helpers/dom.js";

const THEME = "docsearch";

const HIT = {
  doc_id: "d1", content_title: "Install guide", url: "https://ex.test/docs/install.html",
  url_link: "https://ex.test/docs/install.html", site_path: "ex.test/docs/install.html",
  mimetype: "text/html", filetype: "html",
};

let palette;
let redirect;
let trigger;
let input;

async function loadPalette() {
  vi.resetModules();
  const apiPath = `../themes/${THEME}/assets/api.js`;
  const routerPath = `../themes/${THEME}/assets/router.js`;
  redirect = vi.fn();
  const get = vi.fn(async (path) => {
    if (path === "/suggest-words") return { suggest_words: [{ text: "install" }, { text: "installer" }] };
    return { query_id: "q1", requested_time: 1, data: [HIT] };
  });
  vi.doMock(apiPath, async (importOriginal) => ({ ...(await importOriginal()), get, getConfig: () => ({ features: {} }) }));
  vi.doMock(routerPath, () => ({ redirect }));
  palette = await import(`../themes/${THEME}/assets/palette.js`);
  vi.doUnmock(apiPath);
  vi.doUnmock(routerPath);
}

const keydown = (target, key, init = {}) => {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
};

/** Type `value` into the palette and wait out its debounce for the answer. */
async function type(value) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(250);
}

beforeEach(async () => {
  vi.useFakeTimers();
  // jsdom has no layout, so it does not implement scrollIntoView (the palette calls it on the active row)
  Element.prototype.scrollIntoView = () => {};
  resetDom();
  localStorage.clear();
  mountIndexBody(THEME);
  await loadPalette();
  palette.init();
  trigger = document.getElementById("palette-trigger");
  input = document.getElementById("palette-input");
});
afterEach(() => {
  vi.useRealTimers();
});

const isOpen = () => !document.getElementById("palette").hidden;

describe("docsearch palette: an IME conversion is not a command", () => {
  it("does not search when the Enter that confirms a conversion is pressed", async () => {
    palette.open("");
    input.value = "けいたい";
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const ev = keydown(input, "Enter", { isComposing: true, keyCode: 229 });
    expect(ev.defaultPrevented).toBe(false);
    expect(redirect).not.toHaveBeenCalled();
    expect(localStorage.getItem("ds-recent")).toBeNull();
  });

  it("does not search on the confirming Enter Safari reports after compositionend", () => {
    palette.open("");
    input.value = "けいたい";
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    keydown(input, "Enter", { isComposing: false, keyCode: 229 });
    expect(redirect).not.toHaveBeenCalled();
    expect(localStorage.getItem("ds-recent")).toBeNull();
  });

  it("searches on the next Enter, once the conversion is confirmed", () => {
    palette.open("");
    input.value = "けいたい";
    keydown(input, "Enter", { isComposing: true, keyCode: 229 });
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    keydown(input, "Enter", { keyCode: 13 });
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect.mock.calls[0][0]).toBe(`search?q=${encodeURIComponent("けいたい")}`);
    expect(JSON.parse(localStorage.getItem("ds-recent"))).toEqual(["けいたい"]);
  });

  it("leaves the arrows to the candidate list and Escape to the composition", async () => {
    palette.open("");
    await type("install");
    const rows = [...document.querySelectorAll("#palette-listbox .ds-palette-row")];
    expect(rows[0].getAttribute("aria-selected")).toBe("true");
    keydown(input, "ArrowDown", { isComposing: true, keyCode: 229 });
    expect(rows[0].getAttribute("aria-selected")).toBe("true");
    const esc = keydown(input, "Escape", { isComposing: true, keyCode: 229 });
    expect(esc.defaultPrevented).toBe(false);
    expect(isOpen()).toBe(true);
  });
});

describe("docsearch palette: Escape and focus", () => {
  it("closes on Escape from the input and puts the focus back on its opener", () => {
    trigger.focus();
    trigger.click();
    expect(isOpen()).toBe(true);
    keydown(input, "Escape");
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Escape when the focus is not in the input", () => {
    localStorage.setItem("ds-recent", JSON.stringify(["alpha", "beta"]));
    trigger.focus();
    trigger.click();
    const row = document.querySelector("#palette-empty .ds-palette-row-body");
    row.focus();
    expect(document.activeElement).toBe(row);
    keydown(row, "Escape");
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("still closes on Escape after a star re-rendered the list, and keeps the focus in the palette until then", () => {
    localStorage.setItem("ds-recent", JSON.stringify(["alpha", "beta"]));
    trigger.focus();
    trigger.click();
    const star = document.querySelector("#palette-empty .ds-palette-star");
    star.focus();
    star.click();
    expect(JSON.parse(localStorage.getItem("ds-fav"))).toEqual(["alpha"]);
    // the list was rebuilt: the star that had the focus is gone, and the focus must not fall to <body>
    expect(document.getElementById("palette").contains(document.activeElement)).toBe(true);
    keydown(document.activeElement, "Escape");
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Escape even if the focus has fallen to <body>", () => {
    palette.open("");
    document.activeElement.blur();
    expect(document.activeElement).toBe(document.body);
    keydown(document.body, "Escape");
    expect(isOpen()).toBe(false);
  });

  it("does not take Escape while it is closed", () => {
    const ev = keydown(document.body, "Escape");
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe("docsearch palette: rows", () => {
  it("gives a suggestion row an icon, as a document row has one", async () => {
    palette.open("");
    await type("install");
    const rows = [...document.querySelectorAll("#palette-listbox .ds-palette-row")];
    const suggestions = rows.filter((r) => r.id.startsWith("pal-s-"));
    const documents = rows.filter((r) => r.id.startsWith("pal-h-"));
    expect(suggestions.length).toBe(2);
    expect(documents.length).toBe(1);
    for (const row of [...suggestions, ...documents]) {
      expect(row.querySelector(".ds-palette-row-icon").innerHTML.trim()).not.toBe("");
    }
  });
});
