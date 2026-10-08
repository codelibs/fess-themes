// SPDX-License-Identifier: Apache-2.0
// filesearch: what runSearch() leaves on the page.
//
//   - the document title carries the query literally (`$&`, `$$`)
//
// The cases are shared with the other themes that keep the bootstrap runSearch() contract
// (helpers/resultsContract.js).

import { defineTitleTests } from "./helpers/resultsContract.js";

const THEME = "filesearch";

defineTitleTests(THEME);
