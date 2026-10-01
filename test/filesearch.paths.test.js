// SPDX-License-Identifier: Apache-2.0
// filesearch: paths.js — every URL shape a Fess crawl stores in `url`, normalised into
// the same parts, and the display path, breadcrumb and parent-folder scope derived
// from them. `url` is the only field that keeps the whole path (`site` is cut at 100).

import { describe, it, expect } from "vitest";
import {
  parseUrl, hostOf, folderPrefix, displayPath, locationOf, copyPathOf,
  scopeFromPrefix, breadcrumb, parentScope, scopeOfDocParent, ancestorScopes,
  scopeDisplayPath, decodeSegment, fitScope, MAX_CLAUSE_LENGTH,
} from "../themes/filesearch/assets/paths.js";

describe("parseUrl", () => {
  it("splits an http(s) URL; query and fragment never reach the path", () => {
    expect(parseUrl("https://ex.com/a/b/c.html?x=1#f")).toMatchObject({
      scheme: "https", kind: "web", host: "ex.com", rootPrefix: "https://ex.com/",
      dirSegments: ["a", "b"], name: "c.html", endsWithSlash: false,
    });
  });

  it("keeps a port in the host, as Fess does", () => {
    expect(parseUrl("http://ex.com:8080/a")).toMatchObject({
      host: "ex.com:8080", rootPrefix: "http://ex.com:8080/", dirSegments: [], name: "a",
    });
  });

  it("treats a trailing slash as a folder, not a file", () => {
    expect(parseUrl("https://ex.com/docs/")).toMatchObject({ dirSegments: ["docs"], name: "", endsWithSlash: true });
    expect(parseUrl("https://ex.com/")).toMatchObject({ dirSegments: [], name: "", endsWithSlash: true });
    expect(parseUrl("https://ex.com")).toMatchObject({ rootPrefix: "https://ex.com/", dirSegments: [], name: "" });
  });

  it("parses smb: and smb1: as one kind, keeping %-encoding in the raw segments", () => {
    expect(parseUrl("smb://srv/share/dir%20a/f.docx")).toMatchObject({
      scheme: "smb", kind: "smb", host: "srv", rootPrefix: "smb://srv/",
      dirSegments: ["share", "dir%20a"], name: "f.docx",
    });
    expect(parseUrl("smb1://srv/share/f.txt")).toMatchObject({ scheme: "smb1", kind: "smb", host: "srv" });
  });

  it("parses file:/ (one slash) as a local path on localhost", () => {
    expect(parseUrl("file:/home/u/a.txt")).toMatchObject({
      kind: "file", host: "localhost", rootPrefix: "file:/", dirSegments: ["home", "u"], name: "a.txt", unc: false,
    });
  });

  it("parses file:/// (three slashes) as a local path on localhost", () => {
    expect(parseUrl("file:///home/u/a.txt")).toMatchObject({
      kind: "file", host: "localhost", rootPrefix: "file:///", dirSegments: ["home", "u"], name: "a.txt",
    });
  });

  it("parses file://// as a UNC path: the first segment is the server", () => {
    expect(parseUrl("file:////srv/share/dir/a.txt")).toMatchObject({
      kind: "file", host: "srv", rootPrefix: "file:////srv/", dirSegments: ["share", "dir"], name: "a.txt", unc: true,
    });
  });

  it("keeps a Windows drive as the first folder", () => {
    expect(parseUrl("file:/C:/x/y.txt")).toMatchObject({ host: "localhost", dirSegments: ["C:", "x"], name: "y.txt" });
  });

  it("parses ftp: and the object-store schemes", () => {
    expect(parseUrl("ftp://h/d/f.bin")).toMatchObject({ kind: "ftp", host: "h", rootPrefix: "ftp://h/", dirSegments: ["d"], name: "f.bin" });
    expect(parseUrl("s3://bucket/key/obj")).toMatchObject({ kind: "object", host: "bucket", rootPrefix: "s3://bucket/", dirSegments: ["key"], name: "obj" });
    expect(parseUrl("gcs://b/o.txt")).toMatchObject({ kind: "object", host: "b", dirSegments: [], name: "o.txt" });
  });

  it("collapses repeated slashes in the path", () => {
    expect(parseUrl("https://ex.com/a//b/c.txt").dirSegments).toEqual(["a", "b"]);
  });

  it("returns null for anything that is not a URL", () => {
    for (const v of ["", "/just/a/path", "no-scheme", null, undefined, 42]) expect(parseUrl(v), String(v)).toBeNull();
  });
});

describe("hostOf", () => {
  it("follows the rule Fess uses to fill the host field", () => {
    expect(hostOf("https://ex.com/a")).toBe("ex.com");
    expect(hostOf("smb://srv/share/f")).toBe("srv");
    expect(hostOf("file:/home/u/a")).toBe("localhost");
    expect(hostOf("file:////srv/share/a")).toBe("srv");
    expect(hostOf("s3://bucket/k")).toBe("bucket");
    expect(hostOf("nonsense")).toBe("");
  });
});

