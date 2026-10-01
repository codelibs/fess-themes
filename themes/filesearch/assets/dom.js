// SPDX-License-Identifier: Apache-2.0
// Small DOM helpers shared by the file-search view modules. Every node is built with
// createElement + textContent / setAttribute; no untrusted string is parsed as markup here.

/** createElement with className / text / attrs / dataset in one call. */
export function el(tag, opts) {
  const node = document.createElement(tag);
  if (!opts) return node;
  if (opts.className) node.className = opts.className;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, String(v));
  if (opts.dataset) for (const [k, v] of Object.entries(opts.dataset)) node.dataset[k] = String(v);
  return node;
}

/** Remove every child of `node`. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** A <button type=button> carrying an inline icon and an accessible name. */
export function iconButton({ icon, label, className = "fs-icon-btn", attrs = {}, onClick }) {
  const btn = el("button", { className, attrs: { type: "button", "aria-label": label, title: label, ...attrs } });
  if (icon) btn.appendChild(icon);
  if (onClick) btn.addEventListener("click", onClick);
  return btn;
}

/** Scroll an element into view when the browser can (jsdom cannot). */
export function reveal(node) {
  if (node && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "nearest" });
}

/**
 * Copy text to the clipboard, with a fallback for plain-HTTP origins where
 * navigator.clipboard is undefined (a hidden textarea and execCommand).
 *
 * @returns {Promise<void>}
 */
export function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.className = "chat-clipboard-fallback";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error("copy command rejected"));
    } catch (e) {
      reject(e);
    }
  });
}
