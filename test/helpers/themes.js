// SPDX-License-Identifier: Apache-2.0
// Shared helpers for the fess-themes JS tests.
//
// fess-themes ships one copy of each shared ES module per theme
// (themes/<name>/assets/<module>.js). These helpers enumerate the themes and
// load a given theme's own copy, so every suite can parametrize over all of
// them via describe.each — new themes are picked up automatically.
//
// Not a *.test.js file, so Vitest does not collect it as a suite.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// here = <repoRoot>/test/helpers → repo root is two levels up.
const repoRoot = resolve(here, "..", "..");
const themesDir = join(repoRoot, "themes");

/** Sorted list of theme directory names under themes/ (dynamically discovered). */
export const themes = readdirSync(themesDir)
  .filter((name) => statSync(join(themesDir, name)).isDirectory())
  .sort();

/** Absolute path to a theme's own copy of an asset module. */
export function modulePath(theme, moduleName) {
  return join(themesDir, theme, "assets", moduleName);
}

/**
 * Dynamically import a theme's own copy of an asset module.
 *
 * Imports via a plain pathToFileURL(...).href — deliberately WITHOUT a
 * cache-busting query string (`?t=...`). A query string makes the resolved URL
 * miss the coverage `include` glob, which is exactly how router.js silently
 * dropped out of the upstream (fess #3194) coverage. A plain file URL keeps the
 * resolved path equal to themes/<theme>/assets/<module>, so it is instrumented,
 * and the module's sibling `import "./format.js"` resolves naturally.
 *
 * @param {string} theme
 * @param {string} moduleName - e.g. "format.js"
 * @returns {Promise<object>} the module's exports
 */
export function loadModule(theme, moduleName) {
  return import(pathToFileURL(modulePath(theme, moduleName)).href);
}

/**
 * Read a theme's asset module as raw source text (for the parity test).
 *
 * @param {string} theme
 * @param {string} moduleName
 * @returns {string}
 */
export function readModuleSource(theme, moduleName) {
  return readFileSync(modulePath(theme, moduleName), "utf8");
}
