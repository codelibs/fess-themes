// SPDX-License-Identifier: Apache-2.0
// Pure, DOM-free helpers for the storefront product card.
// Kept out of search.js so they can be unit tested under plain Node.

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

const AVAILABILITY = { InStock: "in_stock", OutOfStock: "out_of_stock" };

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
 */
export function barWidths(counts) {
  const max = Math.max(0, ...counts.map(c => Number(c) || 0));
  if (max <= 0) return counts.map(() => 0);
  return counts.map(c => Math.round(((Number(c) || 0) / max) * 100));
}
