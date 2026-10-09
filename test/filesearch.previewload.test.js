// SPDX-License-Identifier: Apache-2.0
// filesearch: previewload.js — which preview a hit gets, how the original is fetched for it
// (type pinned, size capped, content checked), and the helpers that keep previews to one
// at a time and thumbnails retrying while the server is still generating them.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  previewKind, fetchPdfBlob, fetchText, loadThumbnail, createSerial, MAX_PDF_BYTES, MAX_TEXT_BYTES, PreviewError,
} from "../themes/filesearch/assets/previewload.js";

describe("previewKind", () => {
  it("shows the cached copy of a web page that has one", () => {
    expect(previewKind({ has_cache: "true", filetype: "html" })).toEqual({ kind: "cache" });
    expect(previewKind({ has_cache: true, mimetype: "text/html" })).toEqual({ kind: "cache" });
  });
  it("prefers the original for small text, whose cached copy has lost its line breaks, and the cache for large text", () => {
    expect(previewKind({ has_cache: true, filetype: "txt", mimetype: "text/plain", content_length: 100 })).toEqual({ kind: "text" });
    expect(previewKind({ has_cache: "true", mimetype: "text/x-web-markdown", content_length: 100 })).toEqual({ kind: "text" });
    expect(previewKind({ has_cache: true, mimetype: "text/plain", content_length: MAX_TEXT_BYTES + 1 })).toEqual({ kind: "cache" });
    expect(previewKind({ has_cache: false, mimetype: "text/plain", content_length: MAX_TEXT_BYTES + 1 })).toEqual({ kind: "none", reason: "too_large" });
  });
  it("shows the cached copy of a file with no original preview (an office document)", () => {
    expect(previewKind({ has_cache: "true", mimetype: "application/msword" })).toEqual({ kind: "cache" });
  });
  it("shows a pdf through its original, falling back to the cached copy only when it is too large", () => {
    expect(previewKind({ mimetype: "application/pdf", content_length: 1000 })).toEqual({ kind: "pdf" });
    expect(previewKind({ mimetype: "application/pdf", has_cache: "true", content_length: 1000 })).toEqual({ kind: "pdf" });
    expect(previewKind({ mimetype: "application/pdf", content_length: MAX_PDF_BYTES + 1 })).toEqual({ kind: "none", reason: "too_large" });
    expect(previewKind({ mimetype: "application/pdf", has_cache: "true", content_length: MAX_PDF_BYTES + 1 })).toEqual({ kind: "cache" });
  });
  it("shows plain text and images through the original when they are small enough", () => {
    expect(previewKind({ mimetype: "text/plain", content_length: 100 })).toEqual({ kind: "text" });
    expect(previewKind({ filetype: "txt", content_length: MAX_TEXT_BYTES + 1 })).toEqual({ kind: "none", reason: "too_large" });
    expect(previewKind({ mimetype: "image/png", content_length: 5000 })).toEqual({ kind: "image" });
    expect(previewKind({ mimetype: "image/svg+xml", content_length: 5000 })).toEqual({ kind: "image" });
  });
  it("gives code, csv and other text-like files a text preview", () => {
    expect(previewKind({ mimetype: "text/x-java-source", content_length: 100 })).toEqual({ kind: "text" });
    expect(previewKind({ mimetype: "text/csv", content_length: 100 })).toEqual({ kind: "text" });
    expect(previewKind({ mimetype: "application/json", content_length: 100 })).toEqual({ kind: "text" });
  });
  it("has no preview for office documents, archives, media or an unknown type", () => {
    expect(previewKind({ mimetype: "application/msword" })).toEqual({ kind: "none", reason: "unsupported" });
    expect(previewKind({ mimetype: "application/zip" })).toEqual({ kind: "none", reason: "unsupported" });
    expect(previewKind({ mimetype: "video/mp4" })).toEqual({ kind: "none", reason: "unsupported" });
    expect(previewKind({})).toEqual({ kind: "none", reason: "unsupported" });
    expect(previewKind(null)).toEqual({ kind: "none", reason: "unsupported" });
  });
  it("has no preview for an html page without a cached copy: it would load another site", () => {
    expect(previewKind({ mimetype: "text/html", filetype: "html" })).toEqual({ kind: "none", reason: "unsupported" });
  });
  it("never asks go/ for the original of a page crawled over http(s): it redirects to another origin", () => {
    // The page's connect-src / img-src 'self' refuse that redirect and log a policy violation.
    const text = { mimetype: "text/plain", filetype: "txt", content_length: 100 };
    const pdf = { mimetype: "application/pdf", content_length: 1000 };
    const image = { mimetype: "image/png", content_length: 5000 };
    for (const url of ["http://wiki.example.com/notes.txt", "https://wiki.example.com/a.pdf", "HTTPS://wiki.example.com/p.png"]) {
      for (const doc of [text, pdf, image]) {
        expect(previewKind({ ...doc, url })).toEqual({ kind: "none", reason: "unsupported" });
        expect(previewKind({ ...doc, url, has_cache: "true" })).toEqual({ kind: "cache" });
        expect(previewKind({ ...doc, url: undefined, url_link: url, has_cache: true })).toEqual({ kind: "cache" });
      }
    }
    // a size past the cap is not the reason there is no preview
    expect(previewKind({ ...pdf, url: "http://h/a.pdf", content_length: MAX_PDF_BYTES + 1 })).toEqual({ kind: "none", reason: "unsupported" });
  });
  it("still previews a file on a file system through the original", () => {
    for (const url of ["file:///srv/notes.txt", "smb://srv/share/notes.txt", "ftp://h/notes.txt", "s3://bucket/notes.txt", "gcs://bucket/notes.txt"]) {
      expect(previewKind({ mimetype: "text/plain", content_length: 100, url, has_cache: "true" })).toEqual({ kind: "text" });
    }
    expect(previewKind({ mimetype: "application/pdf", content_length: 1000, url: "smb://srv/share/a.pdf" })).toEqual({ kind: "pdf" });
    expect(previewKind({ mimetype: "image/png", content_length: 5000, url: "file:///srv/a.png" })).toEqual({ kind: "image" });
  });
  it("treats an unknown size as small enough, and reads the string sizes Fess sends", () => {
    expect(previewKind({ mimetype: "application/pdf" })).toEqual({ kind: "pdf" });
    expect(previewKind({ mimetype: "application/pdf", content_length: "2516" })).toEqual({ kind: "pdf" });
    expect(previewKind({ mimetype: "application/pdf", content_length: String(MAX_PDF_BYTES + 1) })).toEqual({ kind: "none", reason: "too_large" });
  });
});

