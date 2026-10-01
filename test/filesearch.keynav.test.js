// SPDX-License-Identifier: Apache-2.0
// filesearch: keynav.js — the keyboard model of the result list, the folder tree and the
// page, as pure functions from (key, state) to an action.

import { describe, it, expect } from "vitest";
import { listKey, treeKey, globalKey, isEditable } from "../themes/filesearch/assets/keynav.js";

describe("listKey", () => {
  it("moves one row at a time and stops at the ends", () => {
    expect(listKey({ key: "ArrowDown", index: 0, count: 3 })).toEqual({ type: "move", index: 1 });
    expect(listKey({ key: "ArrowDown", index: 2, count: 3 })).toEqual({ type: "move", index: 2 });
    expect(listKey({ key: "ArrowUp", index: 2, count: 3 })).toEqual({ type: "move", index: 1 });
    expect(listKey({ key: "ArrowUp", index: 0, count: 3 })).toEqual({ type: "move", index: 0 });
  });

  it("starts at the first row when nothing is active", () => {
    expect(listKey({ key: "ArrowDown", index: -1, count: 3 })).toEqual({ type: "move", index: 0 });
    expect(listKey({ key: "ArrowUp", index: -1, count: 3 })).toEqual({ type: "move", index: 0 });
  });

  it("jumps with Home, End, PageUp and PageDown", () => {
    expect(listKey({ key: "Home", index: 5, count: 30 })).toEqual({ type: "move", index: 0 });
    expect(listKey({ key: "End", index: 5, count: 30 })).toEqual({ type: "move", index: 29 });
    expect(listKey({ key: "PageDown", index: 5, count: 30 })).toEqual({ type: "move", index: 15 });
    expect(listKey({ key: "PageDown", index: 25, count: 30 })).toEqual({ type: "move", index: 29 });
    expect(listKey({ key: "PageUp", index: 5, count: 30 })).toEqual({ type: "move", index: 0 });
  });

  it("opens on Enter and toggles the preview on Space", () => {
    expect(listKey({ key: "Enter", index: 1, count: 3 })).toEqual({ type: "open" });
    expect(listKey({ key: " ", index: 1, count: 3 })).toEqual({ type: "preview" });
  });

  it("ArrowLeft hands focus back to the tree", () => {
    expect(listKey({ key: "ArrowLeft", index: 1, count: 3 })).toEqual({ type: "tree" });
  });

  it("ignores ArrowRight and other keys in a single-column list", () => {
    expect(listKey({ key: "ArrowRight", index: 1, count: 3 })).toBeNull();
    expect(listKey({ key: "a", index: 1, count: 3 })).toBeNull();
  });

  it("does nothing on an empty list except going back to the tree", () => {
    expect(listKey({ key: "ArrowDown", index: -1, count: 0 })).toBeNull();
    expect(listKey({ key: "Enter", index: -1, count: 0 })).toBeNull();
    expect(listKey({ key: "ArrowLeft", index: -1, count: 0 })).toEqual({ type: "tree" });
  });

  it("does not act on Enter or Space with no active row", () => {
    expect(listKey({ key: "Enter", index: -1, count: 3 })).toBeNull();
    expect(listKey({ key: " ", index: -1, count: 3 })).toBeNull();
  });

  describe("in a grid of tiles", () => {
    it("moves by columns vertically and by one horizontally", () => {
      expect(listKey({ key: "ArrowDown", index: 1, count: 10, columns: 4 })).toEqual({ type: "move", index: 5 });
      expect(listKey({ key: "ArrowUp", index: 5, count: 10, columns: 4 })).toEqual({ type: "move", index: 1 });
      expect(listKey({ key: "ArrowRight", index: 1, count: 10, columns: 4 })).toEqual({ type: "move", index: 2 });
      expect(listKey({ key: "ArrowLeft", index: 2, count: 10, columns: 4 })).toEqual({ type: "move", index: 1 });
    });
    it("goes to the tree from the first column, and to the last tile from a short last row", () => {
      expect(listKey({ key: "ArrowLeft", index: 4, count: 10, columns: 4 })).toEqual({ type: "tree" });
      expect(listKey({ key: "ArrowDown", index: 6, count: 10, columns: 4 })).toEqual({ type: "move", index: 9 });
      expect(listKey({ key: "ArrowDown", index: 9, count: 10, columns: 4 })).toEqual({ type: "move", index: 9 });
    });
    it("stops at the last tile going right", () => {
      expect(listKey({ key: "ArrowRight", index: 9, count: 10, columns: 4 })).toEqual({ type: "move", index: 9 });
    });
  });
});

