// SPDX-License-Identifier: Apache-2.0
// The harness must leave no timer running once a case ends.
//
// mosaic's home-hero.js types the home placeholder out character by character with a
// self-rescheduling window.setTimeout, so a booted mosaic always has a tick queued.
// Vitest tears the jsdom environment down when a file's last case ends; a tick that
// lands after that throws "ReferenceError: window is not defined" and fails the run
// even though every test passed — green locally, red on a slower machine. setup.js
// drains the queue after each case; this pins that it really stops the chain.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDom } from "./helpers/dom.js";
import { bootApp } from "./helpers/loadShell.js";
import { drainTimers } from "./setup.js";

describe("timer teardown", () => {
  beforeEach(() => resetDom());
  afterEach(() => vi.resetModules());

  it("stops the mosaic typewriter, so nothing fires after the window is gone", async () => {
    await bootApp("mosaic", { features: {}, notifications: {} });

    // Count what the page schedules from here on. The typewriter's own delays are
    // 32-1400ms, so an undrained chain re-arms itself well inside the window below.
    const real = window.setTimeout;
    let scheduled = 0;
    window.setTimeout = function (handler, delay, ...rest) {
      scheduled++;
      return real.call(window, handler, delay, ...rest);
    };
    try {
      drainTimers();
      await new Promise((resolve) => real.call(window, resolve, 500));
      expect(scheduled).toBe(0);
    } finally {
      window.setTimeout = real;
    }
  });
});
