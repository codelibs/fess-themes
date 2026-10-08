// SPDX-License-Identifier: Apache-2.0
// The file-search SPA's search view: search state and its address-bar round trip, the
// request/response pipeline, the header and drawer wiring. Everything that has a screen
// of its own lives in a module: the folder tree (treeview.js, tree.js, treesource.js,
// scope.js, paths.js), the result list (listview.js), the preview pane (preview.js,
// previewload.js), the filter panel (filterpanel.js, filters.js), sorting (sorting.js),
// keyboard decisions (keynav.js), and the small persisted preferences (viewmode.js,
// recent.js). This file keeps the strings the scheme test looks for ("file:", "smb:",
// "go/?rt=") because it builds every link to the original.
import * as api from "./api.js";
import { t, languageLabel } from "./i18n.js";
import { sanitizeHtml } from "./format.js";
import { navigate } from "./router.js";
import { el, clear, copyText, iconButton } from "./dom.js";
import { uiIcon } from "./icons.js";
import { scopeClause, scopeKey, withBrowseAll } from "./scope.js";
import { breadcrumb, parentScope, scopeOfDocParent, scopeDisplayPath, fitScope } from "./paths.js";
import { composeExQ, classifyExQ, facetQueryClauses, DATE_PRESETS, SIZE_PRESETS, presetFor } from "./filters.js";
import {
  effectiveSort, describeSort, nextSort, firstSort, sortFallback, markUnsupported, isSortSupported,
} from "./sorting.js";
import { VIEW_MODES, loadViewMode, saveViewMode } from "./viewmode.js";
import { getRecent, pushRecent, clearRecent } from "./recent.js";
import { globalKey, isEditable } from "./keynav.js";
import { createListView, buildRow, plainTitle } from "./listview.js";
import { createTreeView } from "./treeview.js";
import { createPreview } from "./preview.js";
import { renderFilterPanel, renderChips, typeName } from "./filterpanel.js";

/** Guard: prevent duplicate event-listener registration on hot-reload. */
let attached = false;

/** AbortController for the most-recent in-flight search; null when idle. */
let currentSearchAbort = null;

/** AbortController for in-flight related-queries/content requests; null when idle. */
let currentRelatedAbort = null;

const state = {
  q: "",
  start: 0,
  num: 10,
  sort: "",
  sortDirty: false,     // the user chose a sort: syncUrlParams writes it to the address bar
  lang: [],             // string[] — zero or more language codes; serialised as repeated lang= params
  sdh: "",              // similar_docs_hash for similarity search
  as: {},               // advanced-search conditions from JSP URLs: name -> [values], sent as as.<name>
  scope: null,          // the folder the list is narrowed to: {type:"host",host} | {type:"url",prefix}
  facets: {},           // field -> [values]: label and filetype selections, sent as ex_q
  fields: {},           // extra field filters (e.g. label)
  facetQueries: [],     // string[] — the modified-date / size preset clauses that are active
  exQ: [],              // string[] — every other ex_q clause (advanced search, a shared link)
  geo: { lat: "", lon: "", distance: "" }, // GEO-1: geo search state
  requestedTime: 0,     // epoch ms of the most-recent search; used in /go/ click-log URL
  highlightParams: ""   // server-supplied highlight_params string (e.g. "&hl.q=...&hl.fragsize=...")
};

// XSS-safety: this module builds every result-card DOM node with
// document.createElement + textContent. No untrusted string is ever
// passed to innerHTML.

/**
 * Return `url` only when its scheme is in the allowlist of schemes Fess serves (web plus file/smb/smb1/storage/s3/gcs).
 * Any other scheme (e.g. javascript:, data:, vbscript:) returns "#" so that
 * setAttribute("href", safeHref(u)) can never inject executable content.
 */
function safeHref(url) {
  if (!url || typeof url !== "string") return "#";
  try {
    const u = new URL(url, location.href);
    if (u.protocol === "https:" || u.protocol === "http:" ||
        u.protocol === "ftp:" || u.protocol === "ftps:" ||
        u.protocol === "file:" || u.protocol === "smb:" || u.protocol === "smb1:" ||
        u.protocol === "storage:" || u.protocol === "s3:" || u.protocol === "gcs:") {
      return url;
    }
  } catch (e) {
    // URL constructor failed — treat as unsafe.
    return "#";
  }
  return "#";
}



/**
 * Build the /go/ click-tracking URL for a result link.
 *
 * Mirrors the JSP mousedown handler in src/main/webapp/js/search.js:111-127.
 * Returns "#" when the original URL is not in the allowlist of schemes Fess serves (web plus file/smb/smb1/storage/s3/gcs)
 * so that safeHref semantics are preserved — the /go/ redirect would fail anyway
 * for unsafe schemes.
 *
 * @param {string} originalUrl - the document's url_link / url value
 * @param {string} docId       - document identifier
 * @param {string} queryId     - query identifier from the search response
 * @param {number} order       - 0-based position of the result on the page,
 *                               the same value as the link's data-order (JSP
 *                               sends searchResults.jsp's ${s.index}); GoAction
 *                               stores it as ClickLog.order
 * @param {number} rt          - requestedTime in epoch ms
 * @returns {string} the /go/ redirect URL, or "#" for unsafe schemes
 */
function buildGoUrl(originalUrl, docId, queryId, order, rt) {
  // Validate scheme — same rules as safeHref; only build /go/ for safe schemes.
  if (!originalUrl || typeof originalUrl !== "string") return "#";
  try {
    const u = new URL(originalUrl, location.href);
    if (u.protocol !== "https:" && u.protocol !== "http:" &&
        u.protocol !== "ftp:" && u.protocol !== "ftps:" &&
        u.protocol !== "file:" && u.protocol !== "smb:" && u.protocol !== "smb1:" &&
        u.protocol !== "storage:" && u.protocol !== "s3:" && u.protocol !== "gcs:") {
      return "#";
    }
  } catch (e) {
    return "#";
  }

  let goUrl = "go/?rt=" + encodeURIComponent(rt) +
              "&docId=" + encodeURIComponent(docId || "") +
              "&queryId=" + encodeURIComponent(queryId || "") +
              "&order=" + encodeURIComponent(order || 0);

  // Preserve the fragment from the original URL (e.g. /doc.html#section-2)
  const hashIndex = originalUrl.indexOf("#");
  if (hashIndex >= 0) {
    goUrl += "&hash=" + encodeURIComponent(originalUrl.substring(hashIndex));
  }

  return goUrl;
}


// ─── result rows ─────────────────────────────────────────────────────────────────

/** What a row (and the preview pane) can do with the document it shows. */
const rowActions = {
  /** Move the folder scope to the folder the document sits in. */
  showInFolder(doc) {
    const scope = scopeOfDocParent(doc.url || doc.url_link);
    if (scope) setScope(scope);
  },
  /** Copy the path and say so. */
  copyPath(text, btn) {
    copyText(text).then(() => flashCopied(btn, t("fs.path_copied")), () => announce(t("fs.copy_failed")));
  },
};

/** What building a row needs: how to reach the original, and what the row may do. */
function rowContext(queryId) {
  return {
    queryId, requestedTime: state.requestedTime, buildGoUrl,
    features: (api.getConfig() || {}).features || {},
    view: ui.view, actions: rowActions, highlightParams: state.highlightParams, q: state.q,
  };
}

/** One result row on its own (order is 1-based, as the card builders of the other themes take it). */
function buildResultCard(d, queryId, order) {
  return buildRow(d, order - 1, rowContext(queryId));
}

/** Say something to screen readers (the polite live region), without moving focus. */
function announce(text) {
  const live = document.getElementById("fs-live");
  if (!live) return;
  live.textContent = "";
  // A changed text node is what makes the region read again, so set it on the next turn.
  setTimeout(() => { live.textContent = text; }, 30);
}

/** Show a check mark on a button for a moment, and tell screen readers. */
function flashCopied(btn, label) {
  announce(label);
  const icon = btn && btn.firstElementChild;
  if (!icon || !btn.isConnected) return;
  btn.classList.add("is-copied");
  const check = uiIcon("check");
  btn.replaceChild(check, icon);
  setTimeout(() => {
    btn.classList.remove("is-copied");
    if (check.parentNode === btn) btn.replaceChild(icon, check);
  }, 1500);
}

/**
 * What the results-status banner says the results are "for": the query, or — for a
 * blank query such as a category tile's /search?q=&fields.label=x — the names of the
 * active labels (drawer fields.label or an ex_q label facet), resolved from
 * label_options like the current-filters badge. "" when there is neither, so the
 * caller picks the _noquery wording instead of rendering an empty {bq}.
 */
function resultsStatusSubject() {
  const q = (state.q || "").trim();
  if (q) return state.q;
  const cfg = api.getConfig() || {};
  const labels = [...new Set([...(state.fields.label || []), ...(state.facets.label || [])])];
  return labels.map(val => {
    const opt = (cfg.label_options || []).find(o => o.value === val);
    return opt ? (opt.name || opt.value) : val;
  }).join(", ");
}

/**
 * C.1: Populate the results-status banner.
 * Uses _over variant when record_count_relation !== "EQUAL_TO", and the _noquery
 * variants when resultsStatusSubject() has nothing to put in {bq}.
 */
function renderResultsStatus(env) {
  const statusEl = document.getElementById("results-status");
  if (!statusEl) return;
  while (statusEl.firstChild) statusEl.removeChild(statusEl.firstChild);
  const count = env.record_count || 0;
  const start = env.start_record_number || 1;
  const end   = env.end_record_number   || 0;
  const isOver = env.record_count_relation && env.record_count_relation !== "EQUAL_TO";
  const bq = resultsStatusSubject();
  const statusKey = (bq ? "labels.search_result_status" : "labels.search_result_status_noquery")
    + (isOver ? "_over" : "");
  const values = { b0: count.toLocaleString(), b1: String(start), b2: String(end), bq };
  t(statusKey).split(/(\{b[012q]\})/).forEach(part => {
    const m = part.match(/^\{(b[012q])\}$/);
    if (m) {
      const b = document.createElement("b");
      b.textContent = values[m[1]] != null ? values[m[1]] : "";
      statusEl.appendChild(b);
    } else if (part) {
      statusEl.appendChild(document.createTextNode(part));
    }
  });
  if (env.exec_time != null) {
    const execSec = typeof env.exec_time === "number"
      ? env.exec_time.toFixed(2)
      : (typeof env.query_time === "number" ? (env.query_time / 1000).toFixed(2) : null);
    if (execSec !== null) {
      statusEl.appendChild(document.createTextNode(" " + t("labels.search_result_time").replace("{0}", execSec)));
    }
  }
}