function items(spec) {
  // spec: [id, level, {expanded, loaded, children, parentId}]
  const nodes = spec.map(([id, level, o = {}]) => ({ node: { id, expanded: !!o.expanded, loaded: o.loaded !== false, children: o.kids || [], parentId: o.parent }, level }));
  const byId = Object.fromEntries(nodes.map(n => [n.node.id, n.node]));
  nodes.forEach(n => { n.node.parent = n.node.parentId ? byId[n.node.parentId] : null; });
  return nodes;
}

describe("treeKey", () => {
  const tree = () => items([
    ["a", 1, { expanded: true, kids: ["a1", "a2"] }],
    ["a1", 2, { parent: "a" }],
    ["a2", 2, { parent: "a", loaded: false }],
    ["b", 1, { kids: ["b1"] }],
  ]);

  it("moves up and down the visible nodes and jumps to the ends", () => {
    expect(treeKey({ key: "ArrowDown", items: tree(), index: 0 })).toEqual({ type: "focus", index: 1 });
    expect(treeKey({ key: "ArrowDown", items: tree(), index: 3 })).toEqual({ type: "focus", index: 3 });
    expect(treeKey({ key: "ArrowUp", items: tree(), index: 1 })).toEqual({ type: "focus", index: 0 });
    expect(treeKey({ key: "Home", items: tree(), index: 2 })).toEqual({ type: "focus", index: 0 });
    expect(treeKey({ key: "End", items: tree(), index: 0 })).toEqual({ type: "focus", index: 3 });
  });

  it("ArrowRight expands a closed node that has, or may have, children", () => {
    expect(treeKey({ key: "ArrowRight", items: tree(), index: 3 })).toEqual({ type: "expand", index: 3 });
    expect(treeKey({ key: "ArrowRight", items: tree(), index: 2 })).toEqual({ type: "expand", index: 2 });
  });

  it("ArrowRight on an open node enters its first child", () => {
    expect(treeKey({ key: "ArrowRight", items: tree(), index: 0 })).toEqual({ type: "focus", index: 1 });
  });

  it("ArrowRight on a leaf moves on to the result list", () => {
    expect(treeKey({ key: "ArrowRight", items: tree(), index: 1 })).toEqual({ type: "list" });
  });

  it("ArrowLeft collapses an open node, else goes to the parent, else does nothing", () => {
    expect(treeKey({ key: "ArrowLeft", items: tree(), index: 0 })).toEqual({ type: "collapse", index: 0 });
    expect(treeKey({ key: "ArrowLeft", items: tree(), index: 1 })).toEqual({ type: "focus", index: 0 });
    expect(treeKey({ key: "ArrowLeft", items: tree(), index: 3 })).toBeNull();
  });

  it("Enter and Space select the node", () => {
    expect(treeKey({ key: "Enter", items: tree(), index: 1 })).toEqual({ type: "select", index: 1 });
    expect(treeKey({ key: " ", items: tree(), index: 1 })).toEqual({ type: "select", index: 1 });
  });

  it("ignores everything on an empty tree or with no active node", () => {
    expect(treeKey({ key: "ArrowDown", items: [], index: -1 })).toBeNull();
    expect(treeKey({ key: "Enter", items: tree(), index: -1 })).toBeNull();
    expect(treeKey({ key: "ArrowDown", items: tree(), index: -1 })).toEqual({ type: "focus", index: 0 });
  });
});

describe("globalKey", () => {
  it("/ focuses the search box when the focus is not in a text field", () => {
    expect(globalKey({ key: "/", editable: false })).toEqual({ type: "focus-search" });
    expect(globalKey({ key: "/", editable: true })).toBeNull();
  });
  it("/ with a modifier is left to the browser", () => {
    expect(globalKey({ key: "/", editable: false, ctrlKey: true })).toBeNull();
    expect(globalKey({ key: "/", editable: false, metaKey: true })).toBeNull();
    expect(globalKey({ key: "/", editable: false, altKey: true })).toBeNull();
  });
  it("Escape closes an open preview or drawer, and is otherwise ignored", () => {
    expect(globalKey({ key: "Escape", editable: false, overlayOpen: true })).toEqual({ type: "close" });
    expect(globalKey({ key: "Escape", editable: false, overlayOpen: false })).toBeNull();
    expect(globalKey({ key: "Escape", editable: true, overlayOpen: true })).toBeNull();
  });
});

describe("isEditable", () => {
  it("is true for text fields, selects, textareas and contenteditable, false for the rest", () => {
    expect(isEditable({ tagName: "INPUT", type: "search" })).toBe(true);
    expect(isEditable({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditable({ tagName: "SELECT" })).toBe(true);
    expect(isEditable({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isEditable({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isEditable({ tagName: "BUTTON" })).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});
