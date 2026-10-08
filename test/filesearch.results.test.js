// SPDX-License-Identifier: Apache-2.0
// filesearch: what runSearch() leaves on the page.
//
//   - the document title carries the query literally (`$&`, `$$`)
//   - the status line's "(0.06 seconds)" reads `exec_time` (a decimal string on the v2 API)
//
// The cases are shared with the other themes that keep the bootstrap runSearch() contract
// (helpers/resultsContract.js).

import { defineExecTimeTests, defineTitleTests } from "./helpers/resultsContract.js";

const THEME = "filesearch";

defineExecTimeTests(THEME);
defineTitleTests(THEME);