describe("folderPrefix", () => {
  it("rebuilds the raw prefix of the first N folders, always ending in a slash", () => {
    const p = parseUrl("smb://srv/share/dir%20a/sub/f.docx");
    expect(folderPrefix(p, 0)).toBe("smb://srv/");
    expect(folderPrefix(p, 1)).toBe("smb://srv/share/");
    expect(folderPrefix(p, 2)).toBe("smb://srv/share/dir%20a/");
    expect(folderPrefix(p, 3)).toBe("smb://srv/share/dir%20a/sub/");
    expect(folderPrefix(p, 99)).toBe("smb://srv/share/dir%20a/sub/");
  });
});

describe("decodeSegment", () => {
  it("decodes %-escapes, and leaves a malformed escape as it is", () => {
    expect(decodeSegment("dir%20a")).toBe("dir a");
    expect(decodeSegment("%E6%97%A5%E6%9C%AC")).toBe("日本");
    expect(decodeSegment("100%")).toBe("100%");
    expect(decodeSegment("%E3%81")).toBe("%E3%81");
  });

  it("leaves a segment that is already decoded alone (smb: URLs are stored decoded)", () => {
    expect(decodeSegment("Incident Reports")).toBe("Incident Reports");
    expect(decodeSegment("総務部")).toBe("総務部");
    expect(decodeSegment("Growth plan 15% target.txt")).toBe("Growth plan 15% target.txt");
    expect(displayPath("smb://samba01/share/Incident Reports/総務部/a b.docx")).toBe("\\\\samba01\\share\\Incident Reports\\総務部\\a b.docx");
  });
});

describe("displayPath", () => {
  it("shows smb as a Windows UNC path", () => {
    expect(displayPath("smb://srv/share/dir%20a/f.docx")).toBe("\\\\srv\\share\\dir a\\f.docx");
  });
  it("shows file: as a POSIX path", () => {
    expect(displayPath("file:/home/u/a%20b.txt")).toBe("/home/u/a b.txt");
    expect(displayPath("file:///home/u/a.txt")).toBe("/home/u/a.txt");
  });
  it("shows file:// UNC and drive forms the Windows way", () => {
    expect(displayPath("file:////srv/share/dir/a.txt")).toBe("\\\\srv\\share\\dir\\a.txt");
    expect(displayPath("file:/C:/x/y.txt")).toBe("C:\\x\\y.txt");
  });
  it("shows web documents as host and path without the scheme or query", () => {
    expect(displayPath("https://ex.com/a/b/c.html?x=1#f")).toBe("ex.com/a/b/c.html");
  });
  it("keeps the scheme for ftp and object stores", () => {
    expect(displayPath("ftp://h/d/f.bin")).toBe("ftp://h/d/f.bin");
    expect(displayPath("s3://bucket/key/obj")).toBe("s3://bucket/key/obj");
  });
  it("returns an unparseable value unchanged", () => {
    expect(displayPath("weird")).toBe("weird");
    expect(displayPath("")).toBe("");
    expect(displayPath(undefined)).toBe("");
  });
});

describe("locationOf (the parent folder shown in the Location column)", () => {
  it("drops the file name and any trailing separator", () => {
    expect(locationOf("smb://srv/share/dir/f.docx")).toBe("\\\\srv\\share\\dir");
    expect(locationOf("smb://srv/f.docx")).toBe("\\\\srv");
    expect(locationOf("file:/home/u/a.txt")).toBe("/home/u");
    expect(locationOf("file:/a.txt")).toBe("/");
    expect(locationOf("https://ex.com/a/b/c.html")).toBe("ex.com/a/b");
    expect(locationOf("https://ex.com/index.html")).toBe("ex.com");
    expect(locationOf("s3://bucket/key/obj")).toBe("s3://bucket/key");
  });
  it("treats a trailing-slash URL as its own location", () => {
    expect(locationOf("https://ex.com/docs/")).toBe("ex.com/docs");
  });
});

describe("copyPathOf", () => {
  it("copies an OS-style path for file-system sources and the URL for the rest", () => {
    expect(copyPathOf("smb://srv/share/f.txt")).toBe("\\\\srv\\share\\f.txt");
    expect(copyPathOf("file:/home/u/a.txt")).toBe("/home/u/a.txt");
    expect(copyPathOf("https://ex.com/a?x=1")).toBe("https://ex.com/a?x=1");
    expect(copyPathOf("s3://bucket/key")).toBe("s3://bucket/key");
  });
});

