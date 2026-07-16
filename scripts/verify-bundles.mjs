// SPDX-License-Identifier: Apache-2.0
//
// verify-bundles.mjs — checks the locale-bundle contract of every static theme.
//
//   node scripts/verify-bundles.mjs            # every theme under themes/
//   node scripts/verify-bundles.mjs helpdesk   # one theme
//
// Exits non-zero if any theme fails. No dependencies: plain node, no install.
//
// WHY THIS EXISTS, AND WHY ONLY THESE CHECKS
//
// A missing i18n key does not fall back to English. i18n.js loads exactly one
// bundle and t() returns `messages[key] || key`, so a key present in
// messages.en.json but absent from messages.de.json puts the literal string
// "facets.empty" on the page for German users. The English fallback only fires
// when the whole bundle fails to fetch, never per key. Nothing about that is
// visible when reading a diff of 16 bundles times ~350 keys, and it has gone
// wrong before: codesearch shipped with keys missing from 14 of its 16 bundles
// and was repaired by hand in #27. This file is here so the next drift is
// caught by a machine instead of a user.
//
// Deliberately NOT checked here: anything asserting JavaScript behaviour by
// matching text (required element ids, "does runFromUrl() reset the facet
// state"). Those drift with any refactor and turn CI red for the wrong reason,
// and a check nobody trusts is worse than no check. Keep this file to facts
// that are true by inspection of the data itself.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolved from this file, not the caller's cwd, so it works from anywhere.
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const THEMES_DIR = join(REPO_ROOT, "themes");
const HELP_BUNDLES = 8; // themes/<name>/help/<locale>.json

