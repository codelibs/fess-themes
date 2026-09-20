// SPDX-License-Identifier: Apache-2.0
// Cancel the timers a booted theme leaves pending, so none of them fires after the
// file's jsdom window is gone.
//
// mosaic's home-hero.js types the home placeholder out character by character with a
// self-rescheduling window.setTimeout, so a booted mosaic always has a tick queued
// (bootApp in helpers/loadShell.js boots every theme for real, by design). When a
// file's last case ends, Vitest tears the jsdom environment down; a tick that lands
// after that evaluates `window.setTimeout` with no window left and throws
// "ReferenceError: window is not defined". Vitest reports that as an unhandled error
// and exits 1 even though every test passed — and whether the tick beats the teardown
// is a race, so the run is green locally and red on a slower CI machine.
//
// The queue is drained by wrapping the timer globals and remembering the handles:
// under this environment they are Node `Timeout` objects rather than the numeric ids
// the DOM spec describes, so walking an id range would clear nothing.
//
// Not a *.test.js file, so Vitest does not collect it as a suite; it is wired in as
// `setupFiles` in vitest.config.js and runs once per test file.

import { afterEach } from "vitest";

const timeouts = new Set();
const intervals = new Set();

const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;

globalThis.setTimeout = function setTimeout(handler, delay, ...args) {
  const handle = realSetTimeout.call(this, handler, delay, ...args);
  timeouts.add(handle);
  return handle;
};
globalThis.setInterval = function setInterval(handler, delay, ...args) {
  const handle = realSetInterval.call(this, handler, delay, ...args);
  intervals.add(handle);
  return handle;
};

/**
 * Cancel every timer scheduled since the last drain. Exported so
 * timer-teardown.test.js can prove it stops the typewriter chain — the hook below
 * cannot be observed by the case it cleans up after.
 */
export function drainTimers() {
  for (const handle of timeouts) clearTimeout(handle);
  for (const handle of intervals) clearInterval(handle);
  timeouts.clear();
  intervals.clear();
}

afterEach(drainTimers);
