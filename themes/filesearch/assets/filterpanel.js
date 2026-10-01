// SPDX-License-Identifier: Apache-2.0
// The filter panel under the toolbar: file type (from the filetype facet), modified date
// and size (from facet queries), and label when the server has labels. Every choice is a
// toggle button carrying aria-pressed; choosing writes the filter into the search state
// through the callbacks and the caller re-runs the search, so the address bar stays the
// single source of truth (see filters.js).
//
// A count of 0 and a missing count mean opposite things; visibleRows() (filters.js) holds
// the rule, and a facet the server did not answer at all is simply not drawn.

import { t } from "./i18n.js";
import { el, clear } from "./dom.js";
import { fileIcon, fileKind, uiIcon } from "./icons.js";
import { DATE_PRESETS, SIZE_PRESETS, visibleRows } from "./filters.js";

const MAX_TYPES = 12;

const TYPE_NAMES = {
  word: "Word", excel: "Excel", powerpoint: "PowerPoint", html: "HTML", pdf: "PDF", txt: "Text",
  odt: "ODT", ods: "ODS", odp: "ODP",
};

/** The name shown for a filetype value. */
export function typeName(value) {
  if (value === "others") return t("fs.type_others");
  return TYPE_NAMES[value] || String(value).toUpperCase();
}

function facetResult(env, name) {
  const entry = ((env && env.facet_field) || []).find(f => f && f.name === name);
  return entry ? (entry.result || []) : null;
}

function chip({ label, count, active, icon, onClick, approxTitle }) {
  const btn = el("button", { className: "fs-fchip" + (active ? " is-active" : ""), attrs: { type: "button", "aria-pressed": active ? "true" : "false" } });
  if (icon) btn.appendChild(icon);
  btn.appendChild(el("span", { className: "fs-fchip-label", text: label }));
  if (count != null) {
    const c = el("span", { className: "fs-fchip-count", text: Number(count).toLocaleString() });
    if (approxTitle) c.title = approxTitle;
    btn.appendChild(c);
  }
  btn.addEventListener("click", onClick);
  return btn;
}

function group(title) {
  const fs = el("fieldset", { className: "fs-fgroup" });
  fs.appendChild(el("legend", { text: title }));
  const body = el("div", { className: "fs-fgroup-body" });
  fs.appendChild(body);
  return { fs, body };
}

/**
 * Draw the panel.
 *
 * `typeFacet` is the filetype facet counted without the file-type choice itself (Fess has no
 * post-filter, so under the choice the other types would otherwise count zero and vanish,
 * leaving no way to add a second one); it falls back to the response's own facet.
 *
 * @param {HTMLElement} host
 * @param {{env:object, typeFacet?:object, state:{facets:object,facetQueries:string[]}, cfg:object,
 *          labels:{value:string,label:string}[],
 *          onType:(value:string)=>void, onPreset:(clause:string)=>void, onLabel:(value:string)=>void}} o
 * @returns {number} how many filters are active
 */
export function renderFilterPanel(host, { env, typeFacet, state, cfg, labels, onType, onPreset, onLabel }) {
  clear(host);
  const types = state.facets.filetype || [];
  const active = new Set(state.facetQueries || []);
  const counts = new Map(((env && env.facet_query) || []).map(f => [f.value, Number(f.count)]));
  let shown = 0;

  // File type
  const result = facetResult(typeFacet || env, "filetype");
  const rows = (result || []).filter(r => Number(r.count) > 0).slice(0, MAX_TYPES).map(r => ({ value: r.value, count: Number(r.count) }));
  for (const sel of types) if (!rows.some(r => r.value === sel)) rows.push({ value: sel, count: null });
  if (rows.length > 0) {
    const g = group(t("fs.filter_type"));
    rows.forEach(r => g.body.appendChild(chip({
      label: typeName(r.value), count: r.count, active: types.includes(r.value),
      icon: fileIcon(fileKind({ filetype: r.value })), onClick: () => onType(r.value),
    })));
    host.appendChild(g.fs);
    shown++;
  }

  // Modified date, then size
  for (const [title, presets] of [[t("fs.filter_modified"), DATE_PRESETS], [t("fs.filter_size"), SIZE_PRESETS]]) {
    const visible = visibleRows(presets, counts, active);
    if (visible.length === 0) continue;
    const g = group(title);
    visible.forEach(r => g.body.appendChild(chip({
      label: t(r.labelKey), count: r.count, active: r.active, onClick: () => onPreset(r.clause),
    })));
    host.appendChild(g.fs);
    shown++;
  }

  // Label
  const labelResult = facetResult(env, "label");
  const wantLabels = !!(cfg.features && cfg.features.display_label_type);
  if (wantLabels) {
    const known = new Map((labels || []).map(l => [l.value, l.label]));
    const selected = state.facets.label || [];
    const lrows = (labelResult || []).filter(r => Number(r.count) > 0 && known.has(r.value))
      .map(r => ({ value: r.value, name: known.get(r.value) || r.value, count: Number(r.count) }));
    for (const sel of selected) if (!lrows.some(r => r.value === sel)) lrows.push({ value: sel, name: known.get(sel) || sel, count: null });
    if (lrows.length > 0) {
      const g = group(t("fs.filter_label"));
      lrows.forEach(r => g.body.appendChild(chip({ label: r.name, count: r.count, active: selected.includes(r.value), onClick: () => onLabel(r.value) })));
      host.appendChild(g.fs);
      shown++;
    }
  }

  if (shown === 0) host.appendChild(el("p", { className: "fs-filters-none", text: t("fs.filter_none") }));
  return types.length + (state.facetQueries || []).length + (state.facets.label || []).length;
}

/** Active-filter chips above the list; each carries its own remove callback. */
export function renderChips(host, chips, { onClearAll } = {}) {
  clear(host);
  if (chips.length === 0) { host.classList.add("d-none"); return; }
  host.classList.remove("d-none");
  host.appendChild(el("span", { className: "active-chips-label", text: t("facet.active_filters") + ":" }));
  chips.forEach(c => {
    const badge = el("span", { className: "active-chip" });
    badge.appendChild(el("span", { text: c.label }));
    const btn = el("button", { className: "active-chip-remove", attrs: { type: "button", "aria-label": t("facet.remove") + " " + c.label, title: t("facet.remove") + " " + c.label } });
    btn.appendChild(uiIcon("close"));
    btn.addEventListener("click", c.remove);
    badge.appendChild(btn);
    host.appendChild(badge);
  });
  if (onClearAll && chips.length > 1) {
    const all = el("button", { className: "btn btn-link btn-sm", text: t("fs.filter_clear"), attrs: { type: "button" } });
    all.addEventListener("click", onClearAll);
    host.appendChild(all);
  }
}
