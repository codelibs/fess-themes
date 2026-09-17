// SPDX-License-Identifier: Apache-2.0
// compat.js re-implements the Bootstrap 5 Modal API. Like Bootstrap, hide() must fire a
// cancelable hide.bs.modal before closing and hidden.bs.modal after: auth.js keeps the
// login modal open while login is required by preventing hide.bs.modal, and resets the
// form on hidden.bs.modal.
//
// compat.js is a classic script that installs document-level listeners, so each case
// runs it in its own JSDOM window instead of the shared test document.

import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { themes, modulePath } from "./helpers/themes.js";

const MARKUP = `<!DOCTYPE html><html><body>
  <div class="modal" id="m" style="display: none">
    <button type="button" id="dismiss" data-bs-dismiss="modal">x</button>
  </div>
</body></html>`;

/** A fresh window with the theme's compat.js loaded; reduced motion makes hide() synchronous. */
function bootCompat(theme) {
  const dom = new JSDOM(MARKUP, { runScripts: "outside-only" });
  const { window } = dom;
  window.matchMedia = () => ({ matches: true });
  window.eval(readFileSync(modulePath(theme, "compat.js"), "utf8"));
  const modal = window.document.getElementById("m");
  const instance = window.bootstrap.Modal.getOrCreateInstance(modal);
  instance.show();
  return { window, modal, instance };
}

describe.each(themes)("%s: compat.js Modal events", (theme) => {
  it("fires hide.bs.modal, closes, then fires hidden.bs.modal", () => {
    const { modal, instance } = bootCompat(theme);
    const order = [];
    modal.addEventListener("hide.bs.modal", (ev) => order.push(["hide", ev.cancelable]));
    modal.addEventListener("hidden.bs.modal", () => order.push(["hidden", modal.style.display]));
    instance.hide();
    expect(order).toEqual([["hide", true], ["hidden", "none"]]);
    expect(modal.classList.contains("show")).toBe(false);
  });

  it("stays open when hide.bs.modal is prevented, from every way of closing it", () => {
    const { window, modal, instance } = bootCompat(theme);
    let hidden = 0;
    modal.addEventListener("hide.bs.modal", (ev) => ev.preventDefault());
    modal.addEventListener("hidden.bs.modal", () => { hidden += 1; });

    instance.hide();
    window.document.getElementById("dismiss").click();
    window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    window.document.querySelector(".modal-backdrop").click();

    expect(modal.classList.contains("show")).toBe(true);
    expect(window.document.querySelector(".modal-backdrop")).not.toBeNull();
    expect(hidden).toBe(0);
  });
});