/**
 * C.2: Show/hide the similar-doc banner.
 */
function renderSimilarDocBanner() {
  const banner = document.getElementById("similar-doc-banner");
  if (!banner) return;
  // Clear previous content
  while (banner.firstChild) banner.removeChild(banner.firstChild);
  if (!state.sdh) {
    banner.classList.add("d-none");
    banner.classList.remove("d-flex");
    return;
  }
  banner.classList.remove("d-none");
  banner.classList.add("d-flex");
  banner.appendChild(el("span", { text: t("labels.similar_doc_result_status") }));
  const closeBtn = el("button", {
    className: "btn-close ms-2",
    attrs: { type: "button", "aria-label": t("labels.similar_doc_result_status") }
  });
  closeBtn.addEventListener("click", () => {
    state.sdh = "";
    state.start = 0;
    runSearch();
  });
  banner.appendChild(closeBtn);
}



function renderResults(env) {
  ensureUi();
  const list = document.getElementById("results");
  const meta = document.getElementById("results-meta");
  const empty = document.getElementById("empty-state");
  const data = env.data || [];
  ui.queryId = env.query_id || "";
  // C.2: always refresh similar-doc banner (hides when state.sdh is cleared)
  renderSimilarDocBanner();
  if (data.length === 0) {
    if (ui.list) ui.list.render([], rowContext(env.query_id));
    else if (list) clear(list);
    if (ui.preview) ui.preview.clear();
    const dnm = document.getElementById("empty-did-not-match");
    if (dnm) dnm.textContent = hasKeyword() ? t("search.did_not_match", [state.q]) : t("fs.empty_scope");
    if (empty) empty.classList.remove("d-none");
    // The empty state's popular words (searchNoResult.jsp parity). Loaded when the state is
    // shown, so a search opened from its address gets them too; the home view lists its own (app.js).
    loadPopularWords();
    if (meta) meta.textContent = "";
    const statusEl = document.getElementById("results-status");
    if (statusEl) statusEl.textContent = "";
    // ZERO-RESULT: do NOT clear related queries/content here — loadRelated() (called
    // after renderResults in runSearch) will populate them. Clearing here would race
    // against the async loadRelated and wipe its output (parity-r3 A2).
    return;
  }
  if (empty) empty.classList.add("d-none");
  // C.1: populate the result-status banner
  renderResultsStatus(env);
  // #results-meta is intentionally left empty on success; status line (#results-status)
  // is the canonical count display. Error/network paths below still write to it.
  if (meta) meta.textContent = "";
  // Reflect the server queryId / requestedTime into the hidden #queryId / #rt
  // fields (JSP parity: searchResults.jsp hidden inputs).
  const queryIdEl = document.getElementById("queryId");
  if (queryIdEl) queryIdEl.value = env.query_id || "";
  const rtEl = document.getElementById("rt");
  if (rtEl) rtEl.value = String(state.requestedTime || "");
  if (ui.list) {
    ui.list.renderHead({ sort: state.sort, hasKeyword: hasKeyword(), onSort: applySortColumn });
    const current = ui.preview ? ui.preview.currentDoc() : null;
    const kept = ui.list.render(data, { ...rowContext(env.query_id), selectedDocId: current ? current.doc_id : "" });
    // The selected document is not on this page any more: nothing is selected.
    if (kept < 0 && ui.preview) ui.preview.clear();
  }
  if (list) {
    list.querySelectorAll("li[data-doc-id]").forEach(li => {
      const btn = li.querySelector(".favorite-btn");
      const docId = li.dataset.docId;
      if (!btn || !docId) return;
      setFavoriteUi(btn, false, Number(btn.dataset.count) || 0);
      btn.addEventListener("click", () => addFavorite(docId, btn, li.dataset.queryId || ""));
    });
  }
  // Bulk-sync the *per-user* favorited state (solid vs outline star) for all rows in one
  // request. Only logged-in users can own favorites (adding requires login), so a guest has
  // nothing to sync; the star and its count are still drawn for guests above.
  const favEnabled = !!(api.getConfig()?.features?.user_favorite) && api.isAuthenticated();
  if (favEnabled && env.query_id) syncFavorites(env.query_id);
}

/**
 * Toggle the in-flight search loading indicator (#search-loading).
 * Gives sighted users visible feedback during a /search request; cache and chat
 * already have loading states, search did not.
 */
function showSearchLoading(show) {
  const el = document.getElementById("search-loading");
  if (el) el.classList.toggle("d-none", !show);
}



/** The ex_q clauses of the current search: the folder scope, the filters, then what came with the URL. */
function exQClauses() {
  return composeExQ(state);
}

/** True when there is a keyword (the default order is relevance then, name otherwise). */
function hasKeyword() {
  return (state.q || "").trim() !== "";
}

/**
 * The conditions of the current search, without paging or sort. The folder tree asks about
 * every folder under the same conditions, so it calls this with withScope: false.
 */
function conditionParams({ withScope = true } = {}) {
  const params = { q: state.q };
  // state.lang is string[] — send as repeated lang= params (empty array → omit).
  if (Array.isArray(state.lang) && state.lang.length > 0) params.lang = state.lang;
  for (const [name, values] of Object.entries(state.as)) params["as." + name] = values;
  // Explicit field filters (state.fields: the URL, the label dropdown, the default labels)
  // become one deduplicated fields.* param per field; the API ORs the values of a field.
  // Facet selections (state.facets) are sent as ex_q clauses instead, which AND: facet
  // counts are computed within the current filters, so a facet click must narrow the
  // search (JSP parity: searchResults.jsp facet links add ex_q=label:<value>). Merging
  // them into fields.* would widen the search to "default label OR clicked label".
  const fieldSets = {};
  for (const [field, values] of Object.entries(state.fields)) {
    if (Array.isArray(values)) {
      values.forEach(v => { (fieldSets[field] = fieldSets[field] || new Set()).add(v); });
    }
  }
  for (const [field, valueSet] of Object.entries(fieldSets)) {
    valueSet.forEach(v => { (params["fields." + field] = params["fields." + field] || []).push(v); });
  }
  const exQ = composeExQ(state, { withScope });
  if (exQ.length > 0) params["ex_q"] = exQ;
  // GEO-1: emit geo params when all three are present
  if (state.geo && state.geo.lat !== "" && state.geo.lon !== "" && state.geo.distance !== "") {
    params["geo.location.point"] = state.geo.lat + "," + state.geo.lon;
    params["geo.location.distance"] = state.geo.distance;
  }
  return params;
}

/** The file-type facet under the current search with the file-type choice itself left out. */
function typeFacetParams() {
  const params = conditionParams();
  const exQ = composeExQ({ ...state, facets: { ...state.facets, filetype: undefined } });
  if (exQ.length > 0) params.ex_q = exQ; else delete params.ex_q;
  return { ...withBrowseAll(params), start: 0, num: 1, "facet.field": ["filetype"], "facet.size": 100 };
}

/**
 * Keep the address bar's start=, ex_q= (folder scope and filters) and sort= in step with the
 * state, so reload, back/forward and a shared link land on the same page with the same
 * folder and filters (runFromUrl reads them back).
 *
 * @param {boolean} push - add a history entry (a user's move to another folder, filter or
 *                         page) instead of correcting the current one
 */
function syncUrlParams(push) {
  const params = new URLSearchParams(location.search);
  const clauses = exQClauses();
  const current = params.getAll("ex_q");
  const sameExQ = current.length === clauses.length && current.every((v, i) => v === clauses[i]);
  const sameStart = (Number(params.get("start")) || 0) === state.start;
  // The sort is written only after the user chose one: a server default stays out of the URL.
  const sameSort = !state.sortDirty || (params.get("sort") || "") === state.sort;
  if (sameStart && sameExQ && sameSort) return;
  if (state.start > 0) params.set("start", String(state.start)); else params.delete("start");
  if (!sameExQ) {
    params.delete("ex_q");
    clauses.forEach(v => params.append("ex_q", v));
  }
  if (state.sortDirty) {
    if (state.sort) params.set("sort", state.sort); else params.delete("sort");
    state.sortDirty = false;
  }
  const qs = params.toString();
  const url = location.pathname + (qs ? "?" + qs : "");
  if (push) history.pushState(null, "", url); else history.replaceState(null, "", url);
}

/** A change the user made to the folder, filters or sort: back to the first page, a history entry, a new search. */
function commit() {
  state.start = 0;
  syncUrlParams(true);
  return runSearch();
}

