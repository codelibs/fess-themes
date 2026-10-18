// SPDX-License-Identifier: Apache-2.0
// The login modal: every theme ships the new-password form auth.js switches to, and the
// modal lock works across compat.js and auth.js. While login is required auth.js refuses
// hide.bs.modal, so compat.js (the themes' Bootstrap JS stand-in) must fire it from every
// way of closing the dialog. compat.js and auth.js behave the same in every theme
// (compat-modal.test.js, parity.test.js), so the lock runs once, on docuforge's copies.

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { themes, modulePath, mountIndexBody, parseIndexHtml } from "./helpers/themes.js";
import { resetDom } from "./helpers/dom.js";
import { loadAuth } from "./helpers/loadShell.js";

describe.each(themes)("%s: new-password step markup", (theme) => {
  it("sits hidden in the login form with the fields auth.js reads", () => {
    const doc = parseIndexHtml(theme);
    const step = doc.getElementById("password-change-step");
    expect(step).not.toBeNull();
    // One form for both steps: it stays on screen when a login switches to this step.
    expect(step.closest("#login-form")).not.toBeNull();
    expect(step.closest("#login-modal")).not.toBeNull();
    expect(step.classList.contains("d-none")).toBe(true);
    expect(step.querySelector("#password-change-error")).not.toBeNull();
    // The password inputs wait in templates until auth.js puts them into the form.
    const held = [...step.querySelectorAll("template.password-field")].map((tpl) => tpl.content.querySelector("input")?.id);
    expect(held).toEqual(["password-change-new", "password-change-confirm"]);
    expect(step.querySelector('input[type="password"]')).toBeNull();
    expect(step.querySelector('button[type="submit"]#password-change-submit')).not.toBeNull();
    expect(step.querySelector('[data-i18n="auth.password_change_required"]')).not.toBeNull();
  });

  it("keeps the login password out of the page until the modal opens", () => {
    const doc = parseIndexHtml(theme);
    const step = doc.getElementById("login-step");
    expect(step).not.toBeNull();
    expect(step.closest("#login-form")).not.toBeNull();
    const tpl = step.querySelector("template.password-field");
    expect(tpl.content.querySelector("#login-password")).not.toBeNull();
    expect(doc.querySelector('input[type="password"]')).toBeNull();
  });
});

describe("docuforge: login modal lock (compat.js + auth.js)", () => {
  beforeAll(() => {
    // Reduced motion makes hide() finish synchronously; compat.js reads it when it loads.
    window.matchMedia = () => ({ matches: true });
    // compat.js is a classic script: run it in the global scope, as the page does.
    (0, eval)(readFileSync(modulePath("docuforge", "compat.js"), "utf8"));
  });
  afterEach(() => {
    resetDom();
    vi.resetModules();
  });

  async function openLoginModal(config) {
    mountIndexBody("docuforge");
    const { mod } = await loadAuth("docuforge", config);
    await mod.attach();
    mod.promptLogin();
    return document.getElementById("login-modal");
  }

  it("stays open on Escape, the backdrop and hide() while login is required", async () => {
    const modal = await openLoginModal({ login_required: true, features: {} });
    expect(modal.classList.contains("show")).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.querySelector(".modal-backdrop").click();
    window.bootstrap.Modal.getOrCreateInstance(modal).hide();

    expect(modal.classList.contains("show")).toBe(true);
    for (const btn of modal.querySelectorAll('[data-bs-dismiss="modal"]')) {
      expect(btn.classList.contains("d-none")).toBe(true);
    }
  });

  it("closes when login is optional and returns to the login step", async () => {
    const modal = await openLoginModal({ features: {} });
    document.getElementById("login-step").classList.add("d-none");
    document.getElementById("password-change-step").classList.remove("d-none");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(modal.classList.contains("show")).toBe(false);
    expect(document.getElementById("login-step").classList.contains("d-none")).toBe(false);
    expect(document.getElementById("password-change-step").classList.contains("d-none")).toBe(true);
  });
});
