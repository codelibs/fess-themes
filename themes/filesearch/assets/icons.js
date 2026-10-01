// SPDX-License-Identifier: Apache-2.0
// Icons for the file-search UI, drawn here as inline SVG (no icon font, no external file,
// nothing for the CSP to block), and the decision of which file-type icon a hit gets.
//
//   fileKind(doc)  mimetype first, then the filetype Fess assigned, then the extension of
//                  the url; "other" when none of them says anything
//   fileIcon(kind) a sheet of paper with a glyph for the kind; colour comes from the
//                  .fs-ico-<kind> class in styles.css, every stroke is currentColor
//   uiIcon(name)   the small action / navigation glyphs
//
// Every icon is built with createElementNS from a static spec: no string is ever parsed as
// markup.

const SVG_NS = "http://www.w3.org/2000/svg";

// ─── which kind of file ──────────────────────────────────────────────────────────

export const FILE_KINDS = [
  "pdf", "word", "sheet", "slides", "text", "code", "image", "audio", "video", "archive", "web", "mail", "other",
];

const MIME_RULES = [
  [/pdf/, "pdf"],
  [/wordprocessingml|msword|opendocument\.text|\/rtf|richtext/, "word"],
  [/spreadsheetml|ms-excel|opendocument\.spreadsheet|\/csv/, "sheet"],
  [/presentationml|ms-powerpoint|opendocument\.presentation/, "slides"],
  [/^image\//, "image"],
  [/^audio\//, "audio"],
  [/^video\//, "video"],
  [/zip|x-tar|gzip|x-7z|x-rar|x-bzip|java-archive/, "archive"],
  [/rfc822|ms-outlook/, "mail"],
  [/html/, "web"],
  [/^text\/(plain|markdown|x-markdown|x-web-markdown|x-log)/, "text"],
  [/^text\/x-|javascript|\/json|\/xml|x-sh|x-python|x-yaml|^text\/(css|xml|yaml)/, "code"],
];

const TYPE_KINDS = {
  pdf: "pdf",
  word: "word", odt: "word", doc: "word", docx: "word", rtf: "word",
  excel: "sheet", ods: "sheet", xls: "sheet", xlsx: "sheet", csv: "sheet",
  powerpoint: "slides", odp: "slides", ppt: "slides", pptx: "slides",
  html: "web", htm: "web", xhtml: "web",
  txt: "text", md: "text", rst: "text", log: "text",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", bmp: "image", ico: "image", svg: "image", tiff: "image", tif: "image",
  mp3: "audio", wav: "audio", flac: "audio", ogg: "audio", m4a: "audio", aac: "audio",
  mp4: "video", avi: "video", mov: "video", mkv: "video", webm: "video", wmv: "video",
  zip: "archive", tar: "archive", gz: "archive", tgz: "archive", "7z": "archive", rar: "archive", bz2: "archive", jar: "archive",
  eml: "mail", msg: "mail",
  java: "code", js: "code", mjs: "code", ts: "code", py: "code", c: "code", h: "code", cpp: "code", cs: "code", go: "code",
  rb: "code", php: "code", sh: "code", json: "code", xml: "code", yml: "code", yaml: "code", css: "code", sql: "code",
  kt: "code", rs: "code", swift: "code", groovy: "code", gradle: "code",
};

/** The kind of file a hit is. */
export function fileKind(doc) {
  if (!doc) return "other";
  const mime = String(doc.mimetype || "").toLowerCase();
  if (mime) for (const [re, kind] of MIME_RULES) if (re.test(mime)) return kind;
  const type = String(doc.filetype || "").toLowerCase();
  if (type && TYPE_KINDS[type]) return TYPE_KINDS[type];
  const path = String(doc.url || "").toLowerCase().split(/[?#]/)[0];
  const ext = /\.([a-z0-9]{1,8})$/.exec(path);
  if (ext && TYPE_KINDS[ext[1]]) return TYPE_KINDS[ext[1]];
  return "other";
}

// ─── drawing ─────────────────────────────────────────────────────────────────────

function svgRoot(className) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  return svg;
}

/** Append shapes: a string is a path; [tag, attrs] is any other element. */
function draw(svg, shapes) {
  for (const shape of shapes) {
    const [tag, attrs] = typeof shape === "string" ? ["path", { d: shape }] : shape;
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    svg.appendChild(node);
  }
  return svg;
}

const TINT = { fill: "currentColor", "fill-opacity": ".12" };
const SOLID = { fill: "currentColor", stroke: "none" };

// A sheet of paper with a folded corner, and (per kind) a glyph on it.
const PAGE = [
  ["path", { d: "M6.5 3h7l4.5 4.5v13a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-17a.5.5 0 0 1 .5-.5z", ...TINT }],
  "M13.5 3v4.5H18",
];

const GLYPHS = {
  pdf: [["rect", { x: 6, y: 14.5, width: 12, height: 4, rx: ".6", ...SOLID }], "M9 11h6M9 12.8h4"],
  word: ["M8.6 11l1.4 6 2-4.4 2 4.4 1.4-6"],
  sheet: [["rect", { x: 8.5, y: 11, width: 7, height: 6.5, rx: ".5" }], "M8.5 14.2h7M12 11v6.5"],
  slides: [["rect", { x: 8.2, y: 10.6, width: 7.6, height: 5, rx: ".6" }], "M12 15.6v2M10.2 17.8h3.6"],
  text: ["M8.5 11h7M8.5 13.5h7M8.5 16h4.5"],
  code: ["M10.6 11.4L8.4 14l2.2 2.6M13.4 11.4l2.2 2.6-2.2 2.6"],
  image: [["circle", { cx: 10.6, cy: 11.8, r: 1, ...SOLID }], "M7.8 18l3.2-3.4 2.2 2 1.6-1.6 2.4 3"],
  audio: ["M10.6 17V11.8l4.8-1.1V15.9", ["circle", { cx: 9.4, cy: 17, r: 1.3 }], ["circle", { cx: 14.2, cy: 15.9, r: 1.3 }]],
  video: [["path", { d: "M10.4 11.6l4.6 2.9-4.6 2.9z", ...SOLID }]],
  archive: ["M12 3v2M12 6.4v1.2", "M10.4 9.2h3.2v2.4h-3.2zM10.4 13.4h3.2v2.4h-3.2z"],
  web: [["circle", { cx: 12, cy: 14.2, r: 3.7 }], "M8.3 14.2h7.4M12 10.5c1.3 1.1 1.3 6.2 0 7.4M12 10.5c-1.3 1.1-1.3 6.2 0 7.4"],
  mail: [["rect", { x: 8, y: 11.5, width: 8, height: 6, rx: ".7" }], "M8.2 12l3.8 3 3.8-3"],
  other: ["M9 12.5h6M9 15h4"],
};

/** The icon for a kind of file; an unknown kind draws the generic one. */
export function fileIcon(kind) {
  const k = FILE_KINDS.includes(kind) ? kind : "other";
  const svg = svgRoot("fs-ico fs-ico-" + k);
  draw(svg, PAGE);
  draw(svg, GLYPHS[k]);
  return svg;
}

const FOLDER = "M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2.2h8A1.5 1.5 0 0 1 20.5 9.2v8.8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z";

const UI = {
  folder: [["path", { d: FOLDER, ...TINT }]],
  "folder-open": [
    "M3.5 18V7A1.5 1.5 0 0 1 5 5.5h4l2 2.2h7a1.5 1.5 0 0 1 1.5 1.5V11",
    ["path", { d: "M3.8 18.5l2.3-6.3a1.4 1.4 0 0 1 1.3-.9h13.2a.9.9 0 0 1 .85 1.2l-2.1 5.4a1.4 1.4 0 0 1-1.3.9H5.2a1.4 1.4 0 0 1-1.4-.3z", ...TINT }],
  ],
  server: [
    ["rect", { x: 4, y: 4.5, width: 16, height: 6, rx: 1.4, ...TINT }],
    ["rect", { x: 4, y: 13.5, width: 16, height: 6, rx: 1.4, ...TINT }],
    ["circle", { cx: 7.6, cy: 7.5, r: ".7", ...SOLID }],
    ["circle", { cx: 7.6, cy: 16.5, r: ".7", ...SOLID }],
    "M11 7.5h6M11 16.5h6",
  ],
  chevron: ["M9.5 6l6 6-6 6"],
  copy: [["rect", { x: 8.5, y: 8.5, width: 11, height: 11, rx: 1.6 }], "M15.5 8.5V6.6a1.6 1.6 0 0 0-1.6-1.6H6.6A1.6 1.6 0 0 0 5 6.6v7.3a1.6 1.6 0 0 0 1.6 1.6h1.9"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  external: ["M13.5 5H19v5.5M19 5l-8 8", "M17 14v3.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 17.5v-9A1.5 1.5 0 0 1 6.5 7H10"],
  star: ["M12 4.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.5 7.2 19.1l.9-5.4L4.2 9.9l5.4-.8z"],
  eye: ["M2.8 12S6 5.8 12 5.8 21.2 12 21.2 12 18 18.2 12 18.2 2.8 12 2.8 12z", ["circle", { cx: 12, cy: 12, r: 2.8 }]],
  close: ["M6 6l12 12M18 6L6 18"],
  "view-details": ["M4 6.5h16M4 12h16M4 17.5h16", "M9.5 4.5v15"],
  "view-compact": ["M4 6h16M4 10h16M4 14h16M4 18h16"],
  "view-tiles": [
    ["rect", { x: 4, y: 4, width: 7, height: 7, rx: 1.2 }], ["rect", { x: 13, y: 4, width: 7, height: 7, rx: 1.2 }],
    ["rect", { x: 4, y: 13, width: 7, height: 7, rx: 1.2 }], ["rect", { x: 13, y: 13, width: 7, height: 7, rx: 1.2 }],
  ],
  "sort-asc": ["M12 19V6M7 11l5-5 5 5"],
  "sort-desc": ["M12 5v13M7 13l5 5 5-5"],
  "sort-none": ["M8 9l4-4 4 4M8 15l4 4 4-4"],
  filter: ["M4.5 5.5h15l-5.8 7v5.3l-3.4 1.7v-7z"],
  search: [["circle", { cx: 10.5, cy: 10.5, r: 5.5 }], "M15 15l5 5"],
  up: ["M12 19V6M6.5 11.5L12 6l5.5 5.5"],
  panel: [["rect", { x: 4, y: 5, width: 16, height: 14, rx: 1.6 }], "M14.5 5v14"],
  tree: [["rect", { x: 4, y: 5, width: 16, height: 14, rx: 1.6 }], "M9.5 5v14"],
  warning: ["M12 4.5l8.5 14.5h-17z", "M12 10v4M12 16.6v.1"],
  info: [["circle", { cx: 12, cy: 12, r: 8.5 }], "M12 11v5M12 8v.1"],
  clock: [["circle", { cx: 12, cy: 12, r: 8.5 }], "M12 7.5V12l3 2"],
  more: [["circle", { cx: 6, cy: 12, r: "1", ...SOLID }], ["circle", { cx: 12, cy: 12, r: "1", ...SOLID }], ["circle", { cx: 18, cy: 12, r: "1", ...SOLID }]],
};

export const UI_ICONS = Object.keys(UI);

/** A small UI glyph by name; null for an unknown name. */
export function uiIcon(name) {
  const spec = UI[name];
  if (!spec) return null;
  return draw(svgRoot("fs-ui fs-ui-" + name), spec);
}
