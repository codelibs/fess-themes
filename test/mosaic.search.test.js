// SPDX-License-Identifier: Apache-2.0
// mosaic: the search page (see helpers/heroFamilySearch.js). The gallery tiles carry the `searcher`
// field the composition band is drawn from, so the rejected-search cases also check the band.

import { defineRejectedSearchTests, definePagerTests } from "./helpers/heroFamilySearch.js";

defineRejectedSearchTests("mosaic", { searcher: ["default", "multi_modal"] });
definePagerTests("mosaic");
