// SPDX-License-Identifier: Apache-2.0
//
// search.js — code-aware search engine + result cards for the codesearch theme.
//
// Reads the URL as the single source of truth (q, start, num, sort), translates
// the query box through query.js (parseQuery → toFessQuery), and renders code
// result cards with an organization/repository/path breadcrumb, an open-in-repo
// link, a language badge, a favorite control, a line-number gutter parsed from
// the ingest-time `Lnn:` prefixes, and the match-highlighted snippet.
//
// XSS-safety contract: every field value is written with document.createElement +
// textContent. The ONLY place HTML is injected is the snippet body, via
// renderHighlightedSnippet() from format.js (escape-then-restore <strong>/<em>).
// No untrusted string is ever passed to innerHTML anywhere else in this module.
//
// Syntax coloring (highlight.js) is DEFERRED — see the report. Applying a
// tokenizer over already-escaped HTML that contains the server's <strong>/<em>
// match tags cannot be done without risking tag corruption or an XSS regression,
// so the must-haves (match-highlight, gutter, monospace, XSS safety) ship alone.

import * as api from "./api.js";
import { t } from "./i18n.js";
import { formatFileSize, formatDate, renderHighlightedSnippet } from "./format.js";
import { navigate } from "./router.js";
import { parseQuery, toFessQuery, addQualifier, removeQualifier, QUALIFIER_MAP } from "./query.js";

/** Guard: prevent duplicate event-listener registration on hot-reload / re-attach. */
let attached = false;

/** AbortController for the most-recent in-flight search; null when idle. */
let currentSearchAbort = null;

/** The seven custom codesearch fields. A doc is "code" when at least one is present. */
const CODE_FIELDS = ["domain", "organization", "repository", "path", "repository_url", "owner", "homepage"];

/** Density preference key (persisted to localStorage). */
const DENSITY_KEY = "codesearch.density";

/** Sort options offered in the summary sort control. Values map to Fess sort keys. */
const SORT_OPTIONS = [
  { value: "",                   key: "search.sort.relevance" },
  { value: "last_modified.desc", key: "search.sort.created_desc" },
  { value: "last_modified.asc",  key: "search.sort.created_asc" },
  { value: "content_length.desc", key: "search.sort.length_desc" },
];

/**
 * Module-level search state. The URL is authoritative; runFromUrl() hydrates
 * this object from location.search before every search.
 */
const state = {
  q: "",
  start: 0,
  num: 20,
  sort: "",
  requestedTime: 0,
};

// ---------------------------------------------------------------------------
// Small DOM + safety helpers
// ---------------------------------------------------------------------------

/**
 * Create an element. opts.text sets textContent (XSS-safe); opts.attrs / dataset
 * set attributes. Never assigns innerHTML.
 */
function el(tag, opts) {
  const node = document.createElement(tag);
  if (!opts) return node;
  if (opts.className) node.className = opts.className;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, String(v));
  if (opts.dataset) for (const [k, v] of Object.entries(opts.dataset)) node.dataset[k] = String(v);
  return node;
}

/**
 * Return `url` only when its scheme is http/https/ftp/ftps; otherwise "#".
 * Prevents javascript:/data:/vbscript: injection through any field used as href.
 */
function safeHref(url) {
  if (!url || typeof url !== "string") return "#";
  try {
    const u = new URL(url, location.href);
    if (u.protocol === "https:" || u.protocol === "http:" ||
        u.protocol === "ftp:" || u.protocol === "ftps:") {
      return url;
    }
  } catch {
    return "#";
  }
  return "#";
}

/** True when the document carries any of the seven codesearch fields. */
function isCodeDoc(d) {
  return CODE_FIELDS.some(f => d[f] != null && String(d[f]).trim() !== "");
}

/**
 * Best-effort "open in repository" URL.
 * - repository_url + "/blob/HEAD/" + path  when both are present;
 * - repository_url                          when only it is present;
 * - url                                     otherwise.
 * Always passed through safeHref so an unsafe scheme degrades to "#".
 */
function openInRepoHref(d) {
  const repo = d.repository_url ? String(d.repository_url).replace(/\/+$/, "") : "";
  if (repo && d.path) {
    const path = String(d.path).replace(/^\/+/, "");
    return safeHref(repo + "/blob/HEAD/" + path);
  }
  if (repo) return safeHref(repo);
  return safeHref(d.url || "");
}

// ---------------------------------------------------------------------------
// Snippet → line-number gutter + code rendering
// ---------------------------------------------------------------------------