/** Parse JSON, reporting the file with the error rather than a bare position. */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file}: invalid JSON — ${e.message}`);
  }
}

/**
 * Every key written at the top level of a JSON object, including ones written
 * more than once. JSON.parse keeps only the last of a repeated key, so the
 * parsed object cannot reveal a duplicate — the raw text is the only witness.
 *
 * This is a scanner rather than a regex on purpose. A line-anchored pattern
 * (`/^\s*"…":/m`) reads the same on pretty-printed input but finds only the
 * first key of a minified bundle, so reformatting a file to one line would
 * silently switch the duplicate check off while it kept reporting success. A
 * pattern that is not line-anchored has the opposite failure: it matches
 * `"…":` inside a value and invents duplicates that do not exist. Tracking
 * string literals and nesting depth has neither failure mode.
 */
function topLevelKeys(text) {
  const keys = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{" || c === "[") { depth++; continue; }
    if (c === "}" || c === "]") { depth--; continue; }
    if (c !== '"') continue;
    // A string literal: consume it, honouring backslash escapes, so that a
    // quote inside a value can never be mistaken for a delimiter.
    let j = i + 1;
    for (; j < text.length && text[j] !== '"'; j++) if (text[j] === "\\") j++;
    const raw = text.slice(i, j + 1);
    i = j;
    // It is a key only if a colon follows, and only at the object's top level.
    let k = j + 1;
    while (k < text.length && /\s/.test(text[k])) k++;
    if (depth === 1 && text[k] === ":") keys.push(JSON.parse(raw));
  }
  return keys;
}

/** @returns {string[]} keys written more than once in `file`. */
function duplicateKeys(file) {
  const seen = new Set();
  const dupes = new Set();
  for (const key of topLevelKeys(readFileSync(file, "utf8"))) {
    if (seen.has(key)) dupes.add(key);
    seen.add(key);
  }
  return [...dupes];
}

/** @returns {string[]} keys whose value is not a string. */
function nonStringValues(obj) {
  return Object.entries(obj).filter(([, v]) => typeof v !== "string").map(([k]) => k);
}

function localeOf(file, prefix, suffix) {
  return file.slice(prefix.length, file.length - suffix.length);
}

/**
 * The locales a theme actually serves, read from its own i18n.js.
 *
 * That list — not the file count, and not theme.yml#supportedLocales — is what
 * pickLocale() matches navigator.language against, so it is the only statement
 * of which bundles have to exist. Counting files instead would let a renamed
 * bundle through: messages.de.json becoming messages.xx.json keeps the count at
 * 16 while German silently disappears, which is precisely the invisible-in-a-
 * diff mistake this script is for.
 *
 * Throws rather than falling back to a guess: if this list cannot be read, the
 * expected set is unknown and every check below it would be meaningless.
 */
function supportedLocales(dir) {
  const file = join(dir, "assets", "i18n.js");
  if (!existsSync(file)) throw new Error(`${file}: not found — cannot tell which locales this theme serves`);
  const m = readFileSync(file, "utf8").match(/const SUPPORTED = (\[[^\]]*\])/);
  if (!m) throw new Error(`${file}: no 'const SUPPORTED = [...]' — cannot tell which locales this theme serves`);
  try {
    return new Set(JSON.parse(m[1]));
  } catch (e) {
    throw new Error(`${file}: SUPPORTED is not a JSON array — ${e.message}`);
  }
}

/** Set difference, reported both ways so a rename shows up as both halves. */
function compareLocales(label, expected, actual) {
  const errors = [];
  const missing = [...expected].filter(l => !actual.has(l)).sort();
  const unexpected = [...actual].filter(l => !expected.has(l)).sort();
  if (missing.length) errors.push(`${label}: no bundle for ${missing.join(", ")}`);
  if (unexpected.length) errors.push(`${label}: bundle for unserved locale ${unexpected.join(", ")}`);
  return errors;
}

/** @returns {string[]} failures; empty means the theme passes. */
function verifyTheme(name) {
  const dir = join(THEMES_DIR, name);
  const errors = [];

  const served = supportedLocales(dir);

  // --- i18n/messages.<locale>.json ---
  const i18nDir = join(dir, "i18n");
  const msgFiles = existsSync(i18nDir)
    ? readdirSync(i18nDir).filter(f => /^messages\..+\.json$/.test(f)).sort()
    : [];
  errors.push(...compareLocales("i18n", served, new Set(msgFiles.map(f => localeOf(f, "messages.", ".json")))));

  const bundles = new Map();
  for (const f of msgFiles) {
    const path = join(i18nDir, f);
    const msgs = readJson(path);
    bundles.set(localeOf(f, "messages.", ".json"), msgs);
    // Checked before duplicateKeys() is trusted — see its comment.
    const nested = nonStringValues(msgs);
    if (nested.length) errors.push(`i18n ${f}: expected a flat map of strings, but ${nested.join(", ")} is not a string`);
    const dupes = duplicateKeys(path);
    if (dupes.length) errors.push(`i18n ${f}: duplicate keys — ${dupes.join(", ")}`);
  }

  // Key parity across every shipped bundle, not just the ones theme.yml
  // declares: i18n.js matches navigator.language against its own 16-locale
  // list, so an undeclared bundle is still served to a real browser.
  //
  // This compares bundles against each other, so it catches a key that some
  // bundles have and others lack. It cannot catch a key deleted from ALL of
  // them while a t() call still asks for it — that renders as the raw key in
  // every locale, and finding it would mean scanning call sites, which is the
  // drift-prone kind of check this script stays out of.
  if (bundles.size) {
    const union = new Set([...bundles.values()].flatMap(Object.keys));
    // Sort by locale explicitly: the default comparator would stringify each
    // [locale, bundle] pair and compare "de,[object Object]".
    for (const [locale, msgs] of [...bundles].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      // hasOwn, not `in`: `in` walks the prototype chain, so a bundle missing a
      // key named "constructor" or "toString" would report it as present and
      // this check would pass on a genuinely broken bundle.
      const missing = [...union].filter(k => !Object.hasOwn(msgs, k)).sort();
      if (missing.length) {
        const shown = missing.slice(0, 5).join(", ");
        const rest = missing.length > 5 ? `, +${missing.length - 5} more` : "";
        errors.push(`i18n ${locale}: ${missing.length} key(s) missing — ${shown}${rest}`);
      }
    }
  }

  // --- help/<locale>.json ---
  const helpDir = join(dir, "help");
  const helpFiles = existsSync(helpDir)
    ? readdirSync(helpDir).filter(f => f.endsWith(".json")).sort()
    : [];
  // Help ships for a subset of the served locales, and help.js falls back to
  // help/en.json for the rest, so there is no list to derive the subset from —
  // hence a count. The names are still checked against the served locales,
  // which catches the typo a count cannot see.
  if (helpFiles.length !== HELP_BUNDLES) {
    errors.push(`expected ${HELP_BUNDLES} help bundles, found ${helpFiles.length}`);
  }
  const helpLocales = helpFiles.map(f => localeOf(f, "", ".json"));
  const stray = helpLocales.filter(l => !served.has(l)).sort();
  if (stray.length) errors.push(`help: bundle for unserved locale ${stray.join(", ")}`);

  // Section ids must match en.json's, in the same order: help.js renders
  // whatever each bundle lists, so a drifted id silently drops or reorders a
  // help section for that locale alone.
  const helpIds = new Map();
  for (const f of helpFiles) {
    const sections = readJson(join(helpDir, f)).sections;
    if (!Array.isArray(sections)) {
      errors.push(`help ${f}: missing a "sections" array`);
      continue;
    }
    helpIds.set(localeOf(f, "", ".json"), sections.map(s => s.id));
  }
  const refIds = helpIds.get("en");
  if (helpFiles.length && !refIds) {
    errors.push(`help: en.json is missing — no reference for section-id parity`);
  } else if (refIds) {
    for (const [locale, ids] of [...helpIds].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (locale === "en") continue;
      // Element-wise: order matters, and comparing joined strings would make
      // the result depend on a separator no id is guaranteed to avoid.
      if (ids.length !== refIds.length || ids.some((id, i) => id !== refIds[i])) {
        errors.push(`help ${locale}: section ids differ from en — [${ids}] vs [${refIds}]`);
      }
    }
  }

  return errors;
}

const requested = process.argv.slice(2);
// Dotfiles only: anything else without a theme.yml is a hard failure below,
// so a real theme can never be skipped by being unrecognised.
const themes = requested.length
  ? requested
  : readdirSync(THEMES_DIR).filter(f => !f.startsWith(".")).sort();
if (!themes.length) {
  console.error(`no themes found under ${THEMES_DIR}/`);
  process.exit(1);
}

let failed = 0;
for (const name of themes) {
  if (!existsSync(join(THEMES_DIR, name, "theme.yml"))) {
    console.error(`FAIL ${name}: not a theme (no theme.yml)`);
    failed++;
    continue;
  }
  // Report a broken file as this theme's failure and keep going: aborting the
  // run would hide every theme after it behind one unparseable bundle.
  let errors;
  try {
    errors = verifyTheme(name);
  } catch (e) {
    errors = [e.message];
  }
  if (errors.length) {
    failed++;
    console.error(`FAIL ${name}`);
    for (const e of errors) console.error(`       ${e}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

console.log(`\n${themes.length - failed}/${themes.length} themes ok`);
process.exit(failed ? 1 : 0);