describe("scope derivation", () => {
  it("scopeFromPrefix normalises to a trailing slash", () => {
    expect(scopeFromPrefix("smb://srv/share")).toEqual({ type: "url", prefix: "smb://srv/share/" });
    expect(scopeFromPrefix("smb://srv/share/")).toEqual({ type: "url", prefix: "smb://srv/share/" });
  });

  it("scopeOfDocParent names the folder a document sits in", () => {
    expect(scopeOfDocParent("smb://srv/share/dir/f.docx")).toEqual({ type: "url", prefix: "smb://srv/share/dir/" });
    expect(scopeOfDocParent("file:/home/u/a.txt")).toEqual({ type: "url", prefix: "file:/home/u/" });
  });

  it("scopeOfDocParent falls back to the source for a file at the root", () => {
    expect(scopeOfDocParent("https://ex.com/index.html")).toEqual({ type: "host", host: "ex.com" });
    expect(scopeOfDocParent("file:/a.txt")).toEqual({ type: "host", host: "localhost" });
  });

  it("scopeOfDocParent returns null for a value that is not a URL", () => {
    expect(scopeOfDocParent("junk")).toBeNull();
  });

  it("parentScope walks up one folder, then to the source, then to nothing", () => {
    expect(parentScope({ type: "url", prefix: "smb://srv/share/dir/" })).toEqual({ type: "url", prefix: "smb://srv/share/" });
    expect(parentScope({ type: "url", prefix: "smb://srv/share/" })).toEqual({ type: "host", host: "srv" });
    expect(parentScope({ type: "host", host: "srv" })).toBeNull();
    expect(parentScope(null)).toBeNull();
  });

  it("parentScope handles a UNC file: share and a local path", () => {
    expect(parentScope({ type: "url", prefix: "file:////srv/share/" })).toEqual({ type: "host", host: "srv" });
    expect(parentScope({ type: "url", prefix: "file:/home/u/" })).toEqual({ type: "url", prefix: "file:/home/" });
    expect(parentScope({ type: "url", prefix: "file:/home/" })).toEqual({ type: "host", host: "localhost" });
  });

  it("ancestorScopes runs from the source down to the scope itself", () => {
    expect(ancestorScopes({ type: "url", prefix: "smb://srv/share/dir/" })).toEqual([
      { type: "host", host: "srv" },
      { type: "url", prefix: "smb://srv/share/" },
      { type: "url", prefix: "smb://srv/share/dir/" },
    ]);
    expect(ancestorScopes({ type: "host", host: "srv" })).toEqual([{ type: "host", host: "srv" }]);
    expect(ancestorScopes(null)).toEqual([]);
  });
});

describe("fitScope", () => {
  const deep = n => ({ type: "url", prefix: "file:/data/" + "%E7%B7%8F%E5%8B%99%E9%83%A8/".repeat(n) });

  it("keeps a scope whose ex_q clause fits", () => {
    const scope = { type: "url", prefix: "smb://srv/share/dir/" };
    expect(fitScope(scope)).toBe(scope);
    expect(MAX_CLAUSE_LENGTH).toBe(1000);
  });

  it("walks up to the nearest folder whose clause fits, and never gives up the source", () => {
    const fitted = fitScope(deep(40));
    expect(fitted.type).toBe("url");
    expect(fitted.prefix.length).toBeLessThan(deep(40).prefix.length);
    expect(fitted.prefix.startsWith("file:/data/")).toBe(true);
    expect(fitScope({ type: "url", prefix: "file:/" + "x".repeat(2000) + "/" }, 100)).toEqual({ type: "host", host: "localhost" });
  });

  it("is null for no scope", () => {
    expect(fitScope(null)).toBeNull();
  });
});

describe("breadcrumb", () => {
  it("is empty without a scope", () => {
    expect(breadcrumb(null)).toEqual([]);
  });

  it("starts at the source and adds one crumb per folder, each carrying the scope it selects", () => {
    expect(breadcrumb({ type: "url", prefix: "smb://srv/share/dir%20a/" })).toEqual([
      { label: "srv", scope: { type: "host", host: "srv" } },
      { label: "share", scope: { type: "url", prefix: "smb://srv/share/" } },
      { label: "dir a", scope: { type: "url", prefix: "smb://srv/share/dir%20a/" } },
    ]);
  });

  it("is a single crumb for a source scope", () => {
    expect(breadcrumb({ type: "host", host: "ex.com" })).toEqual([{ label: "ex.com", scope: { type: "host", host: "ex.com" } }]);
  });

  it("walks a posix folder from localhost", () => {
    expect(breadcrumb({ type: "url", prefix: "file:/home/u/" }).map(c => c.label)).toEqual(["localhost", "home", "u"]);
  });
});

describe("scopeDisplayPath", () => {
  it("renders a folder scope the way the Location column does", () => {
    expect(scopeDisplayPath({ type: "url", prefix: "smb://srv/share/dir/" })).toBe("\\\\srv\\share\\dir");
    expect(scopeDisplayPath({ type: "url", prefix: "file:/home/u/" })).toBe("/home/u");
    expect(scopeDisplayPath({ type: "url", prefix: "https://ex.com/a/" })).toBe("ex.com/a");
    expect(scopeDisplayPath({ type: "host", host: "srv" })).toBe("srv");
    expect(scopeDisplayPath(null)).toBe("");
  });
});