async function runSearch(opts = {}) {
  ensureUi();
  syncUrlParams(false);
  // Cancel any in-flight request before issuing a new one.
  if (currentSearchAbort) currentSearchAbort.abort();
  currentSearchAbort = new AbortController();
  const signal = currentSearchAbort.signal;
  // Cancel any in-flight related queries/content requests.
  if (currentRelatedAbort) currentRelatedAbort.abort();
  currentRelatedAbort = new AbortController();
  // Record the request time before the call so /go/ URLs embedded in result
  // cards carry the correct rt parameter (mirrors JSP #rt hidden field).
  state.requestedTime = Date.now();
  document.title = state.q ? t("page.search_title").replace("{0}", state.q) : "Fess";
  // Clear any stale error banner from a previous attempt and show the loading indicator.
  const prevErr = document.getElementById("search-error");
  if (prevErr) prevErr.classList.add("d-none");
  if (!opts.retried) hideNotice();
  showSearchLoading(true);
  try {
    const params = { ...conditionParams(), start: state.start, num: state.num };
    // Relevance for a keyword, name order when browsing; an explicit choice always wins.
    const sort = effectiveSort(state.sort, hasKeyword());
    if (sort) params.sort = sort;
    if (state.sdh) params.sdh = state.sdh;
    // The file-type facet, and a count for every modified-date and size preset.
    params["facet.field"] = ["filetype", "label"];
    params["facet.query"] = facetQueryClauses();
    // With a file type chosen, the types are counted again without that choice, so the others
    // stay on offer (a failure of that side request costs only that).
    const mainRequest = api.get("/search", params, { signal });
    const typesToo = (state.facets.filetype || []).length > 0
      ? api.get("/search", typeFacetParams(), { signal }).catch(e => { if (e && e.name === "AbortError") throw e; return null; })
      : Promise.resolve(null);
    const [env, typeFacet] = await Promise.all([mainRequest, typesToo]);
    ui.typeFacet = typeFacet;
    // The server caps num at page_size_max and says what it served. The page links step by that
    // size, not by the one asked for: with num=500 capped to 100, page 2 starts at 100, not 500.
    const served = Number(env.page_size);
    if (served > 0 && served < state.num) state.num = served;
    // Prefer the server-supplied requested_time when available (more accurate).
    if (env.requested_time) state.requestedTime = env.requested_time;
    // A.5: store server-supplied highlight params for cache link construction.
    state.highlightParams = (typeof env.highlight_params === "string" && env.highlight_params) ? env.highlight_params : "";
    // A.6: show/hide the warning banner above the results. JSP parity
    // (FessSearchAction.hookBefore): say so when the user's group and role permissions are
    // still loading or failed to load, since the results may then be incomplete. A timeout
    // and a failed shard are different causes; a partial result that names neither is not
    // called a timeout.
    const warningEl = document.getElementById("results-warning");
    if (warningEl) {
      const warnings = [];
      if (env.permission_state === "PENDING") warnings.push(t("errors.user_permissions_loading"));
      else if (env.permission_state === "FAILED") warnings.push(t("errors.user_permissions_unavailable"));
      if (env.partial) {
        if (env.timed_out) warnings.push(t("labels.process_time_is_exceeded"));
        if (env.shard_failed || !env.timed_out) warnings.push(t("labels.search_partially_failed"));
      }
      if (warnings.length > 0) {
        warningEl.textContent = warnings.join(" ");
        warningEl.classList.remove("d-none");
      } else {
        warningEl.classList.add("d-none");
      }
    }
    renderResults(env);
    renderPagination(env);
    const labels = await loadLabels();
    renderFilters(env, labels);
    renderLocation();
    syncToolbar();
    syncTree(env);
    if (hasKeyword()) { pushRecent(state.q); renderRecent(); }
    // Hide inline validation error box on successful results.
    const eb = document.getElementById("search-error");
    if (eb) eb.classList.add("d-none");
    // Fetch related queries and content concurrently (abortable on next search).
    loadRelated(state.q, currentRelatedAbort.signal);
    document.dispatchEvent(new CustomEvent("fess:search:after", { detail: env }));
  } catch (e) {
    if (e && e.name === "AbortError") return; // request superseded — newer request owns the UI
    // A 400 while a sort was in effect is most likely the server refusing that sort (Type and
    // Location sort on fields query.additional.sort.fields has to list): say so, drop the sort
    // and show the default order instead of an empty page.
    const fallback = !opts.retried && sortFallback({ httpStatus: e && e.httpStatus, code: e && e.code, sort: state.sort });
    if (fallback) {
      if (fallback.column) markUnsupported(fallback.column);
      showNotice(t("fs.sort_unsupported", { column: fallback.column ? t("fs.sort_" + fallback.column) : state.sort }));
      state.sort = fallback.sort;
      state.sortDirty = true;
      syncUrlParams(false);
      return runSearch({ retried: true });
    }
    const errBox = document.getElementById("search-error");
    if (e && (e.code === "invalid_request" || e.code === "INVALID_REQUEST" || e.httpStatus === 400)) {
      if (errBox) { errBox.textContent = e.message || t("error.invalid_request"); errBox.classList.remove("d-none"); }
      else { document.getElementById("results-meta").textContent = e.message || t("error.invalid_request"); }
      return;
    }
    // Network/server/auth failures: surface in the VISIBLE banner too. Previously these wrote
    // only to the screen-reader-only #results-meta sink, so a sighted user saw nothing when a
    // search failed with a 500 or a dropped connection. Fall back to #results-meta when a
    // theme has no visible banner.
    const msg = (e && e.name === "NetworkError") ? t("error.network")
              : (e && (e.code === "auth_required" || e.code === "AUTH_REQUIRED")) ? t("error.auth_required")
              : t("error.server");
    if (errBox) { errBox.textContent = msg; errBox.classList.remove("d-none"); }
    else { const meta = document.getElementById("results-meta"); if (meta) meta.textContent = msg; }
    // The session is gone: app.js asks for login again when the site requires it.
    if (e && (e.code === "auth_required" || e.code === "AUTH_REQUIRED")) {
      document.dispatchEvent(new CustomEvent("fess:auth:required"));
    }
  } finally {
    // Only the latest request clears the spinner. If this request was superseded,
    // currentSearchAbort already points at a newer controller, so leave it running.
    if (currentSearchAbort && currentSearchAbort.signal === signal) showSearchLoading(false);
  }
}

// ─── the screen: list, tree, preview, toolbar, location, filters ────────────────

/** Controllers and preferences of the results screen, created once its markup exists. */
const ui = { typeFacet: null, ready: false, view: loadViewMode(), workspace: null, list: null, tree: null, homeTree: null, preview: null, queryId: "" };

const $ = id => document.getElementById(id);

/** Narrow screens show the folder tree as a drawer and the preview as a sheet (900px, as styles.css). */
const isNarrow = () => !!(window.matchMedia && window.matchMedia("(max-width: 899.98px)").matches);

function ensureUi() {
  if (ui.ready) return;
  const resultsEl = $("results");
  if (!resultsEl) return; // the screen is not mounted (home view, or a page without it)
  ui.ready = true;
  ui.workspace = $("fs-workspace");
  if ($("fs-preview") && $("fs-preview-body")) ui.preview = createPreview({ workspace: ui.workspace, root: $("fs-preview") });
  ui.list = createListView({
    list: resultsEl,
    head: $("fs-head"),
    onSelect: onRowSelect,
    onTogglePreview: () => { if (ui.preview) { ui.preview.toggle(); syncToolbar(); } },
    onFocusTree: () => { if (ui.tree) ui.tree.focus(); },
  });
  if ($("fs-tree")) {
    ui.tree = createTreeView({
      root: $("fs-tree"), status: $("fs-tree-status"), warning: $("fs-tree-warning"),
      getBase: () => conditionParams({ withScope: false }),
      onSelect: scope => { if (isNarrow()) closeTreeDrawer(false); setScope(scope); },
      onFocusList: () => { if (ui.list) ui.list.focusActive(); },
    });
  }
  wireScreen();
  renderRecent();
  syncToolbar();
}

/** A row became the selected one: the preview pane follows (and a click opens the sheet on a narrow screen). */
function onRowSelect(doc, index, source) {
  if (!ui.preview) return;
  ui.preview.show(doc, { ...rowContext(ui.queryId), index }, { reveal: source === "click" });
  syncToolbar();
}

/** Narrow the results to a folder (or, with null, to every source); a history entry, a new search. */
function setScope(scope) {
  const wanted = scope && scopeKey(scope) ? scope : null;
  // A path too deep for an ex_q clause is searched from its nearest folder that fits.
  const fitted = wanted ? fitScope(wanted) : null;
  state.scope = fitted;
  const done = commit();
  if (wanted && scopeKey(wanted) !== scopeKey(fitted)) showNotice(t("fs.scope_too_long"));
  return done;
}

function applySortColumn(column) {
  state.sort = nextSort(state.sort, column, hasKeyword());
  state.sortDirty = true;
  return commit();
}

function setViewMode(mode) {
  if (!VIEW_MODES.includes(mode)) return;
  ui.view = mode;
  saveViewMode(mode);
  if (ui.list) ui.list.setView(mode, { queryId: ui.queryId });
  syncToolbar();
}

// ── notices (non-blocking) ──

function showNotice(text) {
  const box = $("fs-notice");
  if (!box) return;
  clear(box);
  box.appendChild(el("span", { text }));
  const close = iconButton({ icon: uiIcon("close"), label: t("fs.close"), onClick: hideNotice });
  box.appendChild(close);
  box.classList.remove("d-none");
}

function hideNotice() {
  const box = $("fs-notice");
  if (box) { clear(box); box.classList.add("d-none"); }
}

// ── the folder drawer on narrow screens ──

function treeDrawerOpen() {
  return !!(ui.workspace && ui.workspace.dataset.tree === "open");
}

function openTreeDrawer() {
  if (!ui.workspace) return;
  ui.workspace.dataset.tree = "open";
  const toggle = $("fs-tree-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", "true");
  if (ui.tree) ui.tree.focus();
}

function closeTreeDrawer(restoreFocus) {
  if (!ui.workspace) return;
  ui.workspace.dataset.tree = "closed";
  const toggle = $("fs-tree-toggle");
  if (toggle) { toggle.setAttribute("aria-expanded", "false"); if (restoreFocus) toggle.focus(); }
}

// ── toolbar ──

const SORT_COLUMNS = ["relevance", "name", "modified", "size", "type", "location"];

/** The options drawer's name for a sort value (e.g. "by Date (desc)"); the value itself when it does not list it. */
function drawerSortLabel(sort) {
  const sel = $("sortSearchOption");
  const opt = sel && Array.from(sel.options).find(o => o.value === sort);
  return opt ? opt.textContent : sort;
}

/** Bring the sort control, view toggle, preview toggle and filter button in line with the state. */
function syncToolbar() {
  const keyword = hasKeyword();
  const current = describeSort(state.sort, keyword);
  const select = $("fs-sort-select");
  if (select) {
    clear(select);
    if (!current.column) {
      // A sort from the options drawer that no column sorts by (created, click_count, ...):
      // name it here rather than leave Name showing.
      const opt = el("option", { text: drawerSortLabel(state.sort), attrs: { value: "" } });
      opt.disabled = true;
      select.appendChild(opt);
    }
    for (const column of SORT_COLUMNS) {
      if (column === "relevance" && !keyword) continue;
      const opt = el("option", { text: t("fs.sort_" + column), attrs: { value: column } });
      if (!isSortSupported(column)) opt.disabled = true;
      select.appendChild(opt);
    }
    select.value = current.column;
  }
  const dir = $("fs-sort-dir");
  if (dir) {
    clear(dir);
    dir.appendChild(uiIcon(current.dir === "asc" ? "sort-asc" : "sort-desc"));
    const label = current.dir === "asc" ? t("fs.sort_asc") : t("fs.sort_desc");
    dir.setAttribute("aria-label", label);
    dir.title = label;
    dir.disabled = !current.column || current.column === "relevance";
  }
  document.querySelectorAll("#fs-view-toggle [data-view]").forEach(btn => {
    btn.setAttribute("aria-pressed", btn.dataset.view === ui.view ? "true" : "false");
  });
  const previewToggle = $("fs-preview-toggle");
  if (previewToggle) previewToggle.setAttribute("aria-pressed", ui.preview && ui.preview.isOpen() ? "true" : "false");
}

