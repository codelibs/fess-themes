// SPDX-License-Identifier: Apache-2.0
// Column headers <-> the `sort` request parameter.
//
// The details view sorts by clicking a column header; the other views use the toolbar
// control. Both end up as one `sort=<field>.<asc|desc>` value in the address bar. Name,
// Modified and Size sort on fields Fess allows by default. Type (`filetype`) and Location
// (`url`) are keyword fields the server only sorts on when query.additional.sort.fields
// lists them, and it answers 400 otherwise: sortFallback() decides what to do then, so
// the page never ends up blank. Pure module: no DOM, no network.

/** Column -> index field. */
export const SORT_FIELDS = {
  name: "filename",
  modified: "last_modified",
  size: "content_length",
  type: "filetype",
  location: "url",
  relevance: "score",
};

const COLUMN_BY_FIELD = Object.fromEntries(Object.entries(SORT_FIELDS).map(([column, field]) => [field, column]));

/** The direction a column starts in: newest and largest first, everything else A to Z. */
const FIRST_DIR = { name: "asc", location: "asc", type: "asc", modified: "desc", size: "desc" };

/** Columns whose sort field is only sortable once the server setting lists it. */
const NEEDS_SETTING = new Set(["type", "location"]);

/** `field.dir` for a column; "" for relevance (the server default) and unknown columns. */
export function sortParam(column, dir) {
  if (column === "relevance" || !SORT_FIELDS[column]) return "";
  return SORT_FIELDS[column] + "." + (dir === "desc" ? "desc" : "asc");
}

/** The field and direction of a sort parameter (first key only), or null. */
function splitSort(sort) {
  if (typeof sort !== "string" || sort === "") return null;
  const m = /^([a-z_]+)\.(asc|desc)$/.exec(sort.split(",")[0]);
  return m ? { field: m[1], dir: m[2] } : null;
}

/** The column and direction of a sort parameter (first key only), or null. */
export function parseSort(sort) {
  const s = splitSort(sort);
  return s && COLUMN_BY_FIELD[s.field] ? { column: COLUMN_BY_FIELD[s.field], dir: s.dir } : null;
}

/** The sort to send: what the user chose, else relevance for a keyword and name for browsing. */
export function effectiveSort(sort, hasKeyword) {
  if (sort) return sort;
  return hasKeyword ? "" : sortParam("name", "asc");
}

/**
 * Which column is in effect, in which direction, and whether that is only the default.
 * A sort on a field no column sorts by (the options drawer offers created, click_count and
 * favorite_count) puts no column in effect: `column` is "".
 */
export function describeSort(sort, hasKeyword) {
  const parsed = parseSort(sort);
  if (parsed) return { ...parsed, isDefault: false };
  const other = splitSort(sort);
  if (other) return { column: "", dir: other.dir, isDefault: false };
  return hasKeyword
    ? { column: "relevance", dir: "desc", isDefault: true }
    : { column: "name", dir: "asc", isDefault: true };
}

/** The sort a click on `column`'s header leads to. */
export function nextSort(sort, column, hasKeyword) {
  if (column === "relevance") return "";
  const current = describeSort(sort, hasKeyword);
  if (current.column === column) return sortParam(column, current.dir === "asc" ? "desc" : "asc");
  return sortParam(column, FIRST_DIR[column] || "asc");
}

/** The sort for choosing a column from a menu: its first direction ("" for relevance). */
export function firstSort(column) {
  return column === "relevance" ? "" : sortParam(column, FIRST_DIR[column] || "asc");
}

export function needsServerSetting(column) {
  return NEEDS_SETTING.has(column);
}

/**
 * What to do when /search failed. A 400 while an explicit sort was in effect is most
 * likely that sort being refused, so drop it; the caller retries once and shows a notice.
 *
 * @returns {null | {sort: "", column: string|null}} null when the failure is not about a sort
 */
export function sortFallback({ httpStatus, code, sort } = {}) {
  const bad = httpStatus === 400 || code === "invalid_request" || code === "INVALID_REQUEST";
  if (!bad || typeof sort !== "string" || sort === "") return null;
  const parsed = parseSort(sort);
  return { sort: "", column: parsed ? parsed.column : null };
}

// Columns the server has refused during this page's life: their headers stop offering a sort.
const unsupported = new Set();

export function markUnsupported(column) {
  if (column) unsupported.add(column);
}

export function isSortSupported(column) {
  return !unsupported.has(column);
}

export function resetUnsupported() {
  unsupported.clear();
}