/**
 * Render the highlighted snippet into a two-column code block: a line-number
 * GUTTER (parsed from leading `Lnn:` tokens) and the code text. The line number
 * is NEVER part of the copyable code column.
 *
 * The snippet text is HTML (it may contain the server's <strong>/<em> match
 * tags). We split it into physical lines, strip a leading `L<number>:` per line
 * for the gutter, and inject the remainder through renderHighlightedSnippet so
 * the match tags survive but any other markup stays escaped.
 *
 * @param {string} raw - content_description (may contain Lnn: prefixes + <strong>/<em>)
 * @returns {HTMLElement} a <div class="code-block">
 */
function buildCodeBlock(raw) {
  const block = el("div", { className: "code-block" });
  const text = String(raw || "");
  // Server fragments are usually joined by <br> or newlines; normalise <br> to \n
  // so each physical line becomes one gutter row. Case-insensitive, tolerant of
  // <br>, <br/>, <br />.
  const lines = text.replace(/<br\s*\/?>/gi, "\n").split("\n");
  for (const line of lines) {
    if (line === "" && lines.length > 1) {
      // Skip stray empty fragments only when there is other content.
      continue;
    }
    const row = el("div", { className: "code-row" });
    const gutter = el("span", { className: "code-gutter", attrs: { "aria-hidden": "true" } });
    // Parse a leading line-number token: optional whitespace, "L", digits, ":".
    const m = line.match(/^\s*L(\d+):(.*)$/);
    let codeText = line;
    if (m) {
      gutter.textContent = m[1];
      codeText = m[2];
    } else {
      gutter.textContent = ""; // blank gutter cell for un-prefixed lines
    }
    const code = el("code", { className: "code-text" });
    // The ONLY HTML injection: escape-then-restore <strong>/<em> from the server.
    // codeText is a substring of the server snippet; renderHighlightedSnippet
    // re-escapes everything and only un-escapes the two match tags.
    code.innerHTML = renderHighlightedSnippet(codeText); // eslint-disable-line no-unsanitized/property
    row.appendChild(gutter);
    row.appendChild(code);
    block.appendChild(row);
  }
  return block;
}

// ---------------------------------------------------------------------------
// Result card
// ---------------------------------------------------------------------------

/**
 * Build a single <li> result card for a search document.
 * Code docs get the breadcrumb / open-in-repo / language-badge / gutter layout;
 * non-codesearch docs degrade to a generic title-link + snippet card.
 *
 * @param {Object} d - one element of env.data
 * @param {string} [queryId] - server query_id (for favorite attribution)
 * @returns {HTMLLIElement}
 */
function buildResultCard(d, queryId) {
  const li = el("li", {
    className: "result-card",
    dataset: { docId: d.doc_id || "", queryId: queryId || "" }
  });

  if (!isCodeDoc(d)) {
    return buildGenericCard(li, d);
  }

  // ---- Header: org / repo · path  +  open-in-repo  +  language badge  +  ★ ----
  const header = el("div", { className: "result-head" });

  const crumb = el("div", { className: "result-crumb mono" });
  if (d.organization) {
    crumb.appendChild(el("span", { className: "crumb-org", text: d.organization }));
    crumb.appendChild(document.createTextNode(" / "));
  }
  if (d.repository) {
    crumb.appendChild(el("span", { className: "crumb-repo", text: d.repository }));
  }
  if (d.path) {
    crumb.appendChild(document.createTextNode(" · "));
    crumb.appendChild(el("span", { className: "crumb-path", text: d.path }));
  }
  header.appendChild(crumb);

  const actions = el("div", { className: "result-actions" });

  // Language badge from filetype.
  if (d.filetype) {
    actions.appendChild(el("span", { className: "lang-badge", text: String(d.filetype) }));
  }

  // ↗ open-in-repo link (new tab, rel=noopener). Built best-effort.
  const openHref = openInRepoHref(d);
  if (openHref !== "#") {
    const open = el("a", {
      className: "open-repo",
      attrs: {
        href: openHref,
        target: "_blank",
        rel: "noopener",
        "aria-label": t("result.open_in_repo")
      }
    });
    open.appendChild(el("span", { className: "icon", attrs: { "aria-hidden": "true" }, text: "↗" }));
    actions.appendChild(open);
  }

  // ★ favorite control. Display gated on features.user_favorite (parity with the
  // reference theme); adding requires login (toggleFavorite handles the 401 gate).
  const features = (api.getConfig() || {}).features || {};
  if (features.user_favorite) {
    const favBtn = el("button", {
      className: "favorite-btn",
      attrs: { type: "button", "aria-pressed": "false", "aria-label": t("result.favorite_add") }
    });
    favBtn.appendChild(el("span", { className: "icon star", attrs: { "aria-hidden": "true" }, text: "☆" }));
    setFavoriteUi(favBtn, false, Number(d.favorite_count) || 0);
    actions.appendChild(favBtn);
  }
  header.appendChild(actions);
  li.appendChild(header);

  // ---- Body: line-gutter code block from content_description ----
  const snippet = d.content_description || d.digest || "";
  if (snippet) {
    li.appendChild(buildCodeBlock(snippet));
  }

  // ---- Footer: domain · owner · last_modified (omit absent pieces) ----
  const footer = el("div", { className: "result-foot mono" });
  const footParts = [];
  if (d.domain) footParts.push(d.domain);
  if (d.owner) footParts.push(d.owner);
  const dateStr = formatDate(d.last_modified || d.created);
  if (dateStr) footParts.push(dateStr);
  footParts.forEach((part, i) => {
    if (i > 0) footer.appendChild(el("span", { className: "foot-sep", attrs: { "aria-hidden": "true" }, text: " · " }));
    footer.appendChild(el("span", { className: "foot-part", text: part }));
  });
  if (footParts.length > 0) li.appendChild(footer);

  return li;
}

