import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The shared theme JS (themes/<name>/assets/*.js) is authored as native ES
// modules that call browser APIs (document, window, URL, template, ...). jsdom
// supplies a spec-compliant DOM so the real, unmodified asset files are imported
// and executed here — a JVM JS engine cannot run ESM + these DOM APIs.
//
// Those asset files live under themes/ — OUTSIDE this test/ directory — so the
// Vitest root is the repository root. v8 only instruments files under the root,
// so pointing root at the repo root lets coverage measure the real shipped
// files while the tests import them by absolute file URL.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: repoRoot,
  // Keep Vite's cache inside the git-ignored test/node_modules rather than
  // creating a node_modules/.vite (or .vitest) at the repo root, which
  // root:repoRoot would otherwise do.
  cacheDir: fileURLToPath(new URL("./node_modules/.vitest", import.meta.url)),
  server: { fs: { allow: [repoRoot] } },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.js"],
    coverage: {
      provider: "v8",
      // Write file-emitting reporters into the git-ignored test/coverage rather
      // than <repoRoot>/coverage (reportsDirectory resolves relative to `root`,
      // which is the repo root here). The default text reporters below emit no
      // files, but this keeps any added file reporter out of the repo root.
      reportsDirectory: fileURLToPath(new URL("./coverage", import.meta.url)),
      // Instrument every matched module (all:true) so a theme whose copy is
      // never loaded still registers and cannot silently escape the gate.
      all: true,
      // ONLY the modules actually exercised below. A broad assets/*.js glob
      // would register untested modules at 0% and sink the gate. The loaders in
      // helpers/themes.js and helpers/loadSearch.js import by plain paths (NO ?t=
      // cache-buster), so the resolved path matches these globs — this is the
      // coverage blind spot that dropped router.js from the upstream (fess #3194)
      // coverage table.
      include: [
        "themes/*/assets/format.js",
        "themes/*/assets/markdown.js",
        "themes/*/assets/search.js",
      ],
      // codesearch's search.js is now driven by the runSearch()-pipeline tests in
      // search-flows.test.js (its own renderSummary / `hidden` / two-arg card
      // contract), so it counts toward the search.js gate along with the other nine
      // themes instead of being excluded as an untested permanent 0% file.
      // skipFull:false keeps 100%-covered files visible in the text table.
      // Without it, format.js (100%) is hidden and looks like the coverage
      // blind spot even though it is fully instrumented — so keep the row.
      reporter: [["text", { skipFull: false }], "text-summary"],
      // Per-glob regression gates. A single top-level global gate would apply the
      // SAME numbers to every included file (vitest 4 semantics), so search.js —
      // whose gate is lower than the fully-covered format/markdown pair — would drag
      // the combined aggregate down and fail the whole suite.
      //
      // format.js + markdown.js share one glob so the gate is their AGGREGATE, the
      // same shape the pre-search.js global gate had: markdown.js alone is 89.85%
      // branches, which only clears 90 because format.js (100%) is averaged in, so
      // splitting markdown.js into its own br90 key would fail on identical code.
      // search.js gets its own gate. search-flows.test.js now drives the whole
      // runSearch() pipeline (results / facets / pagination / chips / current filters /
      // options bar / related / favorites / error+empty paths) plus the type-ahead
      // suggest (attachSuggest) across all ten themes, on top of search.test.js's
      // card/facet/plainTitle unit cases, lifting the aggregate over all ten covered
      // themes to stmts 57.02 / branch 43.61 / funcs 55.36 / lines 61.68 (up from
      // ~9 / 7 / 8 / 10). The floor is set just under that, with ~1 point of slack, and
      // still fails loudly if a tested path loses coverage (e.g. a deleted behavioural
      // test). Full 100% search.js coverage remains out of scope — the untested
      // remainder is drawer/advanced-search wiring reached only via attach().
      thresholds: {
        "themes/*/assets/{format,markdown}.js": { statements: 95, lines: 96, functions: 97, branches: 90 },
        "themes/*/assets/search.js": { statements: 56, lines: 60, functions: 54, branches: 42 },
      },
    },
  },
});
