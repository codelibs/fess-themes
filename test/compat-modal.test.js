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
  <a href="login" id="opener" data-bs-toggle="modal" data-bs-target="#m">Login</a>
  <button type="button" id="elsewhere">elsewhere</button>
  <div class="modal" id="m" style="display: none">
    <input id="field">
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

/** A fresh window whose modal is still closed, so a case can choose how it is opened. */
function bootClosed(theme) {
  const dom = new JSDOM(MARKUP, { runScripts: "outside-only" });
  const { window } = dom;
  window.matchMedia = () => ({ matches: true });
  window.eval(readFileSync(modulePath(theme, "compat.js"), "utf8"));
  const modal = window.document.getElementById("m");
  return { window, modal, instance: window.bootstrap.Modal.getOrCreateInstance(modal) };
}

const escape = (window) =>
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

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

  it("fires show.bs.modal before it opens and shown.bs.modal once it is open", () => {
    const { modal, instance } = bootClosed(theme);
    const order = [];
    modal.addEventListener("show.bs.modal", (ev) => order.push(["show", ev.cancelable, modal.classList.contains("show")]));
    modal.addEventListener("shown.bs.modal", () => order.push(["shown", modal.classList.contains("show")]));
    instance.show();
    expect(order).toEqual([["show", true, false], ["shown", true]]);
  });

  it("stays closed when show.bs.modal is prevented", () => {
    const { window, modal, instance } = bootClosed(theme);
    let shown = 0;
    modal.addEventListener("show.bs.modal", (ev) => ev.preventDefault());
    modal.addEventListener("shown.bs.modal", () => { shown += 1; });
    instance.show();
    expect(modal.classList.contains("show")).toBe(false);
    expect(window.document.querySelector(".modal-backdrop")).toBeNull();
    expect(shown).toBe(0);
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

  describe("focus after the dialog closes", () => {
    it("returns to the control that had the focus when it opened (Escape)", () => {
      const { window, modal, instance } = bootClosed(theme);
      const opener = window.document.getElementById("opener");
      opener.focus();
      instance.show();
      expect(modal.contains(window.document.activeElement)).toBe(true);

      escape(window);

      expect(modal.classList.contains("show")).toBe(false);
      expect(window.document.activeElement).toBe(opener);
    });

    it("returns to the trigger of a data-bs-toggle click even when the click did not focus it", () => {
      // Safari does not focus a link or a button on click, so activeElement is <body> then.
      const { window, modal } = bootClosed(theme);
      const opener = window.document.getElementById("opener");
      opener.click();
      expect(modal.classList.contains("show")).toBe(true);

      window.document.getElementById("dismiss").click();

      expect(window.document.activeElement).toBe(opener);
    });

    it("returns after the backdrop and hide() close it as well", () => {
      const { window, instance } = bootClosed(theme);
      const opener = window.document.getElementById("opener");
      opener.focus();
      instance.show();
      window.document.querySelector(".modal-backdrop").click();
      expect(window.document.activeElement).toBe(opener);

      instance.show();
      instance.hide();
      expect(window.document.activeElement).toBe(opener);
    });

    it("does not pull the focus back when the user already moved it elsewhere", () => {
      const { window, instance } = bootClosed(theme);
      window.document.getElementById("opener").focus();
      instance.show();
      const elsewhere = window.document.getElementById("elsewhere");
      elsewhere.focus();

      instance.hide();

      expect(window.document.activeElement).toBe(elsewhere);
    });

    it("leaves the focus alone when the opener is gone (login removes its own button)", () => {
      const { window, instance } = bootClosed(theme);
      const opener = window.document.getElementById("opener");
      opener.focus();
      instance.show();
      window.document.getElementById("m").addEventListener("hidden.bs.modal", () => opener.remove());

      expect(() => instance.hide()).not.toThrow();

      expect(window.document.activeElement).not.toBe(opener);
    });

    it("forgets the opener of the previous opening", () => {
      const { window, instance } = bootClosed(theme);
      const opener = window.document.getElementById("opener");
      opener.focus();
      instance.show();
      instance.hide();
      window.document.getElementById("elsewhere").focus();
      // Opened by script with the focus on <elsewhere>: that is what comes back, not <opener>.
      instance.show();
      instance.hide();
      expect(window.document.activeElement).toBe(window.document.getElementById("elsewhere"));
    });
  });
});

