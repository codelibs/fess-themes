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

describe.each(themes)("%s: new-password form markup", (theme) => {
  it("sits hidden in the login modal with the fields auth.js reads", () => {
    const doc = parseIndexHtml(theme);
    const form = doc.getElementById("password-change-form");
    expect(form).not.toBeNull();
    expect(form.closest("#login-modal")).not.toBeNull();
    expect(form.classList.contains("d-none")).toBe(true);
    for (const id of ["password-change-error", "password-change-new", "password-change-confirm"]) {
      expect(form.querySelector("#" + id), id).not.toBeNull();
    }
    expect(form.querySelector('button[type="submit"]')).not.toBeNull();
    expect(form.querySelector('[data-i18n="auth.password_change_required"]')).not.toBeNull();
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

  it("closes when login is optional and returns to the login form", async () => {
    const modal = await openLoginModal({ features: {} });
    document.getElementById("login-form").classList.add("d-none");
    document.getElementById("password-change-form").classList.remove("d-none");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(modal.classList.contains("show")).toBe(false);
    expect(document.getElementById("login-form").classList.contains("d-none")).toBe(false);
    expect(document.getElementById("password-change-form").classList.contains("d-none")).toBe(true);
  });
});
