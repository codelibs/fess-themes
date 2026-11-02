// SPDX-License-Identifier: Apache-2.0
// filesearch: treeview.js in browse mode (the home view's folder picker): the source is told
// to find folders without counting, and no count is drawn.

import { describe, it, expect, vi } from "vitest";
import { createTreeView } from "../themes/filesearch/assets/treeview.js";

function makeSource() {
  return {
    loadRoots: vi.fn(async () => ({ available: true, buckets: [{ value: "srv", count: 12 }], facetQuery: undefined, permissionState: "OK" })),
    loadChildren: vi.fn(async () => ({
      available: true, permissionState: "OK",
      fold: { children: [{ prefix: "smb://srv/a/", label: "a", count: null, scheme: "smb", showScheme: false }, { prefix: "smb://srv/b/", label: "b", count: null, scheme: "smb", showScheme: false }], direct: 0, total: 0, exact: true },
    })),
  };
}

async function mount(opts) {
  document.body.innerHTML = '<div id="t"></div><div id="s"></div>';
  const source = makeSource();
  const view = createTreeView({ root: document.getElementById("t"), status: document.getElementById("s"), source, getBase: () => ({ q: "" }), onSelect: () => {}, ...opts });
  await view.loadHome();
  document.querySelector(".fs-twisty").click();
  await vi.waitFor(() => expect(document.querySelectorAll("[role=treeitem]").length).toBe(3));
  return { source };
}

describe("tree view in browse mode", () => {
  it("asks the source to browse and draws no counts", async () => {
    const { source } = await mount({ browse: true });
    expect(source.loadChildren).toHaveBeenCalledWith({ q: "" }, { type: "host", host: "srv" }, expect.objectContaining({ browse: true }));
    expect(document.querySelectorAll(".fs-node-count").length).toBe(0);
  });

  it("by default counts the documents and draws the counts", async () => {
    const { source } = await mount({});
    expect(source.loadChildren.mock.calls[0][2].browse).toBe(false);
    expect(document.querySelectorAll(".fs-node-count").length).toBe(1);
  });
});
