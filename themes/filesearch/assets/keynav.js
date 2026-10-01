// SPDX-License-Identifier: Apache-2.0
// The keyboard model of the page, as pure functions from (key, state) to an action. The
// DOM glue (search.js, treeview.js) only reads the action and moves focus; keeping the
// decisions here makes them testable without a browser.
//
// Result list (one row focusable at a time, roving tabindex):
//   Up/Down   previous / next row           Home/End  first / last
//   PageUp/Dn ten rows                      Enter     open the original
//   Space     show / hide the preview       Left      back to the folder tree
// Folder tree (WAI-ARIA tree pattern):
//   Up/Down   previous / next visible node  Right     expand, then enter the first child,
//   Left      collapse, then go to parent             then on to the result list
//   Enter/Space select the folder
// Page:
//   /         focus the search box (when not typing)   Esc  close the preview or drawer

const PAGE_STEP = 10;

/**
 * @param {{key:string,index:number,count:number,columns?:number}} s `index` is the active row
 *   (-1 for none); `columns` is the number of tiles per row (1 outside the tiles view)
 * @returns {null|{type:"move",index:number}|{type:"open"}|{type:"preview"}|{type:"tree"}}
 */
export function listKey({ key, index, count, columns = 1 }) {
  const move = i => ({ type: "move", index: i });
  if (key === "ArrowLeft") {
    if (columns > 1 && count > 0 && index > 0 && index % columns !== 0) return move(index - 1);
    return { type: "tree" };
  }
  if (!(count > 0)) return null;
  const last = count - 1;
  switch (key) {
    case "ArrowDown": {
      if (index < 0) return move(0);
      if (columns <= 1) return move(Math.min(index + 1, last));
      const lastRowStart = Math.floor(last / columns) * columns;
      if (index + columns <= last) return move(index + columns);
      return move(index < lastRowStart ? last : index);
    }
    case "ArrowUp":
      if (index < 0) return move(0);
      if (columns <= 1) return move(Math.max(index - 1, 0));
      return move(index - columns >= 0 ? index - columns : index);
    case "ArrowRight":
      if (columns <= 1) return null;
      return move(index < 0 ? 0 : Math.min(index + 1, last));
    case "Home": return move(0);
    case "End": return move(last);
    case "PageDown": return move(Math.min(Math.max(index, 0) + PAGE_STEP, last));
    case "PageUp": return move(Math.max(index - PAGE_STEP, 0));
    case "Enter": return index < 0 ? null : { type: "open" };
    case " ": return index < 0 ? null : { type: "preview" };
    default: return null;
  }
}

/**
 * @param {{key:string,items:{node:{expanded:boolean,loaded:boolean,children:any[],parent:any}}[],index:number}} s
 *   `items` is the visible part of the tree in order (tree.js visibleNodes)
 * @returns {null|{type:"focus"|"expand"|"collapse"|"select",index:number}|{type:"list"}}
 */
export function treeKey({ key, items, index }) {
  if (!items || items.length === 0) return null;
  const last = items.length - 1;
  const focus = i => ({ type: "focus", index: i });
  if (key === "ArrowDown") return focus(index < 0 ? 0 : Math.min(index + 1, last));
  if (key === "ArrowUp") return focus(index < 0 ? 0 : Math.max(index - 1, 0));
  if (key === "Home") return focus(0);
  if (key === "End") return focus(last);
  if (index < 0 || index > last) return null;
  const node = items[index].node;
  switch (key) {
    case "ArrowRight":
      if (node.expanded && node.children.length > 0) return focus(index + 1);
      if (!node.expanded && (node.children.length > 0 || !node.loaded)) return { type: "expand", index };
      return { type: "list" };
    case "ArrowLeft": {
      if (node.expanded) return { type: "collapse", index };
      const parent = node.parent ? items.findIndex(i => i.node === node.parent) : -1;
      return parent >= 0 ? focus(parent) : null;
    }
    case "Enter":
    case " ":
      return { type: "select", index };
    default:
      return null;
  }
}

/**
 * @param {{key:string,editable:boolean,overlayOpen?:boolean,ctrlKey?:boolean,metaKey?:boolean,altKey?:boolean}} s
 * @returns {null|{type:"focus-search"}|{type:"close"}}
 */
export function globalKey({ key, editable, overlayOpen = false, ctrlKey = false, metaKey = false, altKey = false }) {
  if (editable) return null;
  if (key === "/" && !ctrlKey && !metaKey && !altKey) return { type: "focus-search" };
  if (key === "Escape" && overlayOpen) return { type: "close" };
  return null;
}

const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "file", "range", "color", "image"]);

/** True when typing in `target` should not be taken as a shortcut. */
export function isEditable(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = String(target.tagName || "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has(String(target.type || "text").toLowerCase());
  return false;
}
