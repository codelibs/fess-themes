// SPDX-License-Identifier: Apache-2.0
// docsearch: what runSearch() leaves on the page.
//
//   - The document title carries the query literally (`$&`, `$$`)
//   - The status line's "(0.06 seconds)" reads `exec_time` (a decimal string on the v2 API)
//   - The pager is made of real links with aria-current and page names
//
// The cases are shared with the other themes that keep the bootstrap runSearch() contract
// (helpers/resultsContract.js).

import {
  defineExecTimeTests, defineTitleTests, definePagerTests,
} from "./helpers/resultsContract.js";

const THEME = "docsearch";

defineExecTimeTests(THEME);
defineTitleTests(THEME);
definePagerTests(THEME);
