// SPDX-License-Identifier: Apache-2.0
// The preview pane: metadata and actions for the selected row at once, and a content
// preview a moment later (previewload.js decides what kind). One preview is loaded at a
// time and a new selection cancels the one before it, because go/ writes a click log and
// re-reads the file from its source.
//
// Content never runs here: the cached copy goes into a frame sandboxed without scripts or
// the page's origin (as cache.js does), a PDF goes into the browser's own viewer from a
// Blob whose type is pinned and whose first bytes were checked, text is set with
// textContent, and an image is an <img> on the same-origin go/ URL.

import * as api from "./api.js";
import { t } from "./i18n.js";
import { formatFileSize, formatDate } from "./format.js";
import { el, clear } from "./dom.js";
import { fileKind, fileIcon, uiIcon } from "./icons.js";
import { displayPath, copyPathOf } from "./paths.js";
import { nameOf } from "./listview.js";
import {
  previewKind, fetchPdfBlob, fetchText, loadThumbnail, createSerial, PreviewError,
} from "./previewload.js";

/** Wait this long after a selection before loading content, so holding an arrow key costs nothing. */
export const CONTENT_DELAY_MS = 250;

const PREF_KEY = "filesearch.preview";

function readPref() {
  try { return window.localStorage.getItem(PREF_KEY) !== "closed"; } catch { return true; }
}
function writePref(open) {
  try { window.localStorage.setItem(PREF_KEY, open ? "open" : "closed"); } catch { /* storage unavailable */ }
}

const isNarrow = () => !!(window.matchMedia && window.matchMedia("(max-width: 899.98px)").matches);

/** `hq` highlight terms for the cache API, from the search response's highlight_params. */
function highlightTerms(ctx) {
  const fromParams = new URLSearchParams(ctx.highlightParams || "").getAll("hq").filter(Boolean);
  if (fromParams.length) return fromParams;
  return ctx.q ? [ctx.q] : [];
}