/** Wire the screen's static controls once. */
function wireScreen() {
  const on = (id, type, fn) => { const node = $(id); if (node) node.addEventListener(type, fn); };
  on("fs-sort-select", "change", ev => {
    const column = ev.target.value;
    if (column === describeSort(state.sort, hasKeyword()).column) return;
    state.sort = firstSort(column);
    state.sortDirty = true;
    commit();
  });
  on("fs-sort-dir", "click", () => applySortColumn(describeSort(state.sort, hasKeyword()).column));
  document.querySelectorAll("#fs-view-toggle [data-view]").forEach(btn => btn.addEventListener("click", () => setViewMode(btn.dataset.view)));
  on("fs-preview-toggle", "click", () => { if (ui.preview) { ui.preview.toggle(); syncToolbar(); } });
  on("fs-filter-toggle", "click", () => {
    const panel = $("fs-filters");
    if (!panel) return;
    const open = panel.classList.contains("d-none");
    panel.classList.toggle("d-none", !open);
    $("fs-filter-toggle").setAttribute("aria-expanded", open ? "true" : "false");
  });
  on("fs-tree-toggle", "click", () => (treeDrawerOpen() ? closeTreeDrawer(true) : openTreeDrawer()));
  on("fs-tree-close", "click", () => closeTreeDrawer(true));
  on("fs-scrim", "click", () => closeTreeDrawer(true));
  on("fs-up", "click", () => { if (state.scope) setScope(parentScope(state.scope)); });
  on("fs-copy-path", "click", ev => {
    if (!state.scope) return;
    const btn = ev.currentTarget;
    copyText(scopeDisplayPath(state.scope)).then(() => flashCopied(btn, t("fs.path_copied")), () => announce(t("fs.copy_failed")));
  });
  document.querySelectorAll("[data-fs-clear-recent]").forEach(btn => btn.addEventListener("click", () => { clearRecent(); renderRecent(); }));
  // The column headings stick just below the location bar and toolbar, whatever height those are.
  const sticky = document.querySelector(".fs-sticky");
  if (sticky && window.ResizeObserver) {
    new ResizeObserver(() => document.documentElement.style.setProperty("--fs-sticky-h", sticky.offsetHeight + "px")).observe(sticky);
  }
}

// ── location bar ──

function renderLocation() {
  const list = $("fs-crumbs");
  if (!list) return;
  clear(list);
  const scope = state.scope;
  const crumb = (label, target, current, title) => {
    const li = el("li", { className: "fs-crumb" });
    const btn = el("button", { className: "fs-crumb-btn", text: label, attrs: { type: "button", title: title || label } });
    if (current) btn.setAttribute("aria-current", "location");
    btn.addEventListener("click", () => { if (!current) setScope(target); });
    li.appendChild(btn);
    list.appendChild(li);
  };
  crumb(t("fs.scope_all"), null, !scope);
  const trail = breadcrumb(scope);
  trail.forEach((c, i) => crumb(c.label, c.scope, i === trail.length - 1, scopeDisplayPath(c.scope)));
  const path = scope ? scopeDisplayPath(scope) : "";
  list.classList.toggle("fs-crumbs--win", path.startsWith("\\\\"));
  const up = $("fs-up");
  if (up) up.disabled = !scope;
  const copy = $("fs-copy-path");
  if (copy) copy.disabled = !scope;
  const text = $("fs-pathtext");
  // A source on its own is already the whole breadcrumb; the path line is for folders.
  const showPath = !!scope && scope.type === "url";
  if (text) { text.textContent = showPath ? path : ""; text.title = path; text.classList.toggle("d-none", !showPath); }
}

// ── filters ──

/** Toggle `value` in an array stored under `key` of `store`, dropping the key when it empties. */
function toggleIn(store, key, value) {
  const arr = (store[key] = store[key] || []);
  const i = arr.indexOf(value);
  if (i >= 0) arr.splice(i, 1); else arr.push(value);
  if (arr.length === 0) delete store[key];
}

function toggleType(value) {
  toggleIn(state.facets, "filetype", value);
  return commit();
}

function toggleLabel(value) {
  toggleIn(state.facets, "label", value);
  return commit();
}

/** One date or size preset on; choosing the active one switches it off, another replaces it. */
function pickPreset(clause) {
  const group = presetFor(DATE_PRESETS, clause) ? DATE_PRESETS : SIZE_PRESETS;
  const inGroup = new Set(group.map(p => p.clause));
  const wasActive = state.facetQueries.includes(clause);
  state.facetQueries = state.facetQueries.filter(c => !inGroup.has(c));
  if (!wasActive) state.facetQueries.push(clause);
  return commit();
}

function clearFilters() {
  state.facets = {};
  state.fields = {};
  state.facetQueries = [];
  state.exQ = [];
  return commit();
}

/** The chips for every active filter (the folder is in the location bar, not here). */
function activeChips(labels) {
  const known = new Map((labels || []).map(l => [l.value, l.label]));
  const chips = [];
  (state.facets.filetype || []).forEach(v => chips.push({ label: t("fs.filter_type") + ": " + typeName(v), remove: () => toggleType(v) }));
  state.facetQueries.forEach(clause => {
    const date = presetFor(DATE_PRESETS, clause);
    const preset = date || presetFor(SIZE_PRESETS, clause);
    const title = t(date ? "fs.filter_modified" : "fs.filter_size");
    chips.push({ label: preset ? title + ": " + t(preset.labelKey) : clause, remove: () => pickPreset(clause) });
  });
  (state.facets.label || []).forEach(v => chips.push({ label: t("fs.filter_label") + ": " + (known.get(v) || v), remove: () => toggleLabel(v) }));
  // Explicit field filters (the drawer's label select, the user's default labels). A label is
  // shown by its name from label_options, as everywhere else a label is chosen.
  const labelOptions = (api.getConfig() || {}).label_options || [];
  for (const [field, values] of Object.entries(state.fields)) {
    (Array.isArray(values) ? values : []).forEach(v => {
      const option = field === "label" ? labelOptions.find(o => o.value === v) : null;
      chips.push({
        label: (field === "label" ? t("fs.filter_label") : field) + ": " + (option ? (option.name || option.value) : v),
        remove: () => { toggleIn(state.fields, field, v); return commit(); },
      });
    });
  }
  state.exQ.forEach(clause => chips.push({
    label: clause,
    remove: () => { state.exQ = state.exQ.filter(c => c !== clause); return commit(); },
  }));
  return chips;
}

function renderFilters(env, labels) {
  const panel = $("fs-filters");
  const cfg = api.getConfig() || {};
  let active = 0;
  if (panel) active = renderFilterPanel(panel, { env, typeFacet: ui.typeFacet, state, cfg, labels, onType: toggleType, onPreset: pickPreset, onLabel: toggleLabel });
  const chips = $("active-chips");
  if (chips) renderChips(chips, activeChips(labels), { onClearAll: clearFilters });
  const badge = $("fs-filter-count");
  if (badge) {
    badge.textContent = active ? String(active) : "";
    badge.classList.toggle("d-none", !active);
  }
}

// ── folder tree ──

function syncTree(env) {
  if (!ui.tree) return;
  ui.tree.sync({
    // The counts depend on the keyword and filters, not on the folder, the page or the sort.
    key: JSON.stringify(conditionParams({ withScope: false })),
    scope: state.scope,
    docs: env.data || [],
    count: env.record_count,
    relation: env.record_count_relation,
  });
}

/** The home view's folder browser: the sources, expandable, each leading into the results. */
export function renderHomeBrowse() {
  const root = $("home-tree");
  if (root) {
    if (!ui.homeTree) {
      ui.homeTree = createTreeView({
        root, status: $("home-tree-status"), warning: $("home-tree-warning"),
        getBase: () => ({ q: "" }),
        onSelect: scope => navigate("search?ex_q=" + encodeURIComponent(scopeClause(scope))),
      });
    }
    ui.homeTree.loadHome();
  }
  renderRecent();
}

// ── recent searches ──

function renderRecent() {
  const items = getRecent();
  for (const id of ["fs-recent", "home-recent"]) {
    const section = $(id);
    if (!section) continue;
    const list = section.querySelector("ul");
    if (list) {
      clear(list);
      items.forEach(q => {
        const li = el("li");
        li.appendChild(el("a", { text: q, attrs: { href: "search?q=" + encodeURIComponent(q), "data-spa": "" } }));
        list.appendChild(li);
      });
    }
    section.classList.toggle("d-none", items.length === 0);
  }
}

// ── page-wide keys: / focuses the search box, Esc closes the preview or the folder drawer ──

function onGlobalKey(ev) {
  const results = $("results-view");
  const home = $("home-view");
  const onResults = !!results && !results.hasAttribute("hidden");
  const onHome = !!home && !home.hasAttribute("hidden");
  if (!onResults && !onHome) return;
  const action = globalKey({
    key: ev.key, editable: isEditable(ev.target), ctrlKey: ev.ctrlKey, metaKey: ev.metaKey, altKey: ev.altKey,
    overlayOpen: onResults && (treeDrawerOpen() || !!(ui.preview && ui.preview.isOpen())),
  });
  if (!action) return;
  if (action.type === "focus-search") {
    const input = $(onHome ? "contentQuery" : "query");
    if (input) { ev.preventDefault(); input.focus(); if (input.select) input.select(); }
  } else if (action.type === "close") {
    ev.preventDefault();
    if (treeDrawerOpen()) closeTreeDrawer(true);
    else if (ui.preview) ui.preview.close();
    syncToolbar();
  }
}

let suggestTimer = null;
let suggestIndex = -1;
/** Guard: prevent duplicate fess:route:change listener registration. */
let routeListenerAttached = false;

