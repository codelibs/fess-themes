// SPDX-License-Identifier: Apache-2.0
// filesearch: icons.js — which kind of file a hit is (mimetype first, then filetype, then
// the extension of the url) and the inline SVG drawn for it.

import { describe, it, expect } from "vitest";
import { fileKind, FILE_KINDS, fileIcon, uiIcon, UI_ICONS } from "../themes/filesearch/assets/icons.js";

describe("fileKind", () => {
  it("reads the mimetype first", () => {
    expect(fileKind({ mimetype: "application/pdf" })).toBe("pdf");
    expect(fileKind({ mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBe("word");
    expect(fileKind({ mimetype: "application/msword" })).toBe("word");
    expect(fileKind({ mimetype: "application/vnd.oasis.opendocument.text" })).toBe("word");
    expect(fileKind({ mimetype: "application/vnd.ms-excel" })).toBe("sheet");
    expect(fileKind({ mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })).toBe("sheet");
    expect(fileKind({ mimetype: "text/csv" })).toBe("sheet");
    expect(fileKind({ mimetype: "application/vnd.ms-powerpoint" })).toBe("slides");
    expect(fileKind({ mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation" })).toBe("slides");
    expect(fileKind({ mimetype: "image/png" })).toBe("image");
    expect(fileKind({ mimetype: "audio/mpeg" })).toBe("audio");
    expect(fileKind({ mimetype: "video/mp4" })).toBe("video");
    expect(fileKind({ mimetype: "application/zip" })).toBe("archive");
    expect(fileKind({ mimetype: "application/x-tar" })).toBe("archive");
    expect(fileKind({ mimetype: "text/html; charset=UTF-8" })).toBe("web");
    expect(fileKind({ mimetype: "text/plain" })).toBe("text");
    expect(fileKind({ mimetype: "text/markdown" })).toBe("text");
    expect(fileKind({ mimetype: "text/x-web-markdown" })).toBe("text");
    expect(fileKind({ mimetype: "text/x-log" })).toBe("text");
    expect(fileKind({ mimetype: "application/json" })).toBe("code");
    expect(fileKind({ mimetype: "text/x-java-source" })).toBe("code");
    expect(fileKind({ mimetype: "application/xml" })).toBe("code");
    expect(fileKind({ mimetype: "message/rfc822" })).toBe("mail");
  });

  it("falls back to the filetype Fess assigns", () => {
    for (const [filetype, kind] of [
      ["pdf", "pdf"], ["word", "word"], ["odt", "word"], ["excel", "sheet"], ["ods", "sheet"],
      ["powerpoint", "slides"], ["odp", "slides"], ["html", "web"], ["txt", "text"], ["png", "image"],
      ["jpg", "image"], ["svg", "image"], ["zip", "archive"],
    ]) expect(fileKind({ filetype }), filetype).toBe(kind);
  });

  it("falls back to the extension of the url when the type says nothing", () => {
    expect(fileKind({ filetype: "others", url: "smb://srv/share/Report.PDF" })).toBe("pdf");
    expect(fileKind({ url: "file:/home/u/main.go" })).toBe("code");
    expect(fileKind({ url: "https://ex.com/a/photo.jpeg?x=1" })).toBe("image");
    expect(fileKind({ url: "smb://srv/s/notes.md" })).toBe("text");
    expect(fileKind({ url: "smb://srv/s/backup.7z" })).toBe("archive");
    expect(fileKind({ url: "smb://srv/s/song.flac" })).toBe("audio");
    expect(fileKind({ url: "smb://srv/s/clip.mkv" })).toBe("video");
    expect(fileKind({ url: "smb://srv/s/mail.eml" })).toBe("mail");
  });

  it("is generic when nothing is known", () => {
    expect(fileKind({})).toBe("other");
    expect(fileKind({ mimetype: "application/octet-stream", filetype: "others", url: "smb://srv/s/noext" })).toBe("other");
    expect(fileKind(null)).toBe("other");
  });

  it("every kind it can return has an icon", () => {
    for (const kind of FILE_KINDS) expect(fileIcon(kind).tagName.toLowerCase(), kind).toBe("svg");
  });
});

describe("fileIcon / uiIcon", () => {
  it("draws a decorative inline SVG carrying its kind", () => {
    const svg = fileIcon("pdf");
    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.classList.contains("fs-ico")).toBe(true);
    expect(svg.classList.contains("fs-ico-pdf")).toBe(true);
    expect(svg.querySelector("path, rect, circle, line, polyline")).not.toBeNull();
  });
  it("uses the generic icon for an unknown kind", () => {
    expect(fileIcon("nonsense").classList.contains("fs-ico-other")).toBe(true);
  });
  it("draws every UI icon and falls back to nothing for an unknown name", () => {
    for (const name of UI_ICONS) {
      const svg = uiIcon(name);
      expect(svg.tagName.toLowerCase(), name).toBe("svg");
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
    expect(uiIcon("no-such-icon")).toBeNull();
  });
  it("draws with currentColor and no external references", () => {
    const html = fileIcon("word").outerHTML + uiIcon("copy").outerHTML;
    expect(html).not.toMatch(/href=|url\(|<image|<use/i);
  });
});
