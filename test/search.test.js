// SPDX-License-Identifier: Apache-2.0
// Behavioural tests for the theme-specific search.js fixes reapplied in this PR:
//
//   1. a11y copy button (PR #33): the URL-copy control is a real <button> carrying
//      the accessible name, not an <i> that set role="button" AND aria-hidden on the
//      same node (which removed it from the accessibility tree and from the keyboard).
//   2. plain-text title (PR #36): plainTitle() runs content_title through the snippet
//      parse path (entities decoded, non-highlight tags stripped) and leaves the raw
//      index fields (title/url) verbatim, so the accessible name matches the on-screen
//      title without decoding text the server never escaped.
//   3. facet recoverability (PR #34): a facet group the response carried no counts for
//      still renders its clickable rows instead of collapsing to an empty header (the
//      v2 payload omits facet_query under rank fusion); when counts ARE present a
//      zero-count row is still suppressed.
//
// search.js takes its configuration from module state (api.getConfig()), never from a
// function argument, so every case loads the theme's real search.js through
// helpers/loadSearch.js, which mocks the theme's api.js to inject the fixture config.
// See that helper for why a config-injection loader is required.

import { describe, it, expect } from "vitest";
import { loadSearch } from "./helpers/loadSearch.js";

/** A result document with the fields buildResultCard reads on the common path. */
function sampleDoc() {
  return {
    doc_id: "doc-1",
    url: "https://example.com/a",
    url_link: "https://example.com/a",
    content_title: "Example Title",
    content_description: "An example description.",
    digest: "An example description.",
    site: "example.com",
    site_path: "example.com/a",
    mimetype: "text/html",
    filetype: "html",
    last_modified: "2026-01-02T03:04:05",
    created: "2026-01-01T00:00:00",
    content_length: 2048,
  };
}

// ---------------------------------------------------------------------------
// (a) a11y copy button — the 8 themes whose buildResultCard renders a copy icon.
// ---------------------------------------------------------------------------
const A11Y_THEMES = [
  "docsearch", "docuforge", "helpdesk", "mosaic",
  "nomadkit", "rawblock", "semanticlens", "voicebox",
];

