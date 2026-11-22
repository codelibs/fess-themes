// SPDX-License-Identifier: Apache-2.0
// A result's title and snippet carry dir="auto" so an Arabic or Hebrew hit reads right to left
// (the browser takes the direction of each block from its first strong character). The URL line
// is never given a direction of its own: it stays left to right.
//
// Rendered through runSearch() like search-flows.test.js; filesearch draws its rows with
// listview.js and codesearch keeps its code block left to right, so each has its own case.

import { describe, it, expect, beforeEach } from "vitest";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { resetDom, mountBody } from "./helpers/dom.js";
import { SEARCH_FIXTURE, FULL_CFG, SAMPLE_DOCS, installDispatch, settle } from "./helpers/searchFlow.js";
import { createListView } from "../themes/filesearch/assets/listview.js";

const ARABIC_DOC = {
  ...SAMPLE_DOCS[0],
  content_title: "<strong>المكتبة</strong> العامة",
  content_description: "هذه <strong>المكتبة</strong> فيها الكتب",
};

beforeEach(() => resetDom());

async function renderHit(theme) {
  const flow = await loadSearchFlow(theme, FULL_CFG);
  installDispatch(flow.get, {});
  mountBody(SEARCH_FIXTURE);
  flow.mod._state.q = "foo";
  await flow.mod.runSearch();
  await settle();
  return document.getElementById("results").firstElementChild;
}

describe.each(["docsearch", "docuforge", "nomadkit", "rawblock", "semanticlens", "voicebox"])(
  "result card [%s]",
  (theme) => {
    it("puts dir=auto on the title block and on the snippet block, not on the URL", async () => {
      const card = await renderHit(theme);
      expect(card.querySelector("h3.title").getAttribute("dir")).toBe("auto");
      expect(card.querySelector(".description").getAttribute("dir")).toBe("auto");
      expect(card.querySelector("cite").closest("[dir]")).toBeNull();
    });
  },
);

describe("result card [mosaic, list view]", () => {
  it("puts dir=auto on the title block and on the snippet block", async () => {
    localStorage.clear();
    const flow = await loadSearchFlow("mosaic", FULL_CFG);
    installDispatch(flow.get, {});
    mountBody(SEARCH_FIXTURE);
    flow.mod._state.q = "foo";
    flow.mod._state.viewMode = "list";
    await flow.mod.runSearch();
    await settle();
    const card = document.getElementById("results").firstElementChild;
    expect(card.querySelector("h3.title").getAttribute("dir")).toBe("auto");
    expect(card.querySelector(".description").getAttribute("dir")).toBe("auto");
  });
});

describe("result card [helpdesk]", () => {
  it("puts dir=auto on the title block and on the answer snippet", async () => {
    const card = await renderHit("helpdesk");
    expect(card.querySelector("h3.title").getAttribute("dir")).toBe("auto");
    expect(card.querySelector(".hd-answer").getAttribute("dir")).toBe("auto");
  });
});

describe("result card [codesearch]", () => {
  it("puts dir=auto on the title only; the code block is not given a direction", async () => {
    const card = await renderHit("codesearch");
    expect(card.querySelector(".result-title").getAttribute("dir")).toBe("auto");
    expect(card.querySelector("pre, .code-block, .codeblock")?.closest("[dir]") ?? null).toBeNull();
  });
});

describe.each(["storefront", "mosaic"])("result tile [%s]", (theme) => {
  it("puts dir=auto on the tile title", async () => {
    const card = await renderHit(theme);
    expect(card.querySelector(".tile__title").getAttribute("dir")).toBe("auto");
  });
});

describe("result row [filesearch]", () => {
  it("puts dir=auto on the name and on the snippet, not on the path", () => {
    const list = document.createElement("ol");
    document.body.appendChild(list);
    const view = createListView({ list, onSelect() {}, onTogglePreview() {}, onFocusTree() {} });
    view.render([{ ...ARABIC_DOC, url: "file:/data/ar01.txt", url_link: "file:///data/ar01.txt" }], {
      view: "details", queryId: "q", buildGoUrl: () => "#", actions: {},
    });
    expect(list.querySelector("a.fs-name").getAttribute("dir")).toBe("auto");
    expect(list.querySelector(".fs-snippet").getAttribute("dir")).toBe("auto");
    expect(list.querySelector("cite").closest("[dir]")).toBeNull();
  });
});
