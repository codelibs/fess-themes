// SPDX-License-Identifier: Apache-2.0
// Notification / error banner visibility.
//
// Every theme carries five banners whose visibility is owned by the shared JS
// through the `d-none` utility class ONLY — app.js's applyNotification() and
// renderHomeFlash(), and auth.js's login handlers, all toggle
// classList.add/remove("d-none") and never touch the `hidden` attribute:
//
//   #home-notification      app.js  renderNotifications() -> applyNotification()
//   #results-notification   app.js  renderNotifications() -> applyNotification()
//   #home-flash             app.js  renderHomeFlash()
//   #login-notification     auth.js attach()
//   #login-error            auth.js login submit handler
//
// A theme that additionally marks one of them with the `hidden` attribute in
// index.html makes it PERMANENTLY invisible: the JS fills in the text and drops
// `d-none`, but `[hidden] { display: none !important; }` still wins, so the user
// never sees the message. That was live in codesearch — a rejected login wrote
// "invalid credentials" into a box that could not render.
//
// The suites below lock both halves of the contract:
//   1. behaviourally — drive the real app.js / auth.js against each theme's REAL
//      shipped index.html body and assert the banner ends up in a renderable DOM
//      state (no `hidden` attribute AND no `d-none` class). jsdom does not apply
//      the theme's external stylesheet, so a computed `display` would prove
//      nothing; the attribute/class pair is the observable contract.
//   2. as a markup contract — the same five ids across all 10 themes must never
//      ship the `hidden` attribute, so the mismatch cannot come back.
//
// The final suite pins the OPPOSITE case: codesearch deliberately drives a few
// elements through the `hidden` DOM property (search.js: errBox.hidden,
// empty.hidden; app.js: item.hidden, scrim.hidden). Those MUST keep the
// attribute — stripping it as part of a blanket sweep would break them.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { themes, parseIndexHtml, mountIndexBody } from "./helpers/themes.js";
import { bootApp, loadAuth, settle } from "./helpers/loadShell.js";
import { resetDom } from "./helpers/dom.js";

/** The banners the shared JS reveals by removing `d-none`. */
const DNONE_BANNERS = [
  "home-notification",
  "results-notification",
  "home-flash",
  "login-notification",
  "login-error",
];

/** Assert an element is in a DOM state that can actually render. */
function expectRenderable(el, id, theme) {
  expect(el, `#${id} missing from themes/${theme}/index.html`).toBeTruthy();
  expect(
    el.hasAttribute("hidden"),
    `#${id} still carries the \`hidden\` attribute — [hidden]{display:none!important} keeps it invisible whatever the JS does`,
  ).toBe(false);
  expect(el.classList.contains("d-none"), `#${id} still carries the d-none class`).toBe(false);
}

describe.each(themes)("%s: config-driven notification banners", (theme) => {
  beforeEach(() => resetDom());
  afterEach(() => vi.resetModules());

  it("reveals #home-notification and #results-notification when one is configured", async () => {
    await bootApp(theme, {
      features: {},
      notifications: { search_top: "Scheduled maintenance on Sunday." },
    });
    for (const id of ["home-notification", "results-notification"]) {
      const el = document.getElementById(id);
      expect(el.textContent, `#${id} did not receive the configured message`).toContain(
        "Scheduled maintenance on Sunday.",
      );
      expectRenderable(el, id, theme);
    }
  });

  it("keeps both notification banners hidden when none is configured", async () => {
    await bootApp(theme, { features: {}, notifications: {} });
    for (const id of ["home-notification", "results-notification"]) {
      const el = document.getElementById(id);
      expect(el.textContent).toBe("");
      expect(el.classList.contains("d-none"), `#${id} should be hidden via d-none when empty`).toBe(true);
    }
  });

  it("reveals #home-flash when renderHomeFlash() writes a message", async () => {
    const { mod } = await bootApp(theme, { features: {}, notifications: {} });
    mod.renderHomeFlash("Login required to view this page.", "danger");
    const el = document.getElementById("home-flash");
    expect(el.textContent).toBe("Login required to view this page.");
    expectRenderable(el, "home-flash", theme);
  });
});

describe.each(themes)("%s: login modal banners", (theme) => {
  beforeEach(() => resetDom());
  afterEach(() => vi.resetModules());

  it("reveals #login-error when the server rejects the credentials", async () => {
    const { mod, post } = await loadAuth(theme, { features: {} });
    mountIndexBody(theme);
    await mod.attach();

    // The catch branch of the real submit handler, driven end to end.
    post.mockRejectedValueOnce({ code: "INVALID_CREDENTIALS", httpStatus: 401 });
    document.getElementById("login-username").value = "alice";
    document.getElementById("login-password").value = "wrong";
    document
      .getElementById("login-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();

    const el = document.getElementById("login-error");
    // i18n was never init()'d, so t() returns the key — proof the catch ran.
    expect(el.textContent).toBe("auth.error_invalid_credentials");
    expectRenderable(el, "login-error", theme);
  });

  it("reveals #login-notification when config.notifications.login is set", async () => {
    const { mod } = await loadAuth(theme, {
      features: {},
      notifications: { login: "Use your corporate account." },
    });
    mountIndexBody(theme);
    await mod.attach();

    const el = document.getElementById("login-notification");
    expect(el.textContent).toContain("Use your corporate account.");
    expectRenderable(el, "login-notification", theme);
  });

  it("leaves #login-error hidden via d-none before any login attempt", async () => {
    const { mod } = await loadAuth(theme, { features: {} });
    mountIndexBody(theme);
    await mod.attach();

    const el = document.getElementById("login-error");
    expect(el.textContent).toBe("");
    expect(el.classList.contains("d-none"), "#login-error must start hidden via d-none").toBe(true);
  });
});

describe.each(themes)("%s: d-none banner markup contract", (theme) => {
  it.each(DNONE_BANNERS)("#%s ships without the `hidden` attribute", (id) => {
    const el = parseIndexHtml(theme).getElementById(id);
    expect(el, `#${id} missing from themes/${theme}/index.html`).not.toBeNull();
    expect(
      el.hasAttribute("hidden"),
      `themes/${theme}/index.html #${id} is controlled by d-none, so a \`hidden\` attribute pins it invisible forever`,
    ).toBe(false);
  });
});

// The inverse contract, and the reason the fix above could not be a blanket
// "strip every hidden attribute" sweep: these elements are toggled through the
// `hidden` DOM property, so the attribute IS their control channel.
describe("codesearch: elements driven by the `hidden` DOM property keep it", () => {
  it.each([
    ["search-error", "search.js: errBox.hidden = true/false"],
    ["empty-state", "search.js: empty.hidden = true/false"],
    ["chat-nav-item", "app.js: item.hidden = false"],
    ["drawer-scrim", "app.js: scrim.hidden = true/false"],
  ])("#%s keeps its `hidden` attribute (%s)", (id) => {
    const el = parseIndexHtml("codesearch").getElementById(id);
    expect(el, `#${id} missing from themes/codesearch/index.html`).not.toBeNull();
    expect(el.hasAttribute("hidden")).toBe(true);
    expect(el.classList.contains("d-none"), `#${id} must not mix in the d-none channel`).toBe(false);
  });
});