function fakeResponse({ bytes, ok = true, status = 200, headers = {}, stream = false }) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const res = {
    ok, status,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    body: null,
  };
  if (stream) {
    let sent = false;
    let cancelled = false;
    res.body = { getReader: () => ({
      read: async () => (sent || cancelled ? { done: true } : (sent = true, { done: false, value: buf })),
      cancel: async () => { cancelled = true; },
    }) };
  }
  return res;
}
const enc = s => new TextEncoder().encode(s);

describe("fetchPdfBlob", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns a Blob whose type is pinned to application/pdf, whatever the server said", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ bytes: enc("%PDF-1.7\nrest"), headers: { "content-type": "text/html" } })));
    const blob = await fetchPdfBlob("go/?docId=1");
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBe(13);
    expect(fetch).toHaveBeenCalledWith("go/?docId=1", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("refuses a body that is not a PDF, so a mislabelled file is never shown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ bytes: enc("<html><script>alert(1)</script>") })));
    await expect(fetchPdfBlob("go/?docId=1")).rejects.toMatchObject({ name: "PreviewError", code: "not_pdf" });
  });

  it("refuses a file larger than the cap before reading it", async () => {
    const res = fakeResponse({ bytes: enc("%PDF-"), headers: { "content-length": String(MAX_PDF_BYTES + 1) } });
    res.arrayBuffer = vi.fn(res.arrayBuffer);
    vi.stubGlobal("fetch", vi.fn(async () => res));
    await expect(fetchPdfBlob("go/?docId=1")).rejects.toMatchObject({ code: "too_large" });
    expect(res.arrayBuffer).not.toHaveBeenCalled();
  });

  it("reports an HTTP failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ bytes: [], ok: false, status: 404 })));
    await expect(fetchPdfBlob("go/?docId=1")).rejects.toMatchObject({ code: "http", status: 404 });
  });

  it("passes the abort signal to fetch and lets the abort through", async () => {
    const ctl = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async (_u, opts) => { expect(opts.signal).toBe(ctl.signal); throw Object.assign(new Error("aborted"), { name: "AbortError" }); }));
    await expect(fetchPdfBlob("go/?docId=1", ctl.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("exports PreviewError", () => {
    expect(new PreviewError("x", "code").name).toBe("PreviewError");
  });
});