function renderSuggestItems(items) {
  const dropdown = document.getElementById("suggest-dropdown");
  // Clear by removing child nodes — avoids innerHTML with any dynamic string.
  while (dropdown.firstChild) dropdown.removeChild(dropdown.firstChild);
  items.forEach((it, i) => {
    const li = el("li", {
      className: "list-group-item",
      text: it.text || "",
      attrs: { role: "option", id: "suggest-item-" + i, "aria-selected": "false" },
      dataset: { idx: i, text: it.text || "" }
    });
    dropdown.appendChild(li);
  });
}

async function showSuggest(q) {
  const dropdown = document.getElementById("suggest-dropdown");
  const inp = document.getElementById("query");
  if (!q || q.length < 1) {
    dropdown.classList.add("d-none");
    while (dropdown.firstChild) dropdown.removeChild(dropdown.firstChild);
    if (inp) inp.setAttribute("aria-expanded", "false");
    return;
  }
  try {
    const suggestParams = { q, num: 10, fn: ["_default", "content", "title"] };
    if (Array.isArray(state.lang) && state.lang.length > 0) suggestParams.lang = state.lang;
    const labelFilters = (state.fields && state.fields.label) || [];
    if (labelFilters.length > 0) suggestParams.label = labelFilters;
    const env = await api.get("/suggest-words", suggestParams);
    const items = env.suggest_words || [];
    if (items.length === 0) {
      dropdown.classList.add("d-none");
      if (inp) inp.setAttribute("aria-expanded", "false");
      return;
    }
    renderSuggestItems(items);
    dropdown.classList.remove("d-none");
    if (inp) inp.setAttribute("aria-expanded", "true");
    suggestIndex = -1;
  } catch { /* swallow — suggest is best-effort */ }
}

function hideSuggest() {
  const dropdown = document.getElementById("suggest-dropdown");
  const inp = document.getElementById("query");
  dropdown.classList.add("d-none");
  if (inp) { inp.setAttribute("aria-expanded", "false"); inp.removeAttribute("aria-activedescendant"); }
  suggestIndex = -1;
}

/**
 * Disable a submit button briefly to guard against double-submits, then
 * re-enable it. Mirrors the JSP behaviour (BUTTON_DISABLE_DURATION=3000ms).
 * The SPA navigates client-side, so re-enabling on a timer is appropriate.
 * Call this AFTER the search/navigation has been triggered — it only touches
 * the button and never blocks or delays the actual search.
 *
 * @param {HTMLButtonElement|null} btn - the submit button to disable
 */
export function disableSubmitBriefly(btn) {
  if (!btn) return;
  btn.disabled = true;
  setTimeout(() => { btn.disabled = false; }, 3000);
}

/**
 * ADV-4: Reusable suggest wiring — attach autocomplete to any text input and dropdown list.
 * Calls /suggest-words with the same shape as showSuggest; renders with createElement/textContent only.
 *
 * @param {HTMLInputElement} input    - the text field to attach to
 * @param {HTMLElement}      dropdown - a <ul> that will be populated with <li> suggestions
 * @param {{ lang?: string[] | { length: number } }} [opts] - options; opts.lang can be a getter
 */
