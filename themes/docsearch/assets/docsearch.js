// docsearch.js — DocSearch helpers (pure, no DOM at import) + theme toggle (Task 4).
const MIME_MAP = [
  [/pdf/, "pdf"], [/wordprocessingml|msword/, "word"],
  [/spreadsheetml|ms-excel/, "excel"], [/presentationml|ms-powerpoint/, "powerpoint"],
  [/zip|x-tar|x-7z|x-rar|gzip/, "archive"], [/^image\//, "image"],
  [/^text\/(x-|.*(python|java|javascript|shellscript))/, "code"],
  [/^text\/(plain|markdown)/, "text"], [/html|xhtml/, "page"],
];
const EXT_MAP = {
  pdf:"pdf", doc:"word", docx:"word", xls:"excel", xlsx:"excel", ppt:"powerpoint", pptx:"powerpoint",
  zip:"archive", tar:"archive", gz:"archive", "7z":"archive", rar:"archive",
  png:"image", jpg:"image", jpeg:"image", gif:"image", svg:"image", webp:"image",
  md:"text", txt:"text", rst:"text",
  py:"code", js:"code", ts:"code", java:"code", go:"code", rb:"code", c:"code", h:"code",
  cpp:"code", cs:"code", sh:"code", json:"code", yml:"code", yaml:"code", xml:"code",
  html:"page", htm:"page",
};
export function contentTypeKey(doc = {}) {
  const mt = (doc.mimetype || "").toLowerCase();
  if (mt) for (const [re, key] of MIME_MAP) if (re.test(mt)) return key;
  const ft = (doc.filetype || "").toLowerCase();
  if (ft && EXT_MAP[ft]) return EXT_MAP[ft];
  const url = (doc.url || "").toLowerCase().split(/[?#]/)[0];
  const m = url.match(/\.([a-z0-9]{1,5})$/);
  if (m && EXT_MAP[m[1]]) return EXT_MAP[m[1]];
  return "page";
}
export function contentTypeLabelKey(doc) { return "content_type." + contentTypeKey(doc); }
const ICONS = {
  page:'<path d="M6 2h7l5 5v15H6z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M13 2v5h5" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  pdf:'<path d="M6 2h7l5 5v15H6z" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="8" y="17" font-size="6" fill="currentColor">PDF</text>',
  word:'<path d="M6 2h7l5 5v15H6z" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="10" y="17" font-size="6" fill="currentColor">W</text>',
  excel:'<path d="M6 2h7l5 5v15H6z" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="10" y="17" font-size="6" fill="currentColor">X</text>',
  powerpoint:'<path d="M6 2h7l5 5v15H6z" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="10" y="17" font-size="6" fill="currentColor">P</text>',
  code:'<path d="M9 8l-4 4 4 4M15 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  text:'<path d="M5 4h14M5 9h14M5 14h10M5 19h8" stroke="currentColor" stroke-width="1.6"/>',
  image:'<rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="10" r="1.5" fill="currentColor"/><path d="M5 17l4-4 3 3 3-3 4 4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  archive:'<path d="M6 2h12v20H6z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11 4h2v2h-2zM11 8h2v2h-2z" fill="currentColor"/>',
  api:'<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 12h8M12 8v8" stroke="currentColor" stroke-width="1.6"/>',
};
export function contentTypeIcon(doc) {
  const body = ICONS[contentTypeKey(doc)] || ICONS.page;
  return `<svg class="ds-type-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${body}</svg>`;
}
export function deriveBreadcrumb(doc = {}) {
  const url = doc.url || "";
  if (url) {
    let p = url; try { p = new URL(url).pathname; } catch { p = url.replace(/^[a-z]+:\/\/[^/]+/i, ""); }
    const segs = p.split("/").filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
    if (segs.length) return segs.length <= 4 ? segs : [...segs.slice(0, 3), segs.at(-1)];
  }
  if (doc.site) { const segs = String(doc.site).split("/").filter(Boolean); return segs.length ? [segs.at(-1)] : []; }
  return [];
}

// --- light/dark toggle (DOM; called from app.js, never at import) ---
const THEME_KEY = "ds-theme";
export function currentTheme() {
  let s = null; try { s = localStorage.getItem(THEME_KEY); } catch {}
  if (s === "light" || s === "dark") return s;
  return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
}
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const b = document.getElementById("theme-toggle");
  if (b) b.setAttribute("aria-pressed", String(theme === "dark"));
}
export function initThemeToggle() {
  applyTheme(currentTheme());                 // sync button state (theme-init already set the attr pre-paint)
  const b = document.getElementById("theme-toggle");
  if (b) b.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, next); } catch {}
    applyTheme(next);
  });
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    let s = null; try { s = localStorage.getItem(THEME_KEY); } catch {}
    if (s !== "light" && s !== "dark") applyTheme(e.matches ? "dark" : "light");
  });
}