/**
 * Generic fallback card for non-codesearch indices: title link + snippet.
 * @param {HTMLLIElement} li - the (already-created) card element to fill
 * @param {Object} d
 */
function buildGenericCard(li, d) {
  li.classList.add("result-generic");
  const head = el("div", { className: "result-head" });
  const titleWrap = el("div", { className: "result-title" });
  const href = safeHref(d.url || "");
  const a = el("a", {
    className: "result-link",
    attrs: href !== "#"
      ? { href, target: "_blank", rel: "noopener" }
      : {}
  });
  // content_title may carry highlight markup; fall back to title/url as text.
  if (d.content_title) {
    a.innerHTML = renderHighlightedSnippet(d.content_title); // eslint-disable-line no-unsanitized/property
  } else {
    a.textContent = d.title || d.url || "";
  }
  titleWrap.appendChild(a);
  head.appendChild(titleWrap);
  if (d.filetype) {
    const actions = el("div", { className: "result-actions" });
    actions.appendChild(el("span", { className: "lang-badge", text: String(d.filetype) }));
    head.appendChild(actions);
  }
  li.appendChild(head);

  const snippet = d.content_description || d.digest || "";
  if (snippet) {
    const body = el("div", { className: "result-snippet" });
    body.innerHTML = renderHighlightedSnippet(snippet); // eslint-disable-line no-unsanitized/property
    li.appendChild(body);
  }

  // Footer: url · size · last_modified.
  const footer = el("div", { className: "result-foot mono" });
  const parts = [];
  if (d.url) parts.push(d.url);
  const sizeStr = formatFileSize(d.content_length);
  if (sizeStr) parts.push(sizeStr);
  const dateStr = formatDate(d.last_modified || d.created);
  if (dateStr) parts.push(dateStr);
  parts.forEach((part, i) => {
    if (i > 0) footer.appendChild(el("span", { className: "foot-sep", attrs: { "aria-hidden": "true" }, text: " · " }));
    footer.appendChild(el("span", { className: "foot-part", text: part }));
  });
  if (parts.length > 0) li.appendChild(footer);
  return li;
}

// ---------------------------------------------------------------------------
// Favorites (best-effort; reuse the reference theme endpoint contract)
// ---------------------------------------------------------------------------

function setFavoriteUi(btn, on, count) {
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.setAttribute("aria-label", on ? t("result.favorite_remove") : t("result.favorite_add"));
  btn.classList.toggle("is-on", !!on);
  const icon = btn.querySelector(".star");
  if (icon) icon.textContent = on ? "★" : "☆";
  btn.dataset.count = String(count || 0);
  let countEl = btn.querySelector(".favorite-count");
  if (count > 0) {
    if (!countEl) {
      countEl = el("span", { className: "favorite-count" });
      btn.appendChild(countEl);
    }
    countEl.textContent = String(count);
  } else if (countEl) {
    btn.removeChild(countEl);
  }
}

async function toggleFavorite(docId, btn, queryId) {
  try {
    const env = await api.post("/documents/" + encodeURIComponent(docId) + "/favorite", { query_id: queryId || "" });
    setFavoriteUi(btn, !!env.favorite, env.count || 0);
  } catch (e) {
    // 401/403: adding a favorite requires login — open the login modal if present.
    if (e && (e.code === "AUTH_REQUIRED" || e.httpStatus === 401 || e.httpStatus === 403)) {
      const modal = document.getElementById("login-modal");
      if (modal && window.bootstrap && window.bootstrap.Modal) {
        window.bootstrap.Modal.getOrCreateInstance(modal).show();
      } else if (modal) {
        modal.classList.add("show");
        modal.removeAttribute("aria-hidden");
      }
    }
    // other errors: favorites are best-effort, ignore.
  }
}

