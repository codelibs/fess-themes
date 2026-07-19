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
      // would register untested modules at 0% and sink the gate. The loader in
      // helpers/themes.js imports by a plain file URL (NO ?t= cache-buster), so
      // the resolved path matches these globs — this is the coverage blind spot
      // that dropped router.js from the upstream (fess #3194) coverage table.
      include: ["themes/*/assets/format.js", "themes/*/assets/markdown.js"],
      // skipFull:false keeps 100%-covered files visible in the text table.
      // Without it, format.js (100%) is hidden and looks like the coverage
      // blind spot even though it is fully instrumented — so keep the row.
      reporter: [["text", { skipFull: false }], "text-summary"],
      // Regression gate on the aggregate. Set a few points below the achieved
      // numbers (stmts 98.32 / branches 94.48 / funcs 100 / lines 99.52) so
      // honest refactors don't trip it, while a real coverage drop fails.
      thresholds: {
        statements: 95,
        lines: 96,
        functions: 97,
        branches: 90,
      },
    },
  },
});
