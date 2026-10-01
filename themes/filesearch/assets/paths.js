// SPDX-License-Identifier: Apache-2.0
// URL shapes -> folders. A Fess crawl stores the document address in `url` in whatever
// form its scheme uses:
//
//   https://ex.com/a/b/c.html?x=1     web: the path segments are the folders
//   smb://srv/share/dir%20a/f.docx    smb: / smb1: with %-encoding kept
//   file:/home/u/a.txt                local path   (also file:///home/..)
//   file:////srv/share/dir/a.txt      UNC path: the first segment is the server
//   file:/C:/x/y.txt                  Windows drive
//   ftp://h/d/f.bin                   ftp
//   s3://bucket/key/obj               object stores: "/" in the key is a pseudo-folder
//
// This module turns each of them into the same parts, and derives from those the display
// path, the breadcrumb and the parent-folder scope. `url` is the only field that keeps
// the whole path (`site` is cut at 100 characters, so it is never used here). Pure.

import { scopeClause } from "./scope.js";

const KIND_BY_SCHEME = {
  http: "web", https: "web",
  smb: "smb", smb1: "smb",
  file: "file",
  ftp: "ftp", ftps: "ftp",
  s3: "object", gcs: "object", storage: "object",
};

/**
 * Percent-decode one path segment for display. A malformed escape is left as written, and a
 * segment that already holds a space or a non-ASCII character is already decoded (smb: URLs
 * are stored decoded, file: URLs encoded), so it is left alone.
 */
