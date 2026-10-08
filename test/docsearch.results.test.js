// SPDX-License-Identifier: Apache-2.0
// docsearch: what runSearch() leaves on the page.
//
//   - The document title carries the query literally (`$&`, `$$`)
//
// The cases are shared with the other themes that keep the bootstrap runSearch() contract
// (helpers/resultsContract.js).

import {
  defineTitleTests,
} from "./helpers/resultsContract.js";

const THEME = "docsearch";

defineTitleTests(THEME);
