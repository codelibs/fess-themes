// SPDX-License-Identifier: Apache-2.0
// mosaic: the search page (see helpers/heroFamilySearch.js). The gallery tiles carry the `searcher`
// field the composition band is drawn from, so the rejected-search cases also check the band. The
// favorite star is drawn on the list view's cards only.

import {
  defineRejectedSearchTests, definePagerTests, defineSuggestKeyTests, defineFavoriteTests,
} from "./helpers/heroFamilySearch.js";

defineRejectedSearchTests("mosaic", { searcher: ["default", "multi_modal"] });
definePagerTests("mosaic");
defineSuggestKeyTests("mosaic");
defineFavoriteTests("mosaic", { listView: true });