/** Bulk-sync per-user favorite state for all rendered cards in one request. */
async function syncFavorites(queryId) {
  if (!queryId) return;
  try {
    const env = await api.get("/favorites", { query_id: queryId });
    const favorited = new Set((env.data || []).map(item => String(item.doc_id || item)));
    const list = document.getElementById("results");
    if (!list) return;
    list.querySelectorAll("li[data-doc-id]").forEach(li => {
      const btn = li.querySelector(".favorite-btn");
      const docId = li.dataset.docId;
      if (!btn || !docId) return;
      setFavoriteUi(btn, favorited.has(docId), Number(btn.dataset.count) || 0);
    });
  } catch (e) {
    if (e && (e.code === "AUTH_REQUIRED" || e.httpStatus === 401)) return;
  }
}

// ---------------------------------------------------------------------------
// Results / summary / pagination
// ---------------------------------------------------------------------------

function renderResults(env) {
  const list = document.getElementById("results");
  const empty = document.getElementById("empty-state");
  if (!list) return;
  list.innerHTML = ""; // empty literal — clears children, no untrusted data
  const data = env.data || [];

  if (data.length === 0) {
    if (empty) {
      empty.hidden = false;
      // Refresh the "did not match" message with the current query when a slot exists.
      const dnm = empty.querySelector("[data-did-not-match]");
      if (dnm) dnm.textContent = t("search.did_not_match", [state.q || ""]);
    }
    return;
  }
  if (empty) empty.hidden = true;

  data.forEach(d => list.appendChild(buildResultCard(d, env.query_id)));

  // Wire favorite click handlers + bulk-sync state for authenticated users.
  list.querySelectorAll("li[data-doc-id]").forEach(li => {
    const btn = li.querySelector(".favorite-btn");
    const docId = li.dataset.docId;
    if (btn && docId) {
      btn.addEventListener("click", () => toggleFavorite(docId, btn, li.dataset.queryId || ""));
    }
  });
  const favEnabled = !!((api.getConfig() || {}).features || {}).user_favorite && api.isAuthenticated();
  if (favEnabled && env.query_id) syncFavorites(env.query_id);
}

/**
 * Fill #result-summary: "<N> files" + a sort control + a density toggle.
 */
function renderSummary(env) {
  const summary = document.getElementById("result-summary");
  if (!summary) return;
  summary.innerHTML = ""; // empty literal
  const count = env.record_count || 0;
  if (count === 0) return;

  // "<N> files" (over-estimate variant when the relation is not EQUAL_TO).
  const isOver = env.record_count_relation && env.record_count_relation !== "EQUAL_TO";
  const countSpan = el("span", { className: "count", text: count.toLocaleString() });
  summary.appendChild(countSpan);
  summary.appendChild(document.createTextNode(" "));
  summary.appendChild(document.createTextNode(
    (isOver ? "≈ " : "") + t("result.files")
  ));

  // exec time (seconds), when supplied.
  const execSec = typeof env.exec_time === "number" ? env.exec_time
    : (typeof env.query_time === "number" ? env.query_time / 1000 : null);
  if (execSec !== null) {
    summary.appendChild(document.createTextNode(" "));
    summary.appendChild(el("span", {
      className: "exec-time",
      text: t("labels.search_result_time").replace("{0}", execSec.toFixed(2))
    }));
  }

  // Controls cluster (sort + density), right-aligned via CSS.
  const controls = el("div", { className: "summary-controls" });

  // Sort control.
  const sortWrap = el("label", { className: "sort-control" });
  sortWrap.appendChild(el("span", { className: "control-label", text: t("search.sort") }));
  const sortSel = el("select", { className: "sort-select", attrs: { "aria-label": t("search.sort") } });
  for (const opt of SORT_OPTIONS) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = t(opt.key);
    if (opt.value === state.sort) o.selected = true;
    sortSel.appendChild(o);
  }
  sortSel.addEventListener("change", () => {
    const params = new URLSearchParams(location.search);
    if (sortSel.value) params.set("sort", sortSel.value); else params.delete("sort");
    params.delete("start"); // new sort → back to first page
    navigate("/search?" + params.toString());
  });
  sortWrap.appendChild(sortSel);
  controls.appendChild(sortWrap);

  // Density toggle (comfortable | compact), persisted to localStorage.
  const density = getDensity();
  const densityBtn = el("button", {
    className: "density-toggle",
    attrs: {
      type: "button",
      "aria-label": t("search.density"),
      "aria-pressed": String(density === "compact")
    },
    text: density === "compact" ? t("search.density_compact") : t("search.density_comfortable")
  });
  densityBtn.addEventListener("click", () => {
    const next = getDensity() === "compact" ? "comfortable" : "compact";
    applyDensity(next);
    densityBtn.setAttribute("aria-pressed", String(next === "compact"));
    densityBtn.textContent = next === "compact" ? t("search.density_compact") : t("search.density_comfortable");
  });
  controls.appendChild(densityBtn);

  summary.appendChild(controls);
}

