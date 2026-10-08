// SPDX-License-Identifier: Apache-2.0
// storefront: the search page (see helpers/heroFamilySearch.js). The product tiles have no favorite
// star (see the theme's README).

import {
  defineRejectedSearchTests, definePagerTests, defineSuggestKeyTests, defineLayoutTests,
} from "./helpers/heroFamilySearch.js";

defineRejectedSearchTests("storefront");
definePagerTests("storefront");
defineSuggestKeyTests("storefront");
defineLayoutTests("storefront");
