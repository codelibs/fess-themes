// SPDX-License-Identifier: Apache-2.0
// helpdesk: the status line's "(0.06 seconds)" reads `exec_time`, which the v2 API sends as a
// decimal string (the cases are shared with the other themes that keep the bootstrap result DOM,
// helpers/resultsContract.js).

import { defineExecTimeTests } from "./helpers/resultsContract.js";

defineExecTimeTests("helpdesk");