export function attachSuggest(input, dropdown, opts = {}) {
  if (!input || !dropdown) return;
  let timer = null;
  const clear = () => {
    while (dropdown.firstChild) dropdown.removeChild(dropdown.firstChild);
    dropdown.classList.add("d-none");
    input.setAttribute("aria-expanded", "false");
  };
  const choose = (text) => {
    input.value = text;
    clear();
    // submitOnSelect: opt-in flag — submit the form after filling the input, matching
    // default-JSP suggestor.js and the results-page header suggest behavior.
    // Advanced search does not pass this flag and keeps the fill-only path.
    if (opts.submitOnSelect) {
      const form = input.form || input.closest("form");
      if (form) { form.dispatchEvent(new Event("submit")); }
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
        const li = document.createElement("li");
        li.className = "list-group-item";
        li.setAttribute("role", "option");
        li.id = input.id + "-suggest-" + i;
        li.textContent = it.text || "";
        li.addEventListener("mousedown", (e) => { e.preventDefault(); choose(it.text || ""); });
        dropdown.appendChild(li);
      });
      dropdown.classList.remove("d-none");
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
 * H.4: Subscribe once to the fess:route:change event so that navigating away
 * from the search view (/, /search, /index) cancels any pending suggest timer
 * and collapses the dropdown.  The guard prevents double-registration if
 * attach() is ever called a second time (the `attached` flag above normally
 * stops that, but the guard is cheap insurance).
 */
function ensureRouteListener() {
  if (routeListenerAttached) return;
  routeListenerAttached = true;
  document.addEventListener("fess:route:change", (e) => {
    const path = (e.detail?.path || "").replace(/\/+$/, "") || "/";
    const inSearch = path === "/" || path === "/search" || path === "/index";
    if (!inSearch) {
      if (suggestTimer) { clearTimeout(suggestTimer); suggestTimer = null; }
      const dropdown = document.getElementById("suggest-dropdown");
      if (dropdown) dropdown.classList.add("d-none");
      // Leaving the results: stop any preview load and release its Blob; shut the folder drawer.
      if (ui.preview) ui.preview.clear();
      if (treeDrawerOpen()) closeTreeDrawer(false);
    }
  });
}

// ─── Phase 3: Search option selects ──────────────────────────────────────────

/**
 * Task 3.1 — Populate the sort <select> from api config sort_options.
 * Uses fess_label-compatible keys directly as i18n keys (no mapping needed).
 */
function renderSortOptions() {
  const sel = document.getElementById("sortSearchOption");
  if (!sel) return;
  while (sel.firstChild) sel.removeChild(sel.firstChild);
  const cfg = api.getConfig() || {};
  const rawOpts = cfg.sort_options && cfg.sort_options.length > 0
    ? cfg.sort_options
    : [{ value: "score.desc", label_key: "labels.search_result_sort_score_desc" }];
  // JSP parity (searchOptions.jsp): a single empty-value placeholder heads the
  // sort list, followed by the real sort options. The server's sort_options
  // already supplies a leading value="" entry (labelled "Score"); drop it before
  // prepending the placeholder so the list does not show a duplicate empty
  // option + "Score"/"スコア順" pair.
  const body = (rawOpts.length > 0 && (rawOpts[0].value == null || rawOpts[0].value === ""))
    ? rawOpts.slice(1)
    : rawOpts;
  const opts = [
    { value: "", label_key: "labels.advance_search_sort_default" },
    ...body,
  ];
  for (const o of opts) {
    const opt = document.createElement("option");
    opt.value = o.value != null ? o.value : "";
    opt.textContent = t(o.label_key || o.value || "");
    sel.appendChild(opt);
  }
  sel.value = state.sort || "";
}

/**
 * Task 3.2 — Populate the num <select> from api config num_options.
 */
function renderNumOptions() {
  const sel = document.getElementById("numSearchOption");
  if (!sel) return;
  while (sel.firstChild) sel.removeChild(sel.firstChild);
  const cfg = api.getConfig() || {};
  const nums = cfg.num_options && cfg.num_options.length > 0
    ? cfg.num_options
    : [10, 20, 50];
  for (const n of nums) {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = t("search.num_format", { num: n });
    sel.appendChild(opt);
  }
  sel.value = String(state.num || 10);
}

/**
 * Task 3.3 — Populate the lang <select multiple> from api config lang_options.
 * Parity with JSP: the lang select is multi-select so users can choose several
 * languages simultaneously. state.lang is string[] and is serialised as repeated
 * lang= query parameters.
 */
function renderLangOptions() {
  const sel = document.getElementById("langSearchOption");
  if (!sel) return;
  while (sel.firstChild) sel.removeChild(sel.firstChild);

  // Promote to multi-select with a visible size.
  sel.setAttribute("multiple", "");
  sel.setAttribute("size", "4");

  const cfg = api.getConfig() || {};
  const langs = cfg.lang_options || [];

  const selected = Array.isArray(state.lang) ? state.lang : (state.lang ? [state.lang] : []);

  // C.15: the server already prepends an "all" sentinel (value="all" or value="").
  // Add our own "All Languages" option only when the server does NOT provide one.
  const serverHasAll = langs.some(l => l.value === "all" || l.value === "" || l.value == null);
  if (!serverHasAll) {
    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = t("labels.searchoptions_all_langs");
    allOpt.selected = selected.length === 0;
    sel.appendChild(allOpt);
  }

  for (const lang of langs) {
    const rawVal = lang.value != null ? lang.value : "";
    // Treat server's "all" sentinel as the empty-state — map to value="" so it
    // behaves the same as our locally-added "All Languages" option.
    const optVal = rawVal === "all" ? "" : rawVal;
    const opt = document.createElement("option");
    opt.value = optVal;
    if (rawVal === "all" || rawVal === "") {
      opt.textContent = t("labels.searchoptions_all_langs");
      opt.selected = selected.length === 0;
    } else {
      opt.textContent = languageLabel(rawVal, lang.label || rawVal || "");
      opt.selected = selected.includes(optVal);
    }
    sel.appendChild(opt);
  }
}

/**
 * Task 3.4 — Build the label filter dropdown (checkbox list) using createElement only.
 * label_options: [{ value, name }] from api config.
 */
function renderLabelOptions() {
  // Parity with searchOptions.jsp label fieldset: a multi-select #labelSearchOption
  // shown only when display_label_type is enabled and label options exist.
  const sel = document.getElementById("labelSearchOption");
  const fieldset = document.getElementById("labelSearchOptionFieldset");
  if (!sel) return;
  const cfg = api.getConfig() || {};
  const labelOpts = cfg.label_options || [];
  const show = !!(cfg.features && cfg.features.display_label_type) && labelOpts.length > 0;
  if (fieldset) fieldset.classList.toggle("d-none", !show);
  while (sel.firstChild) sel.removeChild(sel.firstChild);
  if (!show) return;

  const selected = state.fields.label || [];
  for (const lo of labelOpts) {
    const opt = document.createElement("option");
    opt.value = lo.value != null ? lo.value : "";
    opt.textContent = lo.name || lo.value || "";
    opt.selected = selected.includes(opt.value);
    sel.appendChild(opt);
  }
}

/**
 * (Re-)initialise all search option selects from config. Safe to call multiple times.
 * Listeners are attached once in attach(); this only repopulates the options.
 */
function renderSearchOptions() {
  renderSortOptions();
  renderNumOptions();
  renderLangOptions();
  renderLabelOptions();
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trigger a fresh search with the current state without registering additional
 * event listeners. Safe to call from app.js after auth changes.
 */
export function refresh() {
  runSearch();
}

/**
 * C.16: Keep header and home search inputs in sync.
 * Call with the new query value whenever a view transition changes the canonical query.
 */
function syncSearchInputs(q) {
  const header = document.getElementById("query");
  const home   = document.getElementById("contentQuery");
  if (header) header.value = q;
  if (home)   home.value   = q;
}

/**
 * A.8: Read URL search parameters into state and run a fresh search.
 * Called by app.js on every route dispatch (including popstate / back-forward)
 * so the results always reflect the current URL.
 */
export function runFromUrl() {
  const params = new URLSearchParams(location.search);
  const q = params.get("q");
  state.q = q || "";
  state.start = Number(params.get("start")) || 0;
  // JSP parity (SearchAction, session attribute resultsPerPage): an explicit num is
  // remembered for this tab; a URL without one uses the remembered or default size.
  const numVal = Number(params.get("num"));
  if (numVal > 0) {
    state.num = numVal;
    rememberNum(numVal);
  } else {
    state.num = initialNum();
  }
  state.sort = params.get("sort") || "";
  // C.16: sync both inputs to reflect the URL query.
  syncSearchInputs(state.q);
  // GEO-1: hydrate geo state from URL params
  const geoPoint = params.get("geo.location.point") || "";
  const geoDistance = params.get("geo.location.distance") || "";
  if (geoPoint && geoDistance) {
    const [lat, lon] = geoPoint.split(",");
    state.geo = { lat: (lat || "").trim(), lon: (lon || "").trim(), distance: geoDistance.trim() };
    const latEl = document.getElementById("geo-lat"); if (latEl) latEl.value = state.geo.lat;
    const lonEl = document.getElementById("geo-lon"); if (lonEl) lonEl.value = state.geo.lon;
    const distEl = document.getElementById("geo-distance"); if (distEl) distEl.value = state.geo.distance;
  } else { state.geo = { lat: "", lon: "", distance: "" }; }
  // ADV-2: hydrate lang / fields.* / ex_q from URL (forwarded by advance search submit)
  state.lang = params.getAll("lang").filter(v => v !== "");
  // Facet selections (sidebar label facets and facet query views) travel in the URL as
  // ex_q clauses (see syncUrlParams), so every navigation re-derives them from the URL;
  // a URL without them (e.g. a search-options submit) clears them.
  state.facets = {};
  state.facetQueries = [];
  state.scope = null;
  // The similar-docs hash (sdh) is merged into the request. The SPA keeps it in memory,
  // but JSP result and paging links carry it in the URL, so take it from there and clear
  // it when the URL has none.
  state.sdh = params.get("sdh") || "";
  state.fields = {};
  // Advanced-search conditions (as.q, as.epq, ...) arrive in URLs made by the JSP pages;
  // pass them to the API unchanged.
  state.as = {};
  for (const [key, value] of params.entries()) {
    if (value === "") continue;
    if (key.startsWith("fields.")) {
      const field = key.slice("fields.".length);
      (state.fields[field] = state.fields[field] || []).push(value);
    } else if (key.startsWith("as.")) {
      const name = key.slice("as.".length);
      (state.as[name] = state.as[name] || []).push(value);
    }
  }
  // Sort each ex_q clause back into the store its control reads (folder scope, file types,
  // modified / size presets, labels); any other clause (e.g. from advanced search) is kept as is.
  const classified = classifyExQ(params.getAll("ex_q"));
  state.scope = classified.scope;
  state.facets = classified.facets;
  state.facetQueries = classified.facetQueries;
  state.exQ = classified.exQ;
  state.sortDirty = false;
  // Run a search when a keyword OR any active filter is present in the URL (label /
  // other fields, geo, or ex_q). The classic JSP theme issues the request for
  // filter-only URLs such as /search?fields.label=fess, so mirror that here instead
  // of bailing on an empty keyword. sort/num/lang are query modifiers, not a search
  // on their own. Hydrating state above before this check also sets state.q to "" for
  // a filter-only URL, so a previous keyword can't leak into the next search:
  // runSearch() reads state.q, and the option-drawer Search button omits an empty q.
  const hasFields = Object.keys(state.fields).length > 0;
  const hasGeo = !!(state.geo.lat && state.geo.lon && state.geo.distance);
  const hasExQ = exQClauses().length > 0;
  // JSP parity (SearchRequestParams.hasConditionQuery): these advanced-search conditions
  // are a search on their own; as.occt only narrows one.
  const hasConditions = ["q", "epq", "oq", "nq", "timestamp", "sitesearch", "filetype"]
    .some(name => (state.as[name] || []).length > 0);
  if (!state.q && !hasFields && !hasGeo && !hasExQ && !hasConditions) {
    // A blank query with no conditions (e.g. a sort/num/lang-only URL such as
    // /search?num=10) is not a search. JSP parity: SearchAction.doSearch() redirects
    // such requests to the top page via redirectToRoot(), so mirror that here. Without
    // this, the results view keeps showing the PREVIOUS query's results, because the
    // results DOM is re-rendered only when runSearch() runs and neither showView() nor
    // resetSearchState() clears it. Use replace: true so the empty /search entry does
    // not linger in history (matching the server-side redirect).
    navigate("./", { replace: true });
    return;
  }
  const cfg = api.getConfig();
  if (cfg) {
    // JSP parity (FessSearchAction.buildFormParams): apply the user's default labels when
    // the URL has no fields.label, and the default sort when it names no sort. This runs
    // after the empty-search check, so the defaults never turn an empty URL into a search.
    if (!params.has("fields.label") && Array.isArray(cfg.default_label_values) && cfg.default_label_values.length > 0) {
      state.fields.label = [...cfg.default_label_values];
    }
    if (!state.sort && cfg.default_sort) state.sort = cfg.default_sort;
    // Re-sync the search-options drawer selects (sort / num / lang / label) to the
    // freshly hydrated state. attach() renders them only once, so without this a
    // navigation (link click, back/forward, facet submit) would leave the selects
    // showing stale values. That matters now that the selects are applied on the
    // Search button: a stale displayed value would otherwise be written back into the
    // URL on the next submit, silently reverting the user's actual sort/num/lang.
    // Guarded on config so the option lists exist before we re-render them.
    renderSearchOptions();
  }
  runSearch();
}

/**
 * Reset all search state and the option-drawer DOM controls to their defaults.
 * Called when the SPA lands on the home view (logo click / "/") so that keyword,
 * label, language, count, sort and geo values from the previous search do not carry
 * over into the next one — JSP parity: returning to the search top clears the form.
 * Does NOT dispatch change events (unlike the drawer "Clear" button), so it never
 * triggers a search on the home view.
 */
export function resetSearchState() {
  // JSP parity (RootAction → buildFormParams): the home page starts from the remembered or
  // default page size and pre-selects the user's default labels and sort.
  const cfg = api.getConfig();
  const defaultLabels = cfg && Array.isArray(cfg.default_label_values) ? cfg.default_label_values : [];
  state.q = "";
  state.start = 0;
  state.num = initialNum();
  state.sort = (cfg && cfg.default_sort) || "";
  state.lang = [];
  state.sdh = "";
  state.as = {};
  state.facets = {};
  state.fields = defaultLabels.length > 0 ? { label: [...defaultLabels] } : {};
  state.facetQueries = [];
  state.exQ = [];
  state.scope = null;
  state.sortDirty = false;
  state.geo = { lat: "", lon: "", distance: "" };
  // Keep both keyword inputs (header #query / home #contentQuery) in sync and empty.
  syncSearchInputs("");
  // Drawer geo inputs + option selects (searchOptions.jsp).
  ["geo-lat", "geo-lon", "geo-distance"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  ["numSearchOption", "sortSearchOption", "langSearchOption", "labelSearchOption"].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    if (sel.multiple) {
      Array.from(sel.options).forEach(o => { o.selected = false; });
    } else {
      sel.selectedIndex = 0;
    }
  });
  // Show the defaults in the drawer selects once the option lists can be built. Reading the
  // selects back instead would turn the default sort into the empty placeholder.
  if (cfg) renderSearchOptions();
}

/** sessionStorage key of the page size last searched with (JSP: session attribute resultsPerPage). */
const NUM_STORAGE_KEY = "fess.search.num";

/**
 * Page size for a search whose URL has no num: the size remembered for this tab, capped at
 * page_size_max and rounded down to an offered num option (the smallest option when it is
 * below all of them); otherwise page_size_default; otherwise 10.
 */
export function initialNum() {
  const cfg = api.getConfig() || {};
  const pageSizeDefault = Number(cfg.page_size_default);
  const fallback = pageSizeDefault > 0 ? pageSizeDefault : 10;
  let stored = 0;
  try {
    stored = Math.trunc(Number(sessionStorage.getItem(NUM_STORAGE_KEY)));
  } catch { /* storage unavailable (e.g. blocked site data) */ }
  if (!(stored > 0)) return fallback;
  const max = Number(cfg.page_size_max);
  const capped = max > 0 ? Math.min(stored, max) : stored;
  const options = (cfg.num_options || []).map(Number).filter(n => n > 0).sort((a, b) => a - b);
  if (options.length === 0) return capped;
  const lower = options.filter(n => n <= capped);
  return lower.length > 0 ? lower[lower.length - 1] : options[0];
}

/** Remember the page size of an explicit search for this tab. */
function rememberNum(num) {
  try {
    sessionStorage.setItem(NUM_STORAGE_KEY, String(num));
  } catch { /* storage unavailable */ }
}

/** Forget the remembered page size (on logout, as the JSP session attribute ended with the session). */
export function forgetNum() {
  try {
    sessionStorage.removeItem(NUM_STORAGE_KEY);
  } catch { /* storage unavailable */ }
}

function ensureOsddLink() {
  const cfg = api.getConfig();
  // JSP parity (osddLink): emit the link only when the server serves the OpenSearch
  // description document (OsddHelper#hasOpenSearchFile).
  if (!cfg || !(cfg.features || {}).osdd_link) return;
  if (document.querySelector('link[rel="search"]')) return;
  const link = document.createElement("link");
  link.setAttribute("rel", "search");
  link.setAttribute("type", "application/opensearchdescription+xml");
  link.setAttribute("title", cfg.site_name || "Fess");
  link.setAttribute("href", "osdd");
  document.head.appendChild(link);
}

export function attach() {
  // Called from both main() (to wire the header form early) and the results route;
  // the second call is expected and idempotent, so return quietly (no warning noise).
  if (attached) {
    return;
  }
  attached = true;
  ensureOsddLink();
  ensureRouteListener(); // H.4: cancel suggest timer when navigating away
  ensureUi();
  document.addEventListener("keydown", onGlobalKey);
  const form = document.getElementById("search-form");
  const input = document.getElementById("query");
  const dropdown = document.getElementById("suggest-dropdown");
  if (form) {
    form.addEventListener("submit", ev => {
      ev.preventDefault();
      const q = input.value.trim();
      // A new query from the header search box starts a fresh search, so any facet
      // filters applied to the previous query are reset (they no longer apply). The
      // folder the user is in is not a filter of that query but where they are looking:
      // the search stays inside it, and its breadcrumb is how to widen it again.
      state.facets = {};
      state.fields = {};
      state.facetQueries = [];
      const keepScope = scopeClause(state.scope);
      hideSuggest();
      // C.16: keep home-search-input in sync when submitting from the header
      syncSearchInputs(q);
      // Reflect the query in the address bar: build the /search URL from the new
      // query, carrying over current options (num/sort/lang/geo) while dropping the
      // previous query's page offset and facet/field filters, then navigate().
      // navigate() pushes history and runFromUrl() runs the search, so the URL's q=
      // param always matches what was searched (and back/forward works).
      const params = new URLSearchParams(location.search);
      if (q) params.set("q", q); else params.delete("q");
      params.delete("start");
      for (const key of [...params.keys()]) {
        // JSP parity (header.jsp): the header form holds neither the similar-docs hash nor
        // advanced-search conditions, so a new query drops them.
        if (key.startsWith("fields.") || key.startsWith("as.") || key === "ex_q" || key === "sdh") params.delete(key);
      }
      // JSP parity: apply the current sort / num / lang drawer selections rather
      // than only carrying over the previous URL values, so a manual change to these
      // selects takes effect when the header Search button is pressed (the selects no
      // longer auto-run a search on change). Guarded on config so the selects are
      // populated before we read them.
      if (api.getConfig()) {
        const sortSel = document.getElementById("sortSearchOption");
        if (sortSel) { if (sortSel.value) params.set("sort", sortSel.value); else params.delete("sort"); }
        const numSel = document.getElementById("numSearchOption");
        // Unlike sort, the num select has no empty placeholder option, so its value is always
        // present; there is no empty case to delete here.
        if (numSel && numSel.value) params.set("num", numSel.value);
        const langSel = document.getElementById("langSearchOption");
        if (langSel) {
          params.delete("lang");
          Array.from(langSel.selectedOptions).map(o => o.value).filter(Boolean).forEach(v => params.append("lang", v));
        }
        // The drawer's labels ride along too: on the JSP page they sit inside the header form.
        const labelSel = document.getElementById("labelSearchOption");
        if (labelSel) Array.from(labelSel.selectedOptions).map(o => o.value).filter(Boolean).forEach(v => params.append("fields.label", v));
      }
      if (keepScope) params.append("ex_q", keepScope);
      navigate("search?" + params.toString());
      // JSP parity: disable the submit button for 3s after the search has been
      // triggered, to prevent rapid double-submits.
      disableSubmitBriefly(document.getElementById("searchButton"));
    });
  }
  // Search-options "Clear" button (searchOptions.jsp #searchOptionsClearButton):
  // reset the drawer option controls (num/sort/lang/label + geo) to their defaults.
  // JSP parity: this is a purely visual reset — it does NOT re-run the search.
  // The reset values are applied on the next Search-button press, matching searchOptions.jsp
  // whose Clear button only resets the select indices and never submits the form. (The geo
  // inputs are cleared visually here too; the geo filter is dropped only when the drawer's own
  // Search button is pressed and reads the now-empty inputs. A header-form submit instead
  // preserves the geo params already in the URL, matching the JSP theme whose header form
  // carries geo forward via hidden inputs.)
  const optClearBtn = document.getElementById("searchOptionsClearButton");
  if (optClearBtn) {
    optClearBtn.addEventListener("click", () => {
      ["geo-lat", "geo-lon", "geo-distance"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
      ["numSearchOption", "sortSearchOption", "langSearchOption", "labelSearchOption"].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        if (sel.multiple) {
          Array.from(sel.options).forEach(o => { o.selected = false; });
        } else {
          sel.selectedIndex = 0;
        }
      });
    });
  }
  // Search-options drawer "Search" button. It is form="search-form" (the header form),
  // but on the home view the header form is hidden and the query lives in #contentQuery,
  // so a plain submit does nothing. Build the search URL from the active query + drawer
  // options and navigate — works from both the home and results views.
  const optSearchBtn = document.querySelector('#searchOptions button[type="submit"]');
  if (optSearchBtn) {
    optSearchBtn.addEventListener("click", ev => {
      ev.preventDefault();
      const homeActive = !document.getElementById("home-view")?.hasAttribute("hidden");
      const qInput = homeActive ? document.getElementById("contentQuery") : document.getElementById("query");
      const q = ((qInput && qInput.value) || "").trim();
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      const sortSel = document.getElementById("sortSearchOption");
      if (sortSel && sortSel.value) params.set("sort", sortSel.value);
      const numSel = document.getElementById("numSearchOption");
      if (numSel && numSel.value) params.set("num", numSel.value);
      const langSel = document.getElementById("langSearchOption");
      if (langSel) Array.from(langSel.selectedOptions).map(o => o.value).filter(Boolean).forEach(v => params.append("lang", v));
      const labelSel = document.getElementById("labelSearchOption");
      if (labelSel) Array.from(labelSel.selectedOptions).map(o => o.value).filter(Boolean).forEach(v => params.append("fields.label", v));
      // Geo filter (migrated into the drawer): include only when all three inputs
      // are set, matching the geo.location.point/distance pair runSearch() emits.
      const geoLat = (document.getElementById("geo-lat")?.value || "").trim();
      const geoLon = (document.getElementById("geo-lon")?.value || "").trim();
      const geoDist = (document.getElementById("geo-distance")?.value || "").trim();
      if (geoLat && geoLon && geoDist) {
        params.set("geo.location.point", geoLat + "," + geoLon);
        params.set("geo.location.distance", geoDist);
      }
      // The drawer changes how the results are shown, not what they were narrowed to: keep the
      // URL's ex_q clauses (sidebar facet selections and advanced-search conditions) so that
      // changing the sort does not silently drop a selected label. Only a new query from the
      // header form starts over without them.
      new URLSearchParams(location.search).getAll("ex_q").forEach(v => params.append("ex_q", v));
      navigate("search?" + params.toString());
    });
  }
  if (input) {
    input.addEventListener("input", () => {
      if (suggestTimer) clearTimeout(suggestTimer);
      const v = input.value.trim();
      suggestTimer = setTimeout(() => showSuggest(v), 150);
    });
    input.addEventListener("keydown", ev => {
      const items = dropdown.querySelectorAll(".list-group-item");
      if (!items.length || dropdown.classList.contains("d-none")) return;
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        suggestIndex = suggestIndex >= items.length - 1 ? 0 : suggestIndex + 1;
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        suggestIndex = suggestIndex <= 0 ? items.length - 1 : suggestIndex - 1;
      } else if (ev.key === "Enter" && suggestIndex >= 0) {
        ev.preventDefault();
        input.value = items[suggestIndex].dataset.text;
        hideSuggest();
        form.dispatchEvent(new Event("submit"));
        return;
      } else if (ev.key === "Tab" && suggestIndex >= 0) {
        // H.3: Google-style Tab-to-accept — commit the highlighted suggestion
        // and prevent Tab from moving focus away.
        ev.preventDefault();
        input.value = items[suggestIndex].dataset.text;
        hideSuggest();
        form.dispatchEvent(new Event("submit"));
        return;
      } else if (ev.key === "Escape") { hideSuggest(); return; }
      items.forEach((it, i) => {
        const active = i === suggestIndex;
        it.classList.toggle("active", active);
        it.setAttribute("aria-selected", active ? "true" : "false");
      });
      if (suggestIndex >= 0 && items[suggestIndex]) {
        input.setAttribute("aria-activedescendant", items[suggestIndex].id);
      } else {
        input.removeAttribute("aria-activedescendant");
      }
    });
    input.addEventListener("blur", () => setTimeout(hideSuggest, 150));
  }
  if (dropdown) {
    dropdown.addEventListener("mousedown", ev => {
      const li = ev.target.closest(".list-group-item");
      if (!li) return;
      ev.preventDefault();
      if (input) input.value = li.dataset.text;
      hideSuggest();
      form.dispatchEvent(new Event("submit"));
    });
  }
  // Geo filter apply/clear is handled by the drawer's main Search / Clear buttons
  // (geo inputs were migrated into #searchOptions); no separate geo buttons.

  // JSP parity: the sort / num / lang drawer selects do NOT auto-run a search on
  // change. The default JSP search screen only applies these options when a Search button
  // is pressed, so changing a select here is a no-op until the user submits — either via
  // the header form (#search-form, which reads these selects in its submit handler above)
  // or the drawer's own Search button (#searchOptions button[type="submit"], wired above).
  // Re-introducing a `change -> runSearch()` handler here would resurrect the reported bug
  // where results changed before the Search button was pressed.

  // Populate search option selects once config is available.
  // api.init() is awaited by app.js before attach() is called, so getConfig()
  // should already be populated, but guard against timing edge cases.
  if (api.getConfig()) {
    renderSearchOptions();
  }

  // A.8: URL-driven search is handled by runFromUrl() called from app.js route
  // handlers on every dispatch (including popstate). attach() only wires DOM
  // listeners and populates the input once — it no longer triggers a search itself.
  const urlQ = new URLSearchParams(location.search).get("q");
  if (urlQ && input) { input.value = urlQ; state.q = urlQ; }
}