export function decodeSegment(segment) {
  if (/[^\x21-\x7e]/.test(segment)) return segment;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function splitPath(path) {
  const segments = path.split("/").filter(s => s !== "");
  const endsWithSlash = path === "" || path.endsWith("/");
  return { segments, endsWithSlash };
}

/**
 * Parse a document address.
 *
 * @param {string} raw
 * @returns {null | {
 *   raw: string, scheme: string, kind: string, host: string, rootPrefix: string,
 *   segments: string[], dirSegments: string[], name: string, endsWithSlash: boolean, unc: boolean
 * }} `rootPrefix` is the raw text up to and including the separator that ends the
 *   authority ("smb://srv/", "file:/", "file:////srv/"); `dirSegments` are the raw
 *   (still %-encoded) folder names after it; `name` is the raw file name, "" for a
 *   trailing-slash address. null when `raw` is not a URL this module understands.
 */
export function parseUrl(raw) {
  if (typeof raw !== "string" || raw === "") return null;
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):([\s\S]*)$/.exec(raw);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  let rest = m[2];
  const kind = KIND_BY_SCHEME[scheme] || "other";
  // A web address carries a query and fragment that are not part of the path; the
  // file-system schemes name files literally, so nothing is cut from them.
  if (kind === "web" || kind === "other") rest = rest.replace(/[?#][\s\S]*$/, "");

  let rootPrefix;
  let host;
  let path;
  let unc = false;
  if (scheme === "file") {
    if (rest.startsWith("////")) {
      // file:////server/share/...: Fess reads the server from the first segment
      const after = rest.slice(4);
      const slash = after.indexOf("/");
      const server = slash < 0 ? after : after.slice(0, slash);
      rootPrefix = "file:////" + server + "/";
      host = decodeSegment(server);
      path = slash < 0 ? "" : after.slice(slash);
      unc = true;
    } else if (rest.startsWith("///")) {
      rootPrefix = "file:///";
      host = "localhost";
      path = rest.slice(3);
    } else if (rest.startsWith("//")) {
      const after = rest.slice(2);
      const slash = after.indexOf("/");
      const authority = slash < 0 ? after : after.slice(0, slash);
      rootPrefix = "file://" + authority + "/";
      host = "localhost";
      path = slash < 0 ? "" : after.slice(slash);
    } else if (rest.startsWith("/")) {
      rootPrefix = "file:/";
      host = "localhost";
      path = rest.slice(1);
    } else {
      return null;
    }
  } else {
    if (!rest.startsWith("//")) return null;
    const after = rest.slice(2);
    const slash = after.indexOf("/");
    const authority = slash < 0 ? after : after.slice(0, slash);
    rootPrefix = scheme + "://" + authority + "/";
    host = authority;
    path = slash < 0 ? "" : after.slice(slash);
  }

  const { segments, endsWithSlash } = splitPath(path);
  const dirSegments = endsWithSlash ? segments : segments.slice(0, -1);
  const name = endsWithSlash ? "" : segments[segments.length - 1];
  return { raw, scheme, kind, host, rootPrefix, segments, dirSegments, name, endsWithSlash, unc };
}

/** The value Fess stores in the `host` field for this address ("" when it is not a URL). */
export function hostOf(url) {
  const p = parseUrl(url);
  return p ? p.host : "";
}

/** The raw prefix of the first `depth` folders of a parsed address, ending in "/". */
export function folderPrefix(parsed, depth) {
  const d = Math.max(0, Math.min(depth, parsed.dirSegments.length));
  return parsed.rootPrefix + parsed.dirSegments.slice(0, d).join("/") + (d > 0 ? "/" : "");
}

const DRIVE = /^[A-Za-z]:$/;

/** Render a parsed address with the given (raw) path segments the way its source writes paths. */
function render(p, rawSegments) {
  const segs = rawSegments.map(decodeSegment);
  if (p.kind === "smb" || (p.kind === "file" && p.unc)) {
    return "\\\\" + [p.host, ...segs].join("\\");
  }
  if (p.kind === "file") {
    if (segs.length > 0 && DRIVE.test(segs[0])) return segs.join("\\");
    return "/" + segs.join("/");
  }
  if (p.kind === "web") {
    return [p.host, ...segs].join("/");
  }
  return p.scheme + "://" + [p.host, ...segs].join("/");
}

/**
 * The address as a person reads a path: UNC for smb, POSIX or drive form for file:, host
 * and path for the web, the URL form for ftp and object stores. %-escapes are decoded.
 * An unparseable value is returned as it is.
 */
export function displayPath(url) {
  const p = parseUrl(url);
  if (!p) return typeof url === "string" ? url : "";
  return render(p, p.name ? [...p.dirSegments, p.name] : p.dirSegments);
}

/** The folder a document sits in, as displayPath writes it (no trailing separator). */
export function locationOf(url) {
  const p = parseUrl(url);
  if (!p) return typeof url === "string" ? url : "";
  return render(p, p.dirSegments);
}

/** What the "copy path" action puts on the clipboard: an OS path for files, the URL otherwise. */
export function copyPathOf(url) {
  const p = parseUrl(url);
  if (p && (p.kind === "smb" || p.kind === "file")) return displayPath(url);
  return typeof url === "string" ? url : "";
}

// ─── scopes ──────────────────────────────────────────────────────────────────────

function hostScope(host) {
  return { type: "host", host };
}

/** A folder scope from a raw prefix; a prefix with no folder in it is the source itself. */
export function scopeFromPrefix(prefix) {
  const withSlash = prefix.endsWith("/") ? prefix : prefix + "/";
  const p = parseUrl(withSlash);
  if (p && p.dirSegments.length === 0 && p.host) return hostScope(p.host);
  return { type: "url", prefix: withSlash };
}

/** The scope of the folder a document sits in; null when `url` is not an address. */
export function scopeOfDocParent(url) {
  const p = parseUrl(url);
  if (!p) return null;
  if (p.dirSegments.length === 0) return p.host ? hostScope(p.host) : null;
  return { type: "url", prefix: folderPrefix(p, p.dirSegments.length) };
}

/** One level up: the parent folder, then the source, then nothing. */
export function parentScope(scope) {
  if (!scope || scope.type !== "url") return null;
  const p = parseUrl(scope.prefix);
  if (!p) return null;
  const n = p.dirSegments.length;
  if (n <= 1) return p.host ? hostScope(p.host) : null;
  return { type: "url", prefix: folderPrefix(p, n - 1) };
}

/** The chain of scopes from the source down to `scope` itself (empty without a scope). */
export function ancestorScopes(scope) {
  if (!scope) return [];
  if (scope.type === "host") return [scope];
  const p = parseUrl(scope.prefix);
  if (!p) return [scope];
  const chain = [];
  if (p.host) chain.push(hostScope(p.host));
  for (let i = 1; i <= p.dirSegments.length; i++) chain.push({ type: "url", prefix: folderPrefix(p, i) });
  return chain;
}

/** One crumb per level of `scope`; each carries the scope a click on it selects. */
export function breadcrumb(scope) {
  if (!scope) return [];
  if (scope.type === "host") return [{ label: scope.host, scope }];
  const p = parseUrl(scope.prefix);
  if (!p) return [{ label: scope.prefix, scope }];
  const crumbs = [];
  if (p.host) crumbs.push({ label: p.host, scope: hostScope(p.host) });
  p.dirSegments.forEach((seg, i) => {
    crumbs.push({ label: decodeSegment(seg), scope: { type: "url", prefix: folderPrefix(p, i + 1) } });
  });
  return crumbs;
}

/** The longest ex_q clause the API accepts; a longer one is refused with HTTP 400. */
export const MAX_CLAUSE_LENGTH = 1000;

/**
 * `scope`, or its nearest ancestor whose ex_q clause fits the limit. A percent-encoded
 * Japanese folder name costs 9 characters a letter, so a deep path can outgrow it; a source
 * always fits.
 */
export function fitScope(scope, limit = MAX_CLAUSE_LENGTH) {
  let s = scope;
  while (s && scopeClause(s).length > limit) s = parentScope(s);
  return s || null;
}

/** A scope written like the Location column writes a folder. */
export function scopeDisplayPath(scope) {
  if (!scope) return "";
  if (scope.type === "host") return scope.host;
  return locationOf(scope.prefix);
}
