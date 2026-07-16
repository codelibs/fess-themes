// SPDX-License-Identifier: Apache-2.0
// Pure, DOM-free helpers for the storefront's product fields: rendering them on
// the card, and sorting by them.
// Kept out of search.js so they can be unit tested under plain Node, and so
// every view resolves the theme's sort options from one place.

/**
 * Format a product price. Returns "" when there is no usable numeric price.
 *
 * A string here is not a formatting problem to paper over — it means the
 * deployment is misconfigured (the index must map price as double AND
 * query.additional.api.response.fields must list it). Rendering it raw would
 * hide that, so we render nothing.
 */
export function formatPrice(hit, locale) {
  if (!hit || typeof hit.price !== "number" || !Number.isFinite(hit.price) || hit.price < 0) return "";
  return "¥" + hit.price.toLocaleString(locale || "ja", { maximumFractionDigits: 0 });
}

/**
 * Star breakdown rounded to the nearest half, clamped to 0..5.
 * Five slots total: a half star occupies one, so full + (half?1:0) + empty === 5.
 * Returns null when there is no rating (or the rating is negative — invalid
 * data, not a real zero), so the card can omit the row entirely rather than
 * render five empty stars and imply a zero score. A rating of exactly 0 is a
 * real, legitimate score and must still render five empty stars — only a
 * negative value is treated as absent.
 */
export function ratingStars(hit) {
  if (!hit || typeof hit.rating !== "number" || !Number.isFinite(hit.rating) || hit.rating < 0) return null;
  const clamped = Math.min(5, Math.max(0, hit.rating));
  const halves = Math.round(clamped * 2);
  const full = Math.floor(halves / 2);
  const half = halves % 2 === 1;
  return { full, half, empty: 5 - full - (half ? 1 : 0) };
}

// Null-prototype: `availability` is crawled third-party data (an itemprop on
// someone else's page), so a plain object literal would resolve "__proto__",
// "constructor", "toString", ... to Object.prototype members and hand them back
// as if they were statuses. With no prototype there is nothing to inherit.
const AVAILABILITY = Object.assign(Object.create(null), { InStock: "in_stock", OutOfStock: "out_of_stock" });

/**
 * Map a schema.org availability tail to a message-key suffix; the caller does
 * t("product." + result). null when absent or unrecognised — the card then
 * omits the badge rather than inventing a status for a value we do not model.
 */
export function availabilityLabel(hit) {
  if (!hit || typeof hit.availability !== "string") return null;
  return AVAILABILITY[hit.availability] || null;
}

/** A tile shows an image only if the doc has one and the feature is on. */
export function hasImage(hit, features) {
  return !!(hit && hit.thumbnail && features && features.thumbnail_enabled);
}

/**
 * Bar width as a percentage of the largest count in the group.
 *
 * Deliberately "count bars", not a histogram. Fess's shipped timestamp facet is
 * CUMULATIVE and overlapping ([now/d-1d TO *], [now/d-7d TO *], ...), and a
 * theme cannot tell disjoint bands from cumulative ones by parsing the query
 * string. A bar proportional to a count is truthful either way; for a disjoint
 * band set — which is what a price facet is — it happens to also be a
 * distribution. So every group gets bars and nothing is inferred.
 *
 * A nonzero count always draws a visible bar, floored at 1%: on a skewed
 * catalogue (1 luxury item against 400 cheap ones) the honest ratio rounds to
 * 0, and a 0%-wide bar beside the numeral "1" is indistinguishable from an
 * empty band. Only a real zero draws nothing.
 */
export function barWidths(counts) {
  const max = Math.max(0, ...counts.map(c => Number(c) || 0));
  if (max <= 0) return counts.map(() => 0);
  return counts.map(c => {
    const n = Number(c) || 0;
    return n > 0 ? Math.max(1, Math.round((n / max) * 100)) : 0;
  });
}

/**
 * Sort options for the product fields this theme is built around.
 *
 * The server cannot offer these: UiConfigHandler.buildSortOptions() is a
 * hardcoded list (score / filename / created / content_length / last_modified /
 * click_count / favorite_count) with no config key to extend it. But the search
 * API *does* accept sort=price.asc once price is listed in
 * query.additional.sort.fields — which this theme requires anyway, because the
 * product card cannot render without the field. So the theme knows its own
 * fields and contributes the options the server has no way to advertise.
 *
 * Written in the server's { value, label_key } shape so a consumer can treat
 * these and the server's own options identically.
 */
export const PRODUCT_SORT_OPTIONS = [
  { value: "price.asc", label_key: "product.sort_price_asc" },
  { value: "price.desc", label_key: "product.sort_price_desc" },
  { value: "rating.desc", label_key: "product.sort_rating_desc" },
];

/**
 * Every sort option a storefront view may offer or label: the theme's product
 * sorts followed by the server's own, in the server's { value, label_key } shape.
 *
 * This is THE list to resolve a sort value against. A view that reads
 * cfg.sort_options directly never sees a price/rating entry, and each such view
 * broke differently: a select omitted them, a label lookup fell through to
 * printing the raw "price.asc", and an <option> match test dropped an incoming
 * sort=price.asc on submit. One list means the next view cannot pick a fourth way.
 *
 * The product sorts lead because price is the axis a shopper sorts on. On a
 * deployment missing the required config the server rejects the sort rather than
 * returning something wrong — see this theme's README.
 *
 * The server's own list heads with a value="" entry labelled "Score". It is
 * dropped here because callers prepend their own placeholder, and keeping both
 * would show a duplicate empty option + "Score"/"スコア順" pair (JSP parity:
 * searchOptions.jsp, advance.jsp:159-162).
 *
 * @param {object} [cfg]      - api config; cfg.sort_options is used when non-empty
 * @param {Array}  [fallback] - options to use when the server supplies none. The
 *                              caller owns this because the views disagree: the
 *                              results select falls back to score alone, advance
 *                              search to a feature-gated list.
 * @returns {Array<{value: string, label_key?: string}>}
 */
export function sortOptionsFor(cfg, fallback) {
  const server = cfg && Array.isArray(cfg.sort_options) ? cfg.sort_options : [];
  const list = server.length > 0 ? server : (Array.isArray(fallback) ? fallback : []);
  const body = (list.length > 0 && (list[0].value == null || list[0].value === ""))
    ? list.slice(1)
    : list;
  return [...PRODUCT_SORT_OPTIONS, ...body];
}
