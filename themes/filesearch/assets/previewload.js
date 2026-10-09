// SPDX-License-Identifier: Apache-2.0
// What the preview pane may show for a hit, and the loaders behind it. The rules come
// from what a static theme can do under the page's CSP (no inline script, `blob:` allowed
// for frames but not for images, same-origin fetch only):
//
//   cache   the crawler's stored copy, via /api/v2/cache, in a sandboxed frame
//   pdf     the original fetched through go/, rebuilt as a Blob whose type is pinned to
//           application/pdf and whose first bytes are checked, shown in the browser's viewer
//   text    the first part of the original as text, set with textContent (never as markup)
//   image   the original as an <img> (go/ is same-origin, so img-src allows it)
//
// go/ only serves the original itself for the file systems (file:, smb:, ftp:, s3:, gcs:); for a
// page crawled over http(s) it answers with a redirect to that site, which `connect-src 'self'`
// and `img-src 'self'` refuse (and report to the console). Such a hit has the cached copy, or
// no preview.
//
// Everything else (office files, archives, media, an http page that has no cached copy)
// has no preview. Previews are loaded for the selected row only, one at a time, and every
// load can be cancelled: go/ writes a click log and re-reads the file from its source.

import { fileKind } from "./icons.js";

export const MAX_PDF_BYTES = 25 * 1024 * 1024;
export const MAX_TEXT_BYTES = 256 * 1024;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export class PreviewError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = "PreviewError";
    this.code = code;
    if (status != null) this.status = status;
  }
}

const hasCache = doc => doc.has_cache === true || doc.has_cache === "true";
const sizeOf = doc => {
  const n = Number(doc.content_length);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const TEXT_MIME = /^text\/(?!html)|\/json|\/xml|javascript|x-sh|x-yaml/;

/** @returns {{kind:"cache"|"pdf"|"text"|"image"}|{kind:"none",reason:"too_large"|"unsupported"}} */
export function previewKind(doc) {
  if (!doc) return { kind: "none", reason: "unsupported" };
  // go/ would redirect off this origin: never ask it for the original of a web page.
  if (/^https?:/i.test(String(doc.url || doc.url_link || ""))) {
    return hasCache(doc) ? { kind: "cache" } : { kind: "none", reason: "unsupported" };
  }
  const kind = fileKind(doc);
  const size = sizeOf(doc);
  if (kind === "pdf") {
    if (size <= MAX_PDF_BYTES) return { kind: "pdf" };
    return hasCache(doc) ? { kind: "cache" } : { kind: "none", reason: "too_large" };
  }
  const mime = String(doc.mimetype || "").toLowerCase();
  // Text goes through the original while it is small: the cached copy has its line breaks
  // collapsed, so it is the fallback for a file too large to fetch.
  if (kind !== "web" && (kind === "text" || kind === "code" || (kind === "sheet" && /csv/.test(mime)) || TEXT_MIME.test(mime))) {
    if (size <= MAX_TEXT_BYTES) return { kind: "text" };
    return hasCache(doc) ? { kind: "cache" } : { kind: "none", reason: "too_large" };
  }
  if (hasCache(doc)) return { kind: "cache" };
  if (kind === "image") {
    return size <= MAX_IMAGE_BYTES ? { kind: "image" } : { kind: "none", reason: "too_large" };
  }
  return { kind: "none", reason: "unsupported" };
}

async function request(url, signal) {
  const res = await fetch(url, { credentials: "same-origin", signal });
  if (!res.ok) throw new PreviewError("HTTP " + res.status, "http", res.status);
  return res;
}

/** Fetch an original as a PDF Blob; throws PreviewError("not_pdf" | "too_large" | "http"). */
export async function fetchPdfBlob(url, signal) {
  const res = await request(url, signal);
  const declared = Number(res.headers.get("content-length"));
  if (declared > MAX_PDF_BYTES) throw new PreviewError("too large", "too_large");
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_PDF_BYTES) throw new PreviewError("too large", "too_large");
  const head = new Uint8Array(buf.slice(0, 5));
  if (String.fromCharCode(...head) !== "%PDF-") throw new PreviewError("not a PDF", "not_pdf");
  // The type is fixed here, whatever the server called the file.
  return new Blob([buf], { type: "application/pdf" });
}

function charsetOf(contentType) {
  const m = /charset=["']?([^;"'\s]+)/i.exec(contentType || "");
  return m ? m[1] : "utf-8";
}

function decode(bytes, charset) {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Fetch the start of an original as text; `truncated` says it was cut at `maxBytes`. */
export async function fetchText(url, signal, maxBytes = MAX_TEXT_BYTES) {
  const res = await request(url, signal);
  const charset = charsetOf(res.headers.get("content-type"));
  let bytes;
  let truncated = false;
  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const parts = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      total += value.byteLength;
      if (total >= maxBytes) { truncated = true; await reader.cancel(); break; }
    }
    bytes = new Uint8Array(total);
    let at = 0;
    for (const part of parts) { bytes.set(part, at); at += part.byteLength; }
  } else {
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  if (bytes.byteLength > maxBytes) { bytes = bytes.slice(0, maxBytes); truncated = true; }
  return { text: decode(bytes, charset), truncated };
}

/**
 * Point `img` at a thumbnail URL. Fess answers 404 while it is still generating the image,
 * so a failed load is retried after each delay with a fresh query string, then given up on.
 *
 * @returns {() => void} cancel
 */
export function loadThumbnail(img, src, { delays = [2500, 7000], onGiveUp } = {}) {
  let attempt = 0;
  let timer = null;
  let done = false;
  const onError = () => {
    if (done) return;
    if (attempt >= delays.length) {
      done = true;
      img.removeEventListener("error", onError);
      if (onGiveUp) onGiveUp();
      return;
    }
    const delay = delays[attempt++];
    timer = setTimeout(() => {
      timer = null;
      if (!done) img.setAttribute("src", src + (src.includes("?") ? "&" : "?") + "_r=" + attempt);
    }, delay);
  };
  img.addEventListener("error", onError);
  img.setAttribute("src", src);
  return () => {
    done = true;
    if (timer) clearTimeout(timer);
    img.removeEventListener("error", onError);
  };
}

/** Runs one task at a time: starting a task aborts the previous one and marks its result stale. */
export function createSerial() {
  let current = null;
  return {
    run(task) {
      if (current) current.abort();
      const ctl = new AbortController();
      current = ctl;
      return new Promise(resolve => resolve(task(ctl.signal)))
        .then(
          value => (ctl.signal.aborted ? { stale: true } : { stale: false, value }),
          err => {
            if (ctl.signal.aborted) return { stale: true };
            throw err;
          }
        );
    },
    cancel() {
      if (current) current.abort();
      current = null;
    },
  };
}
