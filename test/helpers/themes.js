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

/** Raw source of a theme's shipped index.html. */
export function readIndexHtml(theme) {
  return readFileSync(join(themesDir, theme, "index.html"), "utf8");
}

/**
 * Parse a theme's shipped index.html into a DETACHED Document via DOMParser —
 * no script execution, no subresource loading — for markup-contract assertions
 * that must observe the shipped attributes exactly as Fess serves them.
 *
 * @param {string} theme
 * @returns {Document}
 */
export function parseIndexHtml(theme) {
  return new DOMParser().parseFromString(readIndexHtml(theme), "text/html");
}

/**
 * Mount a theme's REAL shipped <body> markup into the live jsdom document, so a
 * behavioural test drives the theme's own modules against the exact DOM the
 * server delivers — initial classes and `hidden` attributes included. Asserting
 * against a hand-written fixture cannot see a markup/JS mismatch, which is the
 * whole point of the banner suite.
 *
 * <script> elements are dropped first: scripts inserted via innerHTML never
 * execute per spec, and removing them keeps jsdom from even considering the
 * /themes/<name>/assets/... srcs. Call this BEFORE importing app.js — that
 * module runs main() at import time.
 *
 * @param {string} theme
 * @returns {HTMLElement} document.body
 */
export function mountIndexBody(theme) {
  const doc = parseIndexHtml(theme);
  for (const s of doc.body.querySelectorAll("script")) s.remove();
  document.body.innerHTML = doc.body.innerHTML;
  return document.body;
}
