# fess-themes — theme JavaScript unit tests

Executable unit tests for the shared JavaScript that ships inside every theme
(`themes/<name>/assets/*.js`).

## What this is

Every theme under `themes/<name>/` carries its own copy of the same shared ES
modules (`format.js`, `markdown.js`, ...). These tests **import and run each
theme's real, unmodified copy** and assert on its behaviour — not on its source
text. A source string-match cannot observe what the code actually *does*: a
heading regex can be present in `markdown.js` yet produce output that the
`format.js` sanitizer strips before display. Every suite parametrizes over all
10 themes (`describe.each`), so each theme's own copy is exercised, and new
themes are picked up automatically.

The suites:

- `format.test.js` — `escapeHtml`, `isSafeHref`, `sanitizeHtml` (asserts **H1–H6
  are all preserved** — the regression the H1/H5/H6 fix restores), `formatFileSize`,
  `formatDate`, `renderHighlightedSnippet`.
- `markdown.test.js` — `parseMarkdown`: headings, lists, blockquotes, tables,
  horizontal rules, inline/fenced code, and safe-vs-unsafe autolinks.
- `pipeline.test.js` — the real chat pipeline `parseMarkdown() -> sanitizeHtml()`,
  asserting every heading level survives to the DOM and that dangerous payloads
  (a `javascript:` link, raw `<script>`, an `onerror` attribute) are neutralized
  end to end.
- `parity.test.js` — locks the cross-theme invariant that all 10 copies of
  `format.js` (and of `markdown.js`) are byte-identical except their per-theme
  line-2 comment. Nothing else in the repo enforces this.

## Not shipped

This `test/` directory is **not** part of any theme ZIP. `scripts/package.sh`
zips only `themes/<name>/`, so nothing here (its `package.json`, `node_modules/`,
or coverage output) is ever distributed or served. The modules are authored as
native ES modules that call browser APIs (`document`, `window`, `URL`,
`<template>`); a JVM JS engine cannot run them, so the tests run on Node with
[vitest](https://vitest.dev) and a [jsdom](https://github.com/jsdom/jsdom) DOM.

## Running

```bash
cd test
npm install   # or: npm ci   (needs network; generates/uses package-lock.json)
npm test
```

`npm test` runs the suite under V8 coverage and enforces the thresholds declared
in `vitest.config.js` (it fails if coverage of `format.js` / `markdown.js` drops
below them). CI runs the same command via `.github/workflows/theme-js.yml`
(Node 22, `npm ci` against the committed `package-lock.json`). These tests are
independent of `scripts/verify-bundles.mjs` (the locale-bundle contract) and of
the Maven-less packaging flow.

## Layout

```
test/
├── package.json / package-lock.json / vitest.config.js
├── helpers/
│   ├── themes.js   # enumerate themes; load a theme's own asset module (no cache-bust query)
│   └── dom.js      # serialise a sanitized DocumentFragment for assertions
├── format.test.js  markdown.test.js  pipeline.test.js
└── parity.test.js
```

Tests import the shipped files by absolute file URL; they are never copied.
`i18n.js` / `error.js` are intentionally **not** covered here: `i18n.js` diverges
across themes (no parity to lock) and `error.js`, though identical across themes,
exposes only a DOM-mutating `attach()` (its path→code mapping is module-private),
so there is no clean pure function to assert on.