function getDensity() {
  try {
    return localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

function applyDensity(density) {
  const d = density === "compact" ? "compact" : "comfortable";
  document.documentElement.dataset.density = d;
  try { localStorage.setItem(DENSITY_KEY, d); } catch { /* ignore */ }
}

function renderPagination(env) {
  const ul = document.getElementById("pagination");
  if (!ul) return;
  ul.innerHTML = ""; // empty literal
  if (!env.prev_page && !env.next_page) return;

  const goToPage = (start) => {
    const params = new URLSearchParams(location.search);
    params.set("start", String(Math.max(0, start)));
    navigate("/search?" + params.toString());
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const makeItem = (cls) => el("li", { className: "page-item" + (cls ? " " + cls : "") });

  // Prev
  {
    const li = makeItem(env.prev_page ? "" : "disabled");
    const a = el("a", { className: "page-link", attrs: { href: "#", "aria-label": t("pagination.prev") }, text: "‹" });
    a.addEventListener("click", ev => {
      ev.preventDefault();
      if (env.prev_page) goToPage(state.start - state.num);
    });
    li.appendChild(a);
    ul.appendChild(li);
  }

  // Page numbers
  (env.page_numbers || []).forEach(n => {
    const pageNum = Number(n);
    const li = makeItem(pageNum === env.page_number ? "active" : "");
    const a = el("a", { className: "page-link", attrs: { href: "#" }, text: String(pageNum) });
    a.addEventListener("click", ev => { ev.preventDefault(); goToPage((pageNum - 1) * state.num); });
    li.appendChild(a);
    ul.appendChild(li);
  });

  // Next
  {
    const li = makeItem(env.next_page ? "" : "disabled");
    const a = el("a", { className: "page-link", attrs: { href: "#", "aria-label": t("pagination.next") }, text: "›" });
    a.addEventListener("click", ev => {
      ev.preventDefault();
      if (env.next_page) goToPage(state.start + state.num);
    });
    li.appendChild(a);
    ul.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Faceted filtering rail + active qualifier chips
// ---------------------------------------------------------------------------

/**
 * Populate #facet-rail from env.facet_field.
 * Builds collapsible <details>/<summary> groups for: Repository, Language,
 * Organization, Path/Filename. Each item is a checkbox label with count.
 * Checked state is derived from the current query qualifiers.
 * XSS-safe: all facet values written via textContent only.
 */
function renderFacets(env) {
  const rail = document.getElementById("facet-rail");
  if (!rail) return;

  // Mapping from display label to fess field name
  const GROUPS = [
    { label: "Repository",    field: "repository" },
    { label: "Language",      field: "filetype" },
    { label: "Organization",  field: "organization" },
    { label: "Path/Filename", field: "filename" },
  ];

  // Clear everything except a .rail-title heading if present
  const keepTitle = rail.querySelector(".rail-title");
  while (rail.firstChild) rail.removeChild(rail.firstChild);
  if (keepTitle) rail.appendChild(keepTitle);

  const facetFields = (env && env.facet_field) || [];
  if (facetFields.length === 0) {
    // Show empty placeholder
    const empty = document.createElement("p");
    empty.className = "rail-empty";
    empty.textContent = t("facets.empty");
    rail.appendChild(empty);
    return;
  }

  // Index facet_field array by name for quick lookup
  const byName = {};
  for (const ff of facetFields) {
    if (ff && ff.name) byName[ff.name] = ff.result || [];
  }

  // Get current raw query for checked state detection
  const queryInput = document.getElementById("query-input");
  const currentRawQuery = queryInput ? queryInput.value : "";
  const parsed = parseQuery(currentRawQuery);
  const activeQualifiers = parsed.qualifiers || [];

  let anyRendered = false;
  let firstGroup = true;

  for (const group of GROUPS) {
    const results = byName[group.field];
    if (!results || results.length === 0) continue;

    const details = document.createElement("details");
    if (firstGroup) {
      details.open = true;
      firstGroup = false;
    }
    details.className = "facet-group";

    const summary = document.createElement("summary");
    summary.className = "facet-group-label";
    summary.textContent = group.label;
    details.appendChild(summary);

    const ul = document.createElement("ul");
    ul.className = "facet-list";

    for (const item of results) {
      const value = String(item.value || "");
      const count = Number(item.count) || 0;
      if (!value) continue;

      const isChecked = activeQualifiers.some(
        q => (QUALIFIER_MAP[q.key] || q.key) === group.field && String(q.value).toLowerCase() === value.toLowerCase()
      );

      const li = document.createElement("li");
      li.className = "facet-item";

      const label = document.createElement("label");
      label.className = "facet-label";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "facet-check";
      checkbox.checked = isChecked;

      checkbox.addEventListener("change", () => {
        const qi = document.getElementById("query-input");
        const raw = qi ? qi.value : "";
        const newQuery = checkbox.checked
          ? addQualifier(raw, group.field, value)
          : removeQualifier(raw, group.field, value);
        if (qi) qi.value = newQuery;
        const params = new URLSearchParams(location.search);
        params.set("q", newQuery);
        params.delete("start");
        navigate("/search?" + params.toString());
      });

      const valueSpan = document.createElement("span");
      valueSpan.className = "facet-value";
      valueSpan.textContent = value; // XSS-safe: textContent only

      const countSpan = document.createElement("span");
      countSpan.className = "facet-count";
      countSpan.textContent = "(" + count + ")"; // XSS-safe: count is a number

      label.appendChild(checkbox);
      label.appendChild(valueSpan);
      label.appendChild(countSpan);
      li.appendChild(label);
      ul.appendChild(li);
    }

    details.appendChild(ul);
    rail.appendChild(details);
    anyRendered = true;
  }

  if (!anyRendered) {
    const empty = document.createElement("p");
    empty.className = "rail-empty";
    empty.textContent = t("facets.empty");
    rail.appendChild(empty);
  }
}

/** Display label for a fess field name. */
const FACET_FIELD_LABELS = {
  repository:   "Repository",
  filetype:     "Language",
  organization: "Organization",
  filename:     "Path/Filename",
};

/**
 * Render removable qualifier chips in #active-chips (inserted before #results).
 * Chips are rebuilt on every search; container is hidden when empty.
 * XSS-safe: qualifier values written via textContent only.
 */
function renderActiveChips() {
  const results = document.getElementById("results");
  if (!results) return;

  // Create or reuse #active-chips container (inserted directly before #results)
  let chips = document.getElementById("active-chips");
  if (!chips) {
    chips = document.createElement("div");
    chips.id = "active-chips";
    chips.className = "active-chips";
    results.parentNode.insertBefore(chips, results);
  }

  // Clear current chips
  while (chips.firstChild) chips.removeChild(chips.firstChild);

  const queryInput = document.getElementById("query-input");
  const currentRawQuery = queryInput ? queryInput.value : "";
  const parsed = parseQuery(currentRawQuery);
  const qualifiers = (parsed.qualifiers || []).filter(q => !q.negate);

  if (qualifiers.length === 0) {
    chips.hidden = true;
    return;
  }
  chips.hidden = false;

  for (const q of qualifiers) {
    const fieldLabel = FACET_FIELD_LABELS[QUALIFIER_MAP[q.key] || q.key] || q.key;

    const chip = document.createElement("span");
    chip.className = "active-chip";

    // Label text: "Repository: fess"
    const labelText = document.createTextNode(fieldLabel + ": " + q.value + " ");
    chip.appendChild(labelText);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "chip-remove";
    removeBtn.textContent = "×"; // XSS-safe: textContent
    removeBtn.setAttribute("aria-label", "Remove filter");

    removeBtn.addEventListener("click", () => {
      const qi = document.getElementById("query-input");
      const raw = qi ? qi.value : "";
      const newQuery = removeQualifier(raw, q.key, q.value);
      if (qi) qi.value = newQuery;
      const params = new URLSearchParams(location.search);
      params.set("q", newQuery);
      params.delete("start");
      navigate("/search?" + params.toString());
    });

    chip.appendChild(removeBtn);
    chips.appendChild(chip);
  }
}

// ---------------------------------------------------------------------------
// runSearch — URL is the source of truth
// ---------------------------------------------------------------------------

function showSearchLoading(show) {
  const list = document.getElementById("results");
  if (list) list.setAttribute("aria-busy", show ? "true" : "false");
}

/**
 * Issue GET /api/v2/search from the current `state`, cancelling any in-flight
 * request first. Requests the facets Task 5 will render
 * (repository, filetype, organization, filename).
 */
async function runSearch() {
  if (currentSearchAbort) currentSearchAbort.abort();
  currentSearchAbort = new AbortController();
  const signal = currentSearchAbort.signal;
  state.requestedTime = Date.now();

  document.title = state.q ? t("page.search_title").replace("{0}", state.q) : t("page.title");

  const errBox = document.getElementById("search-error");
  if (errBox) errBox.hidden = true;
  showSearchLoading(true);

  try {
    const params = { q: state.q, start: state.start, num: state.num };
    if (state.sort) params.sort = state.sort;
    // Facets for Task 5 — api.js serialises arrays as repeated keys.
    params["facet.field"] = ["repository", "filetype", "organization", "filename"];

    const env = await api.get("/search", params, { signal });
    if (env.requested_time) state.requestedTime = env.requested_time;

    renderResults(env);
    renderSummary(env);
    renderPagination(env);
    renderFacets(env);
    renderActiveChips();

    if (errBox) errBox.hidden = true;
    // Expose the envelope so Task 5 (facets) can render from the same response.
    document.dispatchEvent(new CustomEvent("fess:search:after", { detail: env }));
  } catch (e) {
    if (e && e.name === "AbortError") return; // superseded by a newer request
    const msg = (e && e.name === "NetworkError") ? t("error.network")
      : (e && (e.code === "invalid_request" || e.code === "INVALID_REQUEST" || e.httpStatus === 400)) ? (e.message || t("error.invalid_request"))
        : (e && e.code === "AUTH_REQUIRED") ? t("error.auth_required")
          : t("error.server");
    if (errBox) { errBox.textContent = msg; errBox.hidden = false; }
    // Clear stale results/summary/pagination on a hard failure.
    const list = document.getElementById("results");
    if (list) list.innerHTML = "";
  } finally {
    if (currentSearchAbort && currentSearchAbort.signal === signal) showSearchLoading(false);
  }
}

// ---------------------------------------------------------------------------
// URL ↔ state + submit wiring
// ---------------------------------------------------------------------------

/** Keep the header (#query-input) and home (#contentQuery) inputs in sync. */
function syncSearchInputs(q) {
  const header = document.getElementById("query-input");
  const home = document.getElementById("contentQuery");
  if (header && document.activeElement !== header) header.value = q;
  if (home && document.activeElement !== home) home.value = q;
}

/**
 * Read URL params into state and run a fresh search. Called by app.js on every
 * route dispatch (including popstate / back-forward) so results follow the URL.
 */
export function runFromUrl() {
  const params = new URLSearchParams(location.search);
  state.q = params.get("q") || "";
  state.start = Number(params.get("start")) || 0;
  const numVal = Number(params.get("num"));
  if (numVal > 0) state.num = numVal;
  state.sort = params.get("sort") || "";
  syncSearchInputs(state.q);

  // A blank query with no conditions is not a search — return to home (parity
  // with the server redirectToRoot). replace:true so the empty /search entry
  // does not linger in history.
  if (!state.q) {
    navigate("/", { replace: true });
    return;
  }
  runSearch();
}

/**
 * Translate the query box and navigate to /search. The submit path is:
 *   toFessQuery(parseQuery(rawInput)) → set q in the URL → runSearch().
 * Exported so the home-view form (app.js) uses the same translation path as
 * the header search box, ensuring `repo:foo bar` → Fess qualifier syntax on both.
 * @param {string} rawInput - raw text from the search box
 * @param {URLSearchParams} [base] - existing params to carry forward (num/sort/lang)
 */
export function submitQuery(rawInput, base) {
  const fessQuery = toFessQuery(parseQuery(rawInput || ""));
  const params = base ? new URLSearchParams(base) : new URLSearchParams(location.search);
  if (fessQuery) params.set("q", fessQuery); else params.delete("q");
  params.delete("start"); // new query → first page
  navigate("/search?" + params.toString());
}

/**
 * Attach the search form submit handlers. Idempotent.
 */
export function attach() {
  if (attached) return;
  attached = true;

  // Apply persisted density preference once.
  applyDensity(getDensity());

  // Header search box (#search-bar / #query-input).
  const bar = document.getElementById("search-bar");
  const input = document.getElementById("query-input");
  if (bar && input) {
    bar.addEventListener("submit", ev => {
      ev.preventDefault();
      submitQuery(input.value);
    });
  }
}

/**
 * Re-run the current search without re-attaching listeners (e.g. after login).
 */
export function refresh() {
  if (state.q) runSearch();
}

// ---------------------------------------------------------------------------
// Exports consumed by app.js (home view + reset). Kept minimal but compatible.
// ---------------------------------------------------------------------------

/**
 * Silent reset of search state + both query inputs. Called from the home route.
 */
export function clearSearchState() {
  state.q = "";
  state.start = 0;
  state.sort = "";
  state.requestedTime = 0;
  syncSearchInputs("");
  const list = document.getElementById("results");
  if (list) list.innerHTML = "";
  const summary = document.getElementById("result-summary");
  if (summary) summary.innerHTML = "";
  const pagination = document.getElementById("pagination");
  if (pagination) pagination.innerHTML = "";
  renderActiveChips();
}

/**
 * Disable a submit button for 3s to guard against double-submits (parity helper).
 */
export function disableSubmitBriefly(btn) {
  if (!btn) return;
  btn.disabled = true;
  setTimeout(() => { btn.disabled = false; }, 3000);
}

/**
 * Render popular-word links into a target element (used by app.js home view).
 * data-spa anchors so the router navigates to /search?q=word.
 */
export function renderPopularWords(words, targetEl) {
  if (!targetEl) return;
  while (targetEl.firstChild) targetEl.removeChild(targetEl.firstChild);
  if (!words || words.length === 0) {
    targetEl.hidden = true;
    return;
  }
  targetEl.hidden = false;
  const label = el("span", { className: "popular-label", text: t("search.popular_searches") + ": " });
  targetEl.appendChild(label);
  words.forEach(w => {
    const a = el("a", {
      className: "popular-word",
      text: w,
      attrs: { href: "/search?q=" + encodeURIComponent(w), "data-spa": "" }
    });
    targetEl.appendChild(a);
  });
}

/**
 * Attach a lightweight suggest dropdown to a text input (used by app.js home view).
 * Calls GET /api/v2/suggest-words; renders with createElement/textContent only.
 */
export function attachSuggest(input, dropdown, opts = {}) {
  if (!input || !dropdown) return;
  let timer = null;
  const clear = () => {
    while (dropdown.firstChild) dropdown.removeChild(dropdown.firstChild);
    dropdown.classList.add("visually-hidden");
    input.setAttribute("aria-expanded", "false");
  };
  const choose = (text) => {
    input.value = text;
    clear();
    if (opts.submitOnSelect) {
      const form = input.form || input.closest("form");
      if (form) form.dispatchEvent(new Event("submit", { cancelable: true }));
      return;
    }
    input.focus();
  };
  const render = async (q) => {
    if (!q || q.length < 1) { clear(); return; }
    try {
      const params = { q, num: 10, fn: ["_default", "content", "title"] };
      const lang = typeof opts.lang === "function" ? opts.lang() : opts.lang;
      if (Array.isArray(lang) && lang.length > 0) params.lang = lang;
      const env = await api.get("/suggest-words", params);
      const items = env.suggest_words || [];
      while (dropdown.firstChild) dropdown.removeChild(dropdown.firstChild);
      if (items.length === 0) { clear(); return; }
      items.forEach((it, i) => {
        const li = el("li", {
          className: "suggest-item",
          text: it.text || "",
          attrs: { role: "option", id: input.id + "-suggest-" + i }
        });
        li.addEventListener("mousedown", ev => { ev.preventDefault(); choose(it.text || ""); });
        dropdown.appendChild(li);
      });
      dropdown.classList.remove("visually-hidden");
      input.setAttribute("aria-expanded", "true");
    } catch { /* best-effort */ }
  };
  input.addEventListener("input", () => {
    if (timer) clearTimeout(timer);
    const v = input.value.trim();
    timer = setTimeout(() => render(v), 150);
  });
  input.addEventListener("blur", () => setTimeout(clear, 120));
}

/**
 * Return { fields, extra_queries } derived from the active facet qualifiers and
 * the current query state. Used by chat.js attachAskPanel() to ground the AI
 * answer in the results-page context.
 *
 * fields: array of label values from the #labelSearchOption select (for Fess
 *   label filters active in the search options drawer).
 * extra_queries: array of Fess-style qualifier strings derived from the active
 *   qualifiers in the parsed query (e.g. "repository:fess", "filetype:java").
 */
export function getSearchContext() {
  // Derive extra_queries from active qualifiers in the current query.
  const queryInput = document.getElementById("query-input");
  const rawQ = queryInput ? queryInput.value : "";
  const parsed = parseQuery(rawQ);
  const activeQualifiers = (parsed.qualifiers || []).filter(q => !q.negate);
  const extra_queries = activeQualifiers.map(q => {
    const fessField = QUALIFIER_MAP[q.key] || q.key;
    return fessField + ":" + q.value;
  });

  // Derive fields (label values) from the #labelSearchOption select.
  const labelSel = document.getElementById("labelSearchOption");
  const fields = labelSel
    ? Array.from(labelSel.selectedOptions).map(o => o.value).filter(v => v !== "")
    : [];

  return { fields, extra_queries };
}

// Exported for Task 5 (facets) to extend rendering and re-run from the same state.
export { runSearch, buildResultCard, renderResults, renderSummary, renderPagination, el, state as _state };