// The login prompt hides the close button while login is required. That button comes first in the markup:
// focusing it does nothing, so the focus used to stay on the page behind the dialog.
describe.each(themes)("%s: compat.js Modal initial focus", (theme) => {
  function bootWith(body) {
    const dom = new JSDOM(`<!DOCTYPE html><html><body><div class="modal" id="m" style="display: none">${body}</div></body></html>`, { runScripts: "outside-only" });
    const { window } = dom;
    window.matchMedia = () => ({ matches: true });
    window.eval(readFileSync(modulePath(theme, "compat.js"), "utf8"));
    const modal = window.document.getElementById("m");
    window.bootstrap.Modal.getOrCreateInstance(modal).show();
    return { window, modal };
  }

  it("skips a hidden close button and focuses the first displayed control", () => {
    const { window } = bootWith('<button type="button" id="close" style="display: none">x</button><input id="user"><input id="pass">');
    expect(window.document.activeElement.id).toBe("user");
  });

  it("skips a control inside a hidden container", () => {
    const { window } = bootWith('<div style="display: none"><input id="hidden"></div><input id="user">');
    expect(window.document.activeElement.id).toBe("user");
  });

  it("focuses the dialog itself when no control is displayed", () => {
    const { window, modal } = bootWith('<button type="button" id="close" style="display: none">x</button>');
    expect(window.document.activeElement).toBe(modal);
  });
});

// Tab and Shift+Tab stay inside the open dialog (the focus used to leave it for the page behind the backdrop).
describe.each(themes)("%s: compat.js Modal focus trap", (theme) => {
  function boot() {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <button id="behind">behind</button>
      <div class="modal" id="m" style="display: none">
        <button type="button" id="close" style="display: none">x</button>
        <input id="first"><input id="second"><button type="button" id="last">ok</button>
      </div><a href="#" id="after">after</a></body></html>`, { runScripts: "outside-only" });
    const { window } = dom;
    window.matchMedia = () => ({ matches: true });
    window.eval(readFileSync(modulePath(theme, "compat.js"), "utf8"));
    window.bootstrap.Modal.getOrCreateInstance(window.document.getElementById("m")).show();
    return window;
  }
  const tab = (window, shift = false) => {
    const ev = new window.KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true, cancelable: true });
    window.document.dispatchEvent(ev);
    return ev;
  };

  it("wraps from the last displayed control to the first", () => {
    const window = boot();
    window.document.getElementById("last").focus();
    const ev = tab(window);
    expect(ev.defaultPrevented).toBe(true);
    expect(window.document.activeElement.id).toBe("first");
  });

  it("wraps from the first displayed control to the last with Shift+Tab", () => {
    const window = boot();
    expect(window.document.activeElement.id).toBe("first");
    const ev = tab(window, true);
    expect(ev.defaultPrevented).toBe(true);
    expect(window.document.activeElement.id).toBe("last");
  });

  it("brings a focus that is outside the dialog back in", () => {
    const window = boot();
    window.document.getElementById("behind").focus();
    tab(window);
    expect(window.document.activeElement.id).toBe("first");
  });

  it("leaves Tab alone between two controls of the dialog and when no dialog is open", () => {
    const window = boot();
    expect(tab(window).defaultPrevented).toBe(false);
    window.bootstrap.Modal.getOrCreateInstance(window.document.getElementById("m")).hide();
    window.document.getElementById("behind").focus();
    expect(tab(window).defaultPrevented).toBe(false);
  });
});
