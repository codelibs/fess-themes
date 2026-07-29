// SPDX-License-Identifier: Apache-2.0
// The shared JS must branch on the error codes the v2 API actually puts on the wire.
//
// Fess declares them in V2ErrorCode, and every wire code is lowercase snake_case
// ("auth_required", "rate_limited", "invalid_request", ...). V2EnvelopeWriter copies
// `code.code()` onto the envelope verbatim, and each theme's api.js copies it onto the
// thrown ApiError verbatim (`new ApiError(err.code || "UNKNOWN", ...)`) — no theme
// normalises the case anywhere. So a branch written against the SCREAMING_SNAKE_CASE
// Java enum *name* can never match, and the user silently gets the wrong message.
//
// Most of these branches carry an `|| e.httpStatus === 401 / 429` fallback that masks
// the mismatch, so every case below supplies the code and NO httpStatus: the code arm
// is then the only thing under test and the assertion is falsifiable. The one arm with
// no fallback at all is search.js's `error.auth_required` message, where a failed
// authentication currently degrades to a generic "error.server".
//
// Each suite parametrizes over all 10 themes so no copy of a shared module can drift
// back, and new themes are picked up automatically.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { themes, mountIndexBody } from "./helpers/themes.js";
import { loadAuth, loadProfile, settle } from "./helpers/loadShell.js";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { resetDom, mountBody, setLocation } from "./helpers/dom.js";
import { SEARCH_FIXTURE, FULL_CFG, installDispatch } from "./helpers/searchFlow.js";

/** Submit an already-mounted form the way a user would. */
const submit = (id) =>
  document.getElementById(id).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

beforeEach(() => {
  resetDom();
  // runSearch's render path scrolls to top; jsdom has no scrollTo.
  window.scrollTo = () => {};
});
afterEach(() => {
  vi.resetModules();
  setLocation("/");
});

// ─── auth.js ────────────────────────────────────────────────────────────────────

describe.each(themes)("%s: auth.js branches on the v2 wire codes", (theme) => {
  it("treats auth_required from /auth/me as logged out, and stays silent", async () => {
    const { mod, get } = await loadAuth(theme, { features: {} });
    mountIndexBody(theme);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    get.mockRejectedValueOnce({ code: "auth_required" });

    const result = await mod.probeMe();

    // Both the auth_required branch and the generic "unexpected error" fallback
    // below it log the user out and return null, so the return value alone cannot
    // tell them apart. The expected-and-silent branch is the one that does NOT
    // warn — that is the observable contract this pins.
    expect(result).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("shows the rate-limit message when login is rejected with rate_limited", async () => {
    const { mod, post } = await loadAuth(theme, { features: {} });
    mountIndexBody(theme);
    await mod.attach();

    post.mockRejectedValueOnce({ code: "rate_limited" });
    document.getElementById("login-username").value = "alice";
    document.getElementById("login-password").value = "pw";
    submit("login-form");
    await settle();

    // i18n was never init()'d, so t() returns the key verbatim.
    expect(document.getElementById("login-error").textContent).toBe("auth.error_rate_limited");
  });
});

// ─── profile.js ─────────────────────────────────────────────────────────────────

describe.each(themes)("%s: profile.js branches on the v2 wire codes", (theme) => {
  /** Mount the real password form, reject the POST, return #profile-error. */
  async function passwordErrorFor(rejection) {
    const { mod, post } = await loadProfile(theme);
    mountBody('<div id="profile-view"></div>');
    mod.attach();

    post.mockRejectedValueOnce(rejection);
    document.getElementById("old-password").value = "current";
    document.getElementById("new-password").value = "newpass1";
    document.getElementById("confirm-password").value = "newpass1";
    submit("password-form");
    await settle();

    return document.getElementById("profile-error");
  }

  it("maps rate_limited to the rate-limit message", async () => {
    const err = await passwordErrorFor({ code: "rate_limited" });
    expect(err.textContent).toBe("auth.error_rate_limited");
    expect(err.classList.contains("d-none")).toBe(false);
  });

  it("maps auth_required to the wrong-current-password message", async () => {
    const err = await passwordErrorFor({ code: "auth_required" });
    expect(err.textContent).toBe("profile.error_wrong_current");
    expect(err.classList.contains("d-none")).toBe(false);
  });
});

// ─── search.js ──────────────────────────────────────────────────────────────────

describe.each(themes)("%s: search.js branches on the v2 wire codes", (theme) => {
  it("shows error.auth_required when /search fails with auth_required", async () => {
    const { mod, get } = await loadSearchFlow(theme, FULL_CFG);
    installDispatch(get);
    mountBody(SEARCH_FIXTURE);
    mod._state.q = "foo";

    get.mockRejectedValueOnce(Object.assign(new Error("auth"), { code: "auth_required" }));
    await mod.runSearch();

    // No httpStatus fallback exists on this arm: the code string alone separates a
    // "please sign in" message from a misleading generic server error.
    expect(document.getElementById("search-error").textContent).toBe("error.auth_required");
  });
});