/**
 * (Re-)render search option dropdowns. Call this after api.init() completes
 * if attach() ran before config was available.
 */
export function initSearchOptions() {
  renderSearchOptions();
}

async function loadLabels() {
  // The label filter exists only when the server shows labels at all.
  const cfg = api.getConfig() || {};
  if (!(cfg.features && cfg.features.display_label_type)) return [];
  try {
    const env = await api.get("/labels");
    return env.labels || [];
  } catch { return []; }
}





/**
 * Unified popular-words renderer — shared by home, empty-state, and results header slots.
 * JSP parity: first 3 words are always visible; index ≥ 3 carry class d-sm-inline-block
 * (hidden on xs, visible on sm+). No fixed upper-limit slice (was slice(0,5)).
 *
 * @param {string[]} words    - array of popular word strings
 * @param {Element}  targetEl - the container element to render into
 */
export function renderPopularWords(words, targetEl) {
  if (!targetEl) return;
  while (targetEl.firstChild) targetEl.removeChild(targetEl.firstChild);
  if (!words || words.length === 0) {
    targetEl.classList.add("d-none");
    return;
  }
  targetEl.classList.remove("d-none");
  const label = el("span", { className: "me-2", text: t("labels.search_popular_word_word") });
  targetEl.appendChild(label);
  words.forEach((w, i) => {
    // data-spa anchor: the router intercepts the click and navigates to
    // /search?q=w, which runFromUrl() turns into a full search (syncs inputs,
    // resets start, pushes history). No inline click handler — parity-r3 review:
    // an inline runSearch() here double-fired the search alongside the router.
    const a = el("a", {
      className: "me-1" + (i >= 3 ? " d-sm-inline-block d-none" : ""),
      text: w,
      attrs: {
        href: "search?q=" + encodeURIComponent(w),
        "data-spa": ""
      }
    });
    targetEl.appendChild(a);
  });
}