export function createPreview({ workspace, root }) {
  const q = sel => root.querySelector(sel);
  const body = q("#fs-preview-body");
  const empty = q("#fs-preview-empty");
  const stage = q("#fs-pv-stage");
  const meta = q("#fs-pv-meta");
  const actions = q("#fs-pv-actions");
  const nameEl = q("#fs-pv-name");
  const pathEl = q("#fs-pv-path");
  const iconEl = q("#fs-pv-icon");
  const closeBtn = q("#fs-preview-close");

  const serial = createSerial();
  let timer = null;
  let cancelThumb = null;
  let blobUrl = null;
  let current = null;       // { doc, ctx }
  let widePref = readPref();
  let sheetOpen = false;

  function revoke() {
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
  }

  function applyOpenState() {
    if (workspace) {
      workspace.dataset.preview = widePref ? "open" : "closed";
      workspace.dataset.sheet = sheetOpen ? "open" : "closed";
    }
    if (root) root.dataset.hasDoc = current ? "1" : "0";
    if (body) body.hidden = !current;
    if (empty) empty.hidden = !!current;
  }

  /** Whether the pane is on screen now (wide: preference; narrow: the sheet). */
  function visible() {
    return isNarrow() ? sheetOpen : widePref;
  }

  function message(text, className = "") {
    clear(stage);
    stage.appendChild(el("p", { className: "fs-pv-msg " + className, text, attrs: { role: "status" } }));
  }

  function hero(kind) {
    const wrap = el("div", { className: "fs-pv-hero" });
    wrap.appendChild(fileIcon(kind));
    return wrap;
  }

  function fillMeta(doc, ctx) {
    clear(meta);
    const add = (label, value) => {
      if (value == null || value === "") return;
      meta.appendChild(el("dt", { text: label }));
      meta.appendChild(el("dd", { text: String(value) }));
    };
    const kind = fileKind(doc);
    add(t("fs.meta_path"), displayPath(doc.url || doc.url_link));
    add(t("fs.meta_modified"), formatDate(doc.last_modified || doc.timestamp));
    add(t("fs.meta_size"), formatFileSize(doc.content_length));
    add(t("fs.meta_type"), t("fs.kind_" + kind) + (doc.mimetype ? " (" + doc.mimetype + ")" : ""));
    add(t("fs.meta_indexed"), formatDate(doc.created));
    if (ctx.features && ctx.features.search_log_enabled && Number(doc.click_count) > 0) {
      add(t("fs.meta_views"), Number(doc.click_count).toLocaleString());
    }
  }

  function fillActions(doc, ctx) {
    clear(actions);
    const url = doc.url_link || doc.url || "";
    const goHref = ctx.buildGoUrl(url, doc.doc_id, ctx.queryId, ctx.index, ctx.requestedTime);
    const open = el("a", { className: "btn btn-primary btn-sm", attrs: { href: goHref } });
    if (goHref !== "#") { open.setAttribute("target", "_blank"); open.setAttribute("rel", "noopener"); }
    open.appendChild(uiIcon("external"));
    open.appendChild(el("span", { text: t("fs.open_original") }));
    actions.appendChild(open);

    const copy = el("button", { className: "btn btn-light btn-sm", attrs: { type: "button" } });
    copy.appendChild(uiIcon("copy"));
    copy.appendChild(el("span", { text: t("fs.copy_path") }));
    copy.addEventListener("click", () => ctx.actions.copyPath(copyPathOf(doc.url || url), copy));
    actions.appendChild(copy);

    const folder = el("button", { className: "btn btn-light btn-sm", attrs: { type: "button" } });
    folder.appendChild(uiIcon("up"));
    folder.appendChild(el("span", { text: t("fs.show_in_folder") }));
    folder.addEventListener("click", () => ctx.actions.showInFolder(doc));
    actions.appendChild(folder);

    if (doc.has_cache === true || doc.has_cache === "true") {
      const hq = highlightTerms(ctx).map(v => "&hq=" + encodeURIComponent(v)).join("");
      const cached = el("a", {
        className: "btn btn-light btn-sm",
        attrs: { href: "cache/?docId=" + encodeURIComponent(doc.doc_id || "") + hq, target: "_blank", rel: "noopener" },
      });
      cached.appendChild(uiIcon("clock"));
      cached.appendChild(el("span", { text: t("result.cache") }));
      actions.appendChild(cached);
    }
  }

  // ── content ──

  function showThumbnail(doc, ctx, kind) {
    clear(stage);
    stage.appendChild(hero(kind));
    if (ctx.features && ctx.features.thumbnail_enabled && doc.thumbnail && doc.doc_id) {
      const img = el("img", { className: "fs-pv-thumb", attrs: { alt: "" } });
      cancelThumb = loadThumbnail(img, "thumbnail/?docId=" + encodeURIComponent(doc.doc_id) + "&queryId=" + encodeURIComponent(ctx.queryId || ""), {
        onGiveUp: () => img.remove(),
      });
      img.addEventListener("load", () => { const h = stage.querySelector(".fs-pv-hero"); if (h) h.hidden = true; });
      stage.appendChild(img);
    }
  }

  function frame({ src, sandbox, title }) {
    const f = el("iframe", { className: "fs-pv-frame", attrs: { title, referrerpolicy: "no-referrer" } });
    if (sandbox != null) f.setAttribute("sandbox", sandbox);
    f.setAttribute("src", src);
    return f;
  }

  async function loadContent(doc, ctx, decision, signal) {
    const url = doc.url_link || doc.url || "";
    const goHref = ctx.buildGoUrl(url, doc.doc_id, ctx.queryId, ctx.index, ctx.requestedTime);
    if (decision.kind === "cache") {
      const hq = highlightTerms(ctx);
      const env = await api.get("/cache/" + encodeURIComponent(doc.doc_id), hq.length ? { hq } : undefined, { signal });
      const mime = env.mimetype || "text/html";
      const charset = env.charset || "utf-8";
      let html = env.content || "";
      const base = env.url || "";
      if (base && !/<base\b/i.test(html)) {
        const safe = base.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const tag = '<base href="' + safe + '">';
        html = /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, m => m + tag) : tag + html;
      }
      return { type: "cache", blob: new Blob([html], { type: /charset=/i.test(mime) ? mime : mime + ";charset=" + charset }) };
    }
    if (decision.kind === "pdf") return { type: "pdf", blob: await fetchPdfBlob(goHref, signal) };
    if (decision.kind === "text") return { type: "text", ...(await fetchText(goHref, signal)) };
    return { type: "image", src: goHref };
  }

  function renderContent(result, doc) {
    clear(stage);
    if (result.type === "cache") {
      revoke();
      blobUrl = URL.createObjectURL(result.blob);
      // No allow-scripts and no allow-same-origin: crawled HTML is untrusted.
      stage.appendChild(frame({ src: blobUrl, sandbox: "allow-popups allow-popups-to-escape-sandbox", title: t("fs.preview_title") }));
    } else if (result.type === "pdf") {
      revoke();
      blobUrl = URL.createObjectURL(result.blob);
      // The browser's PDF viewer needs an unsandboxed frame; the Blob's type is pinned to
      // application/pdf and its first bytes were verified, so it is never read as HTML.
      stage.appendChild(frame({ src: blobUrl, sandbox: null, title: t("fs.preview_title") }));
    } else if (result.type === "text") {
      stage.appendChild(el("pre", { className: "fs-pv-text", text: result.text, attrs: { tabindex: "0" } }));
      if (result.truncated) stage.appendChild(el("p", { className: "fs-pv-note", text: t("fs.preview_truncated") }));
    } else {
      const img = el("img", { className: "fs-pv-image", attrs: { alt: nameOf(doc), src: result.src } });
      img.addEventListener("error", () => message(t("fs.preview_failed"), "is-error"));
      stage.appendChild(img);
    }
  }

  function startContent(doc, ctx) {
    const decision = previewKind(doc);
    if (decision.kind === "none") {
      const note = el("p", { className: "fs-pv-msg", text: decision.reason === "too_large" ? t("fs.preview_too_large") : t("fs.preview_none"), attrs: { role: "status" } });
      stage.appendChild(note);
      return;
    }
    const loading = el("p", { className: "fs-pv-msg is-loading", text: t("fs.preview_loading"), attrs: { role: "status" } });
    stage.appendChild(loading);
    serial.run(signal => loadContent(doc, ctx, decision, signal)).then(
      out => {
        if (out.stale) return;
        if (cancelThumb) { cancelThumb(); cancelThumb = null; }
        renderContent(out.value, doc);
      },
      err => {
        loading.remove();
        if (err && err.name === "AbortError") return;
        const tooBig = err instanceof PreviewError && err.code === "too_large";
        const none = err instanceof PreviewError && err.code === "not_pdf";
        stage.appendChild(el("p", {
          className: "fs-pv-msg is-error",
          text: tooBig ? t("fs.preview_too_large") : none ? t("fs.preview_none") : t("fs.preview_failed"),
          attrs: { role: "status" },
        }));
      }
    );
  }

  function render(doc, ctx) {
    const kind = fileKind(doc);
    clear(iconEl);
    iconEl.appendChild(fileIcon(kind));
    nameEl.textContent = nameOf(doc);
    pathEl.textContent = displayPath(doc.url || doc.url_link);
    fillActions(doc, ctx);
    fillMeta(doc, ctx);
    if (cancelThumb) { cancelThumb(); cancelThumb = null; }
    serial.cancel();
    clearTimeout(timer);
    revoke();
    showThumbnail(doc, ctx, kind);
    // Metadata is on screen now; the content waits until the selection has settled.
    timer = setTimeout(() => startContent(doc, ctx), CONTENT_DELAY_MS);
  }

  if (closeBtn) closeBtn.addEventListener("click", () => closePane());

  function closePane() {
    if (isNarrow()) sheetOpen = false; else { widePref = false; writePref(false); }
    cancelWork();
    applyOpenState();
  }

  function cancelWork() {
    clearTimeout(timer);
    serial.cancel();
    if (cancelThumb) { cancelThumb(); cancelThumb = null; }
  }

  applyOpenState();

  return {
    /**
     * Show a document. `reveal` opens the sheet on a narrow screen (a click or Space, not
     * an arrow key); the content is loaded only while the pane is actually on screen.
     */
    show(doc, ctx, { reveal = false } = {}) {
      current = { doc, ctx };
      if (reveal && isNarrow()) sheetOpen = true;
      applyOpenState();
      if (visible()) render(doc, ctx);
      else cancelWork();
    },
    /** Space: show or hide the pane. */
    toggle() {
      if (isNarrow()) sheetOpen = !sheetOpen && !!current;
      else { widePref = !widePref; writePref(widePref); }
      applyOpenState();
      if (visible() && current) render(current.doc, current.ctx); else cancelWork();
    },
    /** Esc: close the sheet (narrow) or the pane (wide). Returns true when something closed. */
    close() {
      if (!visible()) return false;
      closePane();
      return true;
    },
    /** Forget the selection (a new result page without it). */
    clear() {
      current = null;
      sheetOpen = false;
      cancelWork();
      revoke();
      applyOpenState();
    },
    isOpen: () => visible(),
    hasDoc: () => !!current,
    currentDoc: () => (current ? current.doc : null),
    /** For tests and the layout toggle button. */
    setWideOpen(open) { widePref = !!open; writePref(widePref); applyOpenState(); },
  };
}
