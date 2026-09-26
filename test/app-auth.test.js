// SPDX-License-Identifier: Apache-2.0
// app.js and login (JSP parity): the login.required gate at boot, and what a login, a
// logout and a lost session do to the page. Each case boots a theme's real app.js, with
// its real auth.js, router.js and search.js, against its shipped index.html; api.js,
// router.redirect() and the Bootstrap modal are doubles. detach() removes the listeners a
// boot added, so a theme booted earlier never answers the events a later case sends.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { themes } from "./helpers/themes.js";
import { resetDom, setLocation } from "./helpers/dom.js";
import { bootApp, settle } from "./helpers/loadShell.js";

/** api.get: /auth/me reports `user` (a guest when null); every other endpoint answers {}. */
const answerMe = (user) => async (path) =>
  path === "/auth/me" ? (user ? { authenticated: true, user } : { authenticated: false }) : {};
const searched = (get) => get.mock.calls.some((c) => c[0] === "/search");

let app;
let show;

beforeEach(() => {
  resetDom();
  sessionStorage.clear();
  window.scrollTo = () => {};
  show = vi.fn();
  vi.stubGlobal("bootstrap", { Modal: { getOrCreateInstance: vi.fn(() => ({ show, hide: vi.fn() })) } });
});
afterEach(() => {
  if (app) app.detach();
  app = undefined;
  vi.unstubAllGlobals();
  vi.resetModules();
  setLocation("/");
});

describe.each(themes)("%s: app.js and login", (theme) => {
  async function boot(config, user, post) {
    app = await bootApp(theme, { features: {}, notifications: {}, ...config }, { get: answerMe(user), post });
    return app;
  }

  it("asks a guest to log in instead of searching when login is required", async () => {
    setLocation("/search?q=foo");
    const { get } = await boot({ login_required: true }, null);
    expect(searched(get)).toBe(false);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("searches for a logged-in user when login is required", async () => {
    setLocation("/search?q=foo");
    const { get } = await boot({ login_required: true }, { name: "alice" });
    expect(searched(get)).toBe(true);
    expect(show).not.toHaveBeenCalled();
  });

  it("fetches the config again and re-runs the route after a login", async () => {
    setLocation("/search?q=foo");
    const { get, apiInit } = await boot({}, null);
    get.mockClear();
    document.dispatchEvent(new CustomEvent("fess:auth:login"));
    await settle();
    expect(apiInit).toHaveBeenCalledTimes(2);
    expect(searched(get)).toBe(true);
  });

  it("re-runs the route after a logout and forgets the remembered page size", async () => {
    setLocation("/search?q=foo");
    const { apiInit } = await boot({}, null);
    sessionStorage.setItem("fess.search.num", "50");
    document.dispatchEvent(new CustomEvent("fess:auth:logout", { detail: { redirecting: false } }));
    await settle();
    expect(apiInit).toHaveBeenCalledTimes(2);
    // codesearch pages 20 results at a time and remembers no page size.
    expect(sessionStorage.getItem("fess.search.num")).toBe(theme === "codesearch" ? "50" : null);
  });

  it("leaves for the identity provider's logout without fetching the config or re-gating", async () => {
    setLocation("/");
    const post = async () => ({ redirect_url: "https://idp.example.com/slo?x=1" });
    const { apiInit, redirect } = await boot(
      { login_required: true, features: { sso_enabled: true, login_link: "sso/" } }, { name: "alice" }, post);
    expect(redirect).not.toHaveBeenCalled();

    document.getElementById("logout-btn").click();
    await settle();

    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("https://idp.example.com/slo?x=1");
    expect(apiInit).toHaveBeenCalledTimes(1);
  });

  it("asks for login again when a search reports that the session is gone", async () => {
    setLocation("/search?q=foo");
    await boot({ login_required: true }, { name: "alice" });
    document.dispatchEvent(new CustomEvent("fess:auth:required"));
    await settle();
    expect(show).toHaveBeenCalledTimes(1);
    expect(document.getElementById("logout-btn")).toBeNull();
  });

  it("ignores a lost session when login is optional", async () => {
    setLocation("/search?q=foo");
    await boot({}, { name: "alice" });
    document.dispatchEvent(new CustomEvent("fess:auth:required"));
    await settle();
    expect(show).not.toHaveBeenCalled();
    expect(document.getElementById("logout-btn")).not.toBeNull();
  });
});

describe.each(themes.filter((t) => t !== "codesearch"))("%s: home search", (theme) => {
  it("carries the drawer's labels into the first search", async () => {
    setLocation("/");
    app = await bootApp(theme, {
      features: { display_label_type: true },
      notifications: {},
      label_options: [{ value: "lblA", name: "Label A" }, { value: "lblB", name: "Label B" }],
    });
    document.getElementById("labelSearchOption").value = "lblA";
    document.getElementById("contentQuery").value = "hello";
    document.getElementById("home-search-form").dispatchEvent(new Event("submit", { cancelable: true }));

    const params = new URLSearchParams(location.search);
    expect(location.pathname).toBe("/search");
    expect(params.get("q")).toBe("hello");
    expect(params.getAll("fields.label")).toEqual(["lblA"]);
  });
});