describe.each(A11Y_THEMES)("copy-URL control is a real accessible button [%s]", (theme) => {
  it("wraps a decorative glyph in a focusable <button> with the accessible name", async () => {
    const { buildResultCard } = await loadSearch(theme, {
      features: { clipboard_copy_icon: true },
    });
    const card = buildResultCard(sampleDoc(), "q1", 0); // (d, queryId, order)

    const btn = card.querySelector("button.url-copy-btn");
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("type")).toBe("button");
    // The button is IN the accessibility tree (the pre-fix <i> set aria-hidden here).
    expect(btn.getAttribute("aria-hidden")).toBeNull();
    // ...and carries both an accessible name and the copy payload.
    expect(btn.getAttribute("aria-label")).toMatch(/./);
    expect(btn.getAttribute("data-clipboard-text")).toBeTruthy();
    expect(btn.classList.contains("d-print-none")).toBe(true);

    // The glyph inside is purely decorative: hidden from AT, no interactive role.
    const glyph = btn.querySelector("i.fa-copy");
    expect(glyph).toBeTruthy();
    expect(glyph.getAttribute("aria-hidden")).toBe("true");
    expect(glyph.getAttribute("role")).toBeNull();

    // Regression guard: the old markup put role="button" on the aria-hidden <i>.
    // No aria-hidden node in the card may still claim an interactive role.
    expect(card.querySelector('[aria-hidden="true"][role="button"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (b) plain-text title — the 7 themes that define plainTitle().
// (helpdesk has a copy button but no plainTitle; storefront/codesearch have neither.)
// ---------------------------------------------------------------------------
const PLAINTITLE_THEMES = [
  "docsearch", "docuforge", "mosaic", "nomadkit",
  "rawblock", "semanticlens", "voicebox",
];

describe.each(PLAINTITLE_THEMES)("plainTitle [%s]", (theme) => {
  it("parses content_title (decode entities, strip tags) but leaves raw fields verbatim", async () => {
    const { plainTitle } = await loadSearch(theme, {});

    // content_title is server-escaped HTML with highlight tags spliced in — run it
    // through the same parse path the visible <h3> title uses.
    expect(plainTitle({ content_title: "AT&T" })).toBe("AT&T"); // no entity: unchanged
    // FIX-distinguishing: a real entity must be decoded. The pre-fix regex-strip left
    // "a &amp; b" untouched; the snippet parse path decodes it to "a & b".
    expect(plainTitle({ content_title: "a &amp; b" })).toBe("a & b");
    // Highlight markup is reduced to its text.
    expect(plainTitle({ content_title: "x <strong>y</strong> z" })).toBe("x y z");

    // title/url are raw index fields the server never escapes — parsing them would
    // decode entities it never wrote and strip literal angle brackets, so leave them.
    expect(plainTitle({ title: "a<b>c" })).toBe("a<b>c");
    expect(plainTitle({ title: "AT&amp;T" })).toBe("AT&amp;T");
  });
});

// ---------------------------------------------------------------------------
// (c) facet recoverability + zero-count suppression — the 9 themes with a facet fn.
//
// The facet renderer differs in name AND contract per theme:
//   queryViews          renderFacetQueryViews(body, env)  docsearch/docuforge/helpdesk/
//                        groups from cfg.facet_views, counts from env.facet_query;
//                        rows are <a> inside ul.list-group.        nomadkit/rawblock/voicebox
//   filterGroupsCounted renderFilterGroups(body, env)  [storefront]
//                        groups from cfg.filetype_options + cfg.facet_views, counts from
//                        env.facet_query; rows are .filter-opt inside .filter-group.
//   filterGroupsCountFree renderFilterGroups(body)  [mosaic, semanticlens]
//                        count-free BY DESIGN (config only, no env); only the timestamp /
//                        contentLength facet_views groups are drawn. There is no count to
//                        suppress, so these two are the recoverability guard only.
// ---------------------------------------------------------------------------
const FACET = {
  docsearch:    { fn: "renderFacetQueryViews", kind: "queryViews" },
  docuforge:    { fn: "renderFacetQueryViews", kind: "queryViews" },
  helpdesk:     { fn: "renderFacetQueryViews", kind: "queryViews" },
  nomadkit:     { fn: "renderFacetQueryViews", kind: "queryViews" },
  rawblock:     { fn: "renderFacetQueryViews", kind: "queryViews" },
  voicebox:     { fn: "renderFacetQueryViews", kind: "queryViews" },
  storefront:   { fn: "renderFilterGroups", kind: "filterGroupsCounted" },
  mosaic:       { fn: "renderFilterGroups", kind: "filterGroupsCountFree" },
  semanticlens: { fn: "renderFilterGroups", kind: "filterGroupsCountFree" },
};

// A two-value group + the row selector for each contract's DOM.
function facetFixture(kind, { counts }) {
  const queries = [
    { value: "sz:s", label_key: "Small" },
    { value: "sz:l", label_key: "Large" },
  ];
  // env.facet_query: absent (recoverability) or a real count map (suppression: l=0).
  const env = counts
    ? { facet_query: [{ value: "sz:s", count: 3 }, { value: "sz:l", count: 0 }] }
    : { facet_query: [] };

  if (kind === "queryViews") {
    // group_name NOT "labels."-prefixed → title is literal, no i18n needed.
    return { config: { facet_views: [{ group_name: "SizeGroup", queries }] }, env,
      rowSelector: "ul.list-group li.list-group-item a" };
  }
  if (kind === "filterGroupsCounted") {
    // storefront skips only the "labels.facet_filetype_title" group; anything else renders.
    return { config: { facet_views: [{ group_name: "SizeGroup", queries }] }, env,
      rowSelector: ".filter-group .filter-opt" };
  }
  // filterGroupsCountFree: mosaic/semanticlens only draw the timestamp/contentLength groups.
  return { config: { facet_views: [{ group_name: "labels.facet_contentLength_title", queries }] }, env,
    rowSelector: ".filter-group .filter-opt" };
}

describe.each(Object.keys(FACET))("facet recoverability [%s]", (theme) => {
  it("keeps a group's rows when the response carried no counts for it", async () => {
    const { fn, kind } = FACET[theme];
    const { config, env, rowSelector } = facetFixture(kind, { counts: false });
    const mod = await loadSearch(theme, config);
    const render = mod[fn];
    expect(typeof render).toBe("function");

    const body = document.createElement("div");
    render(body, env); // count-free renderers ignore the second arg

    // Both option rows survive — the group is NOT reduced to a bare header.
    expect(body.querySelectorAll(rowSelector).length).toBe(2);
    expect(body.textContent).toContain("Small");
    expect(body.textContent).toContain("Large");
  });
});

// Zero-count suppression applies only to the renderers that consume counts.
const SUPPRESS_THEMES = Object.keys(FACET).filter(
  (t) => FACET[t].kind !== "filterGroupsCountFree"
);

describe.each(SUPPRESS_THEMES)("facet zero-count suppression [%s]", (theme) => {
  it("hides a zero-count row when the response DID carry counts", async () => {
    const { fn, kind } = FACET[theme];
    const { config, env, rowSelector } = facetFixture(kind, { counts: true });
    const mod = await loadSearch(theme, config);
    const render = mod[fn];

    const body = document.createElement("div");
    render(body, env);

    // sz:l has count 0 and is not active → suppressed; sz:s (count 3) survives.
    expect(body.querySelectorAll(rowSelector).length).toBe(1);
    expect(body.textContent).toContain("Small");
    expect(body.textContent).not.toContain("Large");
  });
});
