// SPDX-License-Identifier: Apache-2.0
// filesearch: listview.js — the folder a result row sits in. Fess writes url_link for the
// browser that asked, so for a file: document it is not a path and differs per User-Agent;
// the folder comes from the stored url.

import { describe, it, expect, beforeEach } from "vitest";
import { createListView } from "../themes/filesearch/assets/listview.js";
import { resetDom } from "./helpers/dom.js";

const URL = "file:/data/files/reports/q1.txt";

describe.each([
  ["Chromium", "file://data/files/reports/q1.txt"],
  ["Firefox", "file://///data/files/reports/q1.txt"],
  ["Safari", "file:////data/files/reports/q1.txt"],
])("scopeOfRow with the url_link %s gets for a file: document", (_browser, urlLink) => {
  let view;

  beforeEach(() => {
    resetDom();
    const list = document.createElement("ol");
    document.body.appendChild(list);
    view = createListView({ list, onSelect() {}, onTogglePreview() {}, onFocusTree() {} });
    view.render([{ doc_id: "d1", url: URL, url_link: urlLink }], {
      view: "details", queryId: "q", buildGoUrl: () => "#", actions: {},
    });
  });

  it("is the folder of the stored url", () => {
    expect(view.scopeOfRow(0)).toEqual({ type: "url", prefix: "file:/data/files/reports/" });
  });

  it("is null for a row that is not on the page", () => {
    expect(view.scopeOfRow(1)).toBeNull();
  });
});