async function loadPopularWords() {
  const target = document.getElementById("popular-words");
  if (!target) return;
  const cfg = api.getConfig() || {};
  if (!cfg.features || !cfg.features.popular_word) return;
  try {
    const env = await api.get("/popular-words");
    const words = env.popular_words || [];
    if (words.length === 0) return;
    target.classList.remove("d-none");
    renderPopularWords(words, target);
  } catch { /* best-effort */ }
}


/**
 * Render related query buttons above the results list (Feature 1).
 * Queries come from /api/v2/related-query (key: `queries`).
 *
 * @param {string[]} queries
 */
function renderRelatedQueries(queries) {
  const container = document.getElementById("related-queries");
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);
  if (!queries || queries.length === 0) {
    container.classList.add("d-none");
    return;
  }
  container.classList.remove("d-none");
  const label = el("span", { className: "related-queries-label text-muted small me-2", text: t("search.related_queries") + ":" });
  container.appendChild(label);
  queries.forEach(q => {
    const btn = el("a", {
      className: "btn btn-sm btn-outline-secondary me-1 mb-1",
      text: q,
      attrs: { href: "?q=" + encodeURIComponent(q) }
    });
    btn.addEventListener("click", ev => {
      ev.preventDefault();
      const input = document.getElementById("query");
      if (input) input.value = q;
      state.q = q;
      state.start = 0;
      runSearch();
    });
    container.appendChild(btn);
  });
}

/**
 * Render related content HTML above the active-chips row (Feature 2).
 * Content comes from /api/v2/related-content (key: `content`).
 * The HTML string is passed through the whitelist sanitizer from format.js.
 *
 * @param {string} html
 */
function renderRelatedContent(html) {
  const container = document.getElementById("related-content");
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);
  if (!html || !html.trim()) {
    container.classList.add("d-none");
    return;
  }
  container.classList.remove("d-none");
  container.appendChild(sanitizeHtml(html));
}

/**
 * Fetch related queries and content concurrently for the given query string.
 * Aborts on the provided signal so superseded requests are discarded cleanly.
 *
 * @param {string} q - current search query
 * @param {AbortSignal} signal
 */
async function loadRelated(q, signal) {
  if (!q) {
    renderRelatedQueries([]);
    renderRelatedContent("");
    return;
  }
  try {
    const [qEnv, cEnv] = await Promise.all([
      api.get("/related-queries", { q }, { signal }),
      api.get("/related-content", { q }, { signal })
    ]);
    renderRelatedQueries(qEnv.queries || []);
    renderRelatedContent(cEnv.content || "");
  } catch (e) {
    if (e && e.name === "AbortError") return; // superseded — ignore
    // best-effort: hide both sections on error
    renderRelatedQueries([]);
    renderRelatedContent("");
  }
}

/**
 * Bulk-sync favorite state for all result cards in a single request (Feature 5).
 * Calls GET /api/v2/favorites?query_id=<queryId> and updates each card's button.
 * On 401/AUTH_REQUIRED (unauthenticated) the function exits silently.
 *
 * @param {string} queryId
 */
async function syncFavorites(queryId) {
  if (!queryId) return;
  try {
    const env = await api.get("/favorites", { query_id: queryId });
    const favoriteSet = new Set((env.data || []).map(item => String(item.doc_id || item)));
    const list = document.getElementById("results");
    if (!list) return;
    list.querySelectorAll("li[data-doc-id]").forEach(li => {
      const btn = li.querySelector(".favorite-btn");
      if (!btn) return;
      const docId = li.dataset.docId;
      if (!docId) return;
      setFavoriteUi(btn, favoriteSet.has(docId), Number(btn.dataset.count) || 0);
    });
  } catch (e) {
    if (e && (e.code === "auth_required" || e.code === "AUTH_REQUIRED" || e.httpStatus === 401)) return; // unauthenticated — silent
    // other errors: ignore, favorites are best-effort
  }
}

function renderPagination(env) {
  // Tag-parity with searchResults.jsp pagination:
  //   nav#subfooter.mx-auto > ul.pagination.justify-content-center
  //     > li.page-item[.disabled] > a.page-link > span[aria-hidden] + span.visually-hidden (prev)
  //     > li.page-item[.active] > a.page-link (numbers; far pages get d-none d-sm-inline-block)
  //     > li.page-item > a.page-link > span.visually-hidden + span[aria-hidden] (next)
  const nav = document.getElementById("subfooter");
  const ul = document.getElementById("pagination");
  if (!nav || !ul) return;
  ul.innerHTML = "";
  // C.6: use prev_page / next_page flags — handles estimated counts correctly
  if (!env.prev_page && !env.next_page) { nav.classList.add("d-none"); return; }
  nav.classList.remove("d-none");

  const makeLi = (cls) => el("li", { className: cls });
  const makeLink = () => el("a", { className: "page-link", attrs: { href: "#" } });

  // Navigate to a page and scroll back to the top so the new results start in view.
  const goToPage = (start) => {
    state.start = Math.max(0, start);
    syncUrlParams(true);
    runSearch();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Prev
  {
    const li = makeLi("page-item" + (env.prev_page ? "" : " disabled"));
    li.setAttribute("aria-label", t("pagination.prev"));
    const a = makeLink();
    const s1 = el("span", { attrs: { "aria-hidden": "true" } });
    s1.appendChild(document.createTextNode("«"));
    a.appendChild(s1);
    a.appendChild(document.createTextNode(" "));
    a.appendChild(el("span", { className: "visually-hidden", text: t("pagination.prev") }));
    a.addEventListener("click", ev => {
      ev.preventDefault();
      if (env.prev_page) goToPage(state.start - state.num);
    });
    li.appendChild(a);
    ul.appendChild(li);
  }

  // Page numbers
  (env.page_numbers || []).forEach(n => {
    // page_numbers come back as strings ("1") while page_number is a number (1),
    // so coerce before comparing — otherwise the current page never gets .active.
    const pageNum = Number(n);
    const isFar = Math.abs(pageNum - env.page_number) > 2;
    const li = makeLi("page-item" + (pageNum === env.page_number ? " active" : "") + (isFar ? " d-none d-sm-inline-block" : ""));
    const a = makeLink();
    a.textContent = String(pageNum);
    a.addEventListener("click", ev => { ev.preventDefault(); goToPage((pageNum - 1) * state.num); });
    li.appendChild(a);
    ul.appendChild(li);
  });

  // Next
  {
    const li = makeLi("page-item" + (env.next_page ? "" : " disabled"));
    li.setAttribute("aria-label", t("pagination.next"));
    const a = makeLink();
    a.appendChild(el("span", { className: "visually-hidden", text: t("pagination.next") }));
    a.appendChild(document.createTextNode(" "));
    const s2 = el("span", { attrs: { "aria-hidden": "true" } });
    s2.appendChild(document.createTextNode("»"));
    a.appendChild(s2);
    a.addEventListener("click", ev => {
      ev.preventDefault();
      if (env.next_page) goToPage(state.start + state.num);
    });
    li.appendChild(a);
    ul.appendChild(li);
  }
}


/**
 * The star's state. /api/v2 can only add a favorite (POST .../favorite; there is no way to remove
 * one), so a favorited star says it is a favorite and offers nothing: it is not a toggle that a
 * second click could undo.
 */
function setFavoriteUi(btn, on, count) {
  const label = on ? t("result.favorite_added") : t("result.favorite_add");
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.setAttribute("aria-label", label);
  btn.title = label;
  // aria-disabled, not disabled: a button that disables itself under the keyboard drops the focus.
  if (on) btn.setAttribute("aria-disabled", "true"); else btn.removeAttribute("aria-disabled");
  // The star is an inline SVG; styles.css fills it while aria-pressed is true.
  btn.dataset.count = String(count);
  // Show or hide the count badge next to the star icon
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

async function addFavorite(docId, btn, queryId) {
  if (btn.getAttribute("aria-pressed") === "true") return;
  try {
    // #3 (parity js/search.js:137): include query_id so the click is attributed to its query.
    const env = await api.post("/documents/" + encodeURIComponent(docId) + "/favorite", { query_id: queryId || "" });
    setFavoriteUi(btn, !!env.favorite, env.count || 0);
  } catch (e) {
    if (e.code === "auth_required" || e.code === "AUTH_REQUIRED" || e.httpStatus === 401) {
      if (!window.bootstrap || !bootstrap.Modal) {
        console.warn("[fess] bootstrap not loaded; skipping modal show");
      } else {
        bootstrap.Modal.getOrCreateInstance(document.getElementById("login-modal")).show();
      }
    }
  }
}

// Exported for later tasks (facets, pagination, etc.) to mutate state and re-run.
export const _state = state;
// renderPopularWords is exported inline at its declaration (line ~1515); do NOT
// re-export it here — a duplicate export is a module-level SyntaxError that aborts
// the entire SPA bootstrap (app.js never runs, so the home view never renders).
export { runSearch, el, buildResultCard, buildGoUrl, renderSearchOptions, syncSearchInputs, plainTitle, ensureOsddLink };