describe("fetchText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("decodes UTF-8 by default", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ bytes: enc("héllo 日本") })));
    expect(await fetchText("go/?docId=1")).toEqual({ text: "héllo 日本", truncated: false });
  });

  it("honours the charset the server declared", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ bytes: [0x82, 0xa0], headers: { "content-type": "text/plain; charset=Shift_JIS" } })));
    expect((await fetchText("go/?docId=1")).text).toBe("あ");
  });

  it("falls back to UTF-8 for a charset it does not know", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ bytes: enc("abc"), headers: { "content-type": "text/plain; charset=bogus-9" } })));
    expect((await fetchText("go/?docId=1")).text).toBe("abc");
  });

  it("stops reading at the cap and says it was cut", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ bytes: enc("0123456789"), stream: true })));
    expect(await fetchText("go/?docId=1", undefined, 4)).toEqual({ text: "0123", truncated: true });
  });

  it("cuts a body it cannot stream the same way", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ bytes: enc("0123456789") })));
    expect(await fetchText("go/?docId=1", undefined, 4)).toEqual({ text: "0123", truncated: true });
  });

  it("reports an HTTP failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ bytes: [], ok: false, status: 500 })));
    await expect(fetchText("go/?docId=1")).rejects.toMatchObject({ code: "http", status: 500 });
  });

  it("has a sane default cap", () => {
    expect(MAX_TEXT_BYTES).toBeGreaterThan(1024);
  });
});

describe("loadThumbnail", () => {
  afterEach(() => vi.useRealTimers());

  it("sets the source and does nothing more once it loads", () => {
    vi.useFakeTimers();
    const img = document.createElement("img");
    const onGiveUp = vi.fn();
    loadThumbnail(img, "thumbnail/?docId=1&queryId=q", { delays: [10, 20], onGiveUp });
    expect(img.getAttribute("src")).toBe("thumbnail/?docId=1&queryId=q");
    img.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(1000);
    expect(img.getAttribute("src")).toBe("thumbnail/?docId=1&queryId=q");
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("retries a 404 (still being generated) with a fresh URL, then gives up", () => {
    vi.useFakeTimers();
    const img = document.createElement("img");
    const onGiveUp = vi.fn();
    loadThumbnail(img, "thumbnail/?docId=1&queryId=q", { delays: [10, 20], onGiveUp });
    img.dispatchEvent(new Event("error"));
    expect(onGiveUp).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(img.getAttribute("src")).toBe("thumbnail/?docId=1&queryId=q&_r=1");
    img.dispatchEvent(new Event("error"));
    vi.advanceTimersByTime(20);
    expect(img.getAttribute("src")).toBe("thumbnail/?docId=1&queryId=q&_r=2");
    img.dispatchEvent(new Event("error"));
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(img.getAttribute("src")).toBe("thumbnail/?docId=1&queryId=q&_r=2");
  });

  it("can be cancelled while a retry is pending", () => {
    vi.useFakeTimers();
    const img = document.createElement("img");
    const onGiveUp = vi.fn();
    const cancel = loadThumbnail(img, "thumbnail/?docId=1", { delays: [10], onGiveUp });
    img.dispatchEvent(new Event("error"));
    cancel();
    vi.advanceTimersByTime(1000);
    expect(img.getAttribute("src")).toBe("thumbnail/?docId=1");
    img.dispatchEvent(new Event("error"));
    expect(onGiveUp).not.toHaveBeenCalled();
  });
});

describe("createSerial", () => {
  it("aborts the previous run when a new one starts and marks its result stale", async () => {
    const serial = createSerial();
    let firstSignal;
    let release;
    const first = serial.run(signal => { firstSignal = signal; return new Promise(r => { release = r; }); });
    const second = serial.run(async () => "two");
    expect(firstSignal.aborted).toBe(true);
    release("one");
    expect(await first).toEqual({ stale: true });
    expect(await second).toEqual({ stale: false, value: "two" });
  });

  it("swallows an error from a run that was superseded, and rethrows one from the current run", async () => {
    const serial = createSerial();
    const first = serial.run(() => Promise.reject(new Error("late")));
    const second = serial.run(() => Promise.reject(new Error("current")));
    expect(await first).toEqual({ stale: true });
    await expect(second).rejects.toThrow("current");
  });

  it("cancel() aborts whatever is running", async () => {
    const serial = createSerial();
    let sig;
    const run = serial.run(signal => { sig = signal; return new Promise(() => {}); });
    serial.cancel();
    expect(sig.aborted).toBe(true);
    expect(run).toBeInstanceOf(Promise);
  });
});
