// SPDX-License-Identifier: Apache-2.0
// semanticlens: the search page (see helpers/heroFamilySearch.js). What a rejected search, the exec
// time and the title leave on the page is covered in semanticlens.results.test.js.

import {
  definePagerTests, defineSuggestKeyTests, defineFavoriteTests, defineLayoutTests,
} from "./helpers/heroFamilySearch.js";

definePagerTests("semanticlens");
defineSuggestKeyTests("semanticlens");
defineFavoriteTests("semanticlens");
defineLayoutTests("semanticlens");
