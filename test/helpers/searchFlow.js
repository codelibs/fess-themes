// SPDX-License-Identifier: Apache-2.0
// Shared fixtures for the runSearch()-driven behavioural tests (search-flows.test.js).
//
// Every fess-themes theme ships its own ~2k-line copy of search.js, all derived from
// the bootstrap theme. runSearch() reads its config from api.getConfig(), issues
// api.get("/search", …) plus a handful of auxiliary endpoints (labels, related,
// popular words, favorites), then renders into a fixed set of container ids. These
// fixtures build a SUPERSET DOM scaffold (every id any of the ten themes reaches for)
// and a per-endpoint api.get dispatcher so a single describe.each can drive the whole
// render pipeline across the themes that share it.
//
// Not a *.test.js file, so Vitest does not collect it as a suite.

/**
 * Superset DOM scaffold: the union of every element id the ten themes' runSearch /
 * renderResults / renderFacets / renderPagination / renderOptionsBar reach for. The
 * render code reads each optionally (`const x = getElementById(id); if (x) …`), so a
 * theme that never touches a given id simply ignores it — extra ids are harmless,
 * missing ones are the only risk, hence the union.
 *
 * #empty-state carries BOTH the DNONE-theme slot (<span id="empty-did-not-match">)
 * and the codesearch slot ([data-did-not-match]); it starts with class="d-none"
 * (DNONE themes toggle that) but no `hidden` attribute (codesearch toggles that),
 * so the two visibility regimes stay independent.
 */
export const SEARCH_FIXTURE = `
  <form id="search-form">
    <input id="query"><button id="searchButton" type="button"></button>
  </form>
  <form id="search-bar"><input id="query-input"></form>
  <input id="contentQuery">
  <ul id="suggest-dropdown" class="d-none"></ul>
  <div id="home-view"></div>
  <input id="queryId"><input id="rt">
  <input id="geo-lat"><input id="geo-lon"><input id="geo-distance">
  <button id="searchOptionsClearButton"></button>
  <div id="popular-words" class="d-none"></div>
  <div id="search-loading" class="d-none"></div>
  <div id="search-error" class="d-none"></div>
  <div id="results-warning" class="d-none"></div>
  <div id="results-status"></div>
  <div id="result-summary"></div>
  <div id="search-composition" class="d-none"></div>
  <div id="best-bet-body"></div>
  <div id="similar-doc-banner" class="d-none"></div>
  <ul id="results"></ul>
  <div id="results-meta"></div>
  <div id="empty-state" class="d-none"><span id="empty-did-not-match" data-did-not-match></span></div>
  <div id="results-popular-words" class="d-none"></div>
  <nav id="subfooter" class="d-none"><ul id="pagination"></ul></nav>
  <div id="facet-rail"></div>
  <div id="facet-body" class="d-none"></div>
  <div id="facet-body-mobile"></div>
  <div id="facet-toggle-wrap"></div>
  <a id="facet-clear" class="d-none"></a>
  <div id="active-chips" class="d-none"></div>
  <ul id="current-filters"></ul>
  <ul id="options-bar"></ul>
  <div id="view-toggle"></div>
  <div id="lightbox"></div>
  <div id="login-modal"></div>
  <div id="related-queries" class="d-none"></div>
  <div id="related-content" class="d-none"></div>
  <select id="sortSearchOption"></select>
  <select id="numSearchOption"></select>
  <select id="langSearchOption"></select>
  <fieldset id="labelSearchOptionFieldset"><select id="labelSearchOption"></select></fieldset>
`;

/** A representative api config the option renderers + facets consume. */
export const FULL_CFG = {
  features: { popular_word: true, display_label_type: true },
  sort_options: [
    { value: "", label_key: "labels.search_result_sort_score_desc" },
    { value: "last_modified.desc", label_key: "labels.search_result_sort_last_modified_desc" },
  ],
  num_options: [10, 20, 50],
  lang_options: [{ value: "ja" }, { value: "en" }],
  label_options: [{ value: "lblA", label: "Label A" }, { value: "lblB", label: "Label B" }],
  facet_views: [
    {
      group_name: "labels.facet_filetype_title",
      queries: [
        { value: "filetype:html", label_key: "labels.facet_filetype_html" },
        { value: "filetype:pdf", label_key: "labels.facet_filetype_pdf" },
      ],
    },
  ],
};

/** Two result documents carrying the fields the various card builders read. */
export const SAMPLE_DOCS = [
  {
    doc_id: "d1", title: "Doc One", content_title: "Doc One",
    url: "https://ex.com/1", url_link: "https://ex.com/1",
    site: "ex.com", site_path: "ex.com/1", mimetype: "text/html", filetype: "html",
    last_modified: "2023-01-02T00:00:00Z", created: "2023-01-01T00:00:00Z",
    content_length: 1234, content_description: "first digest", digest: "first digest",
    has_cache: "true",
  },
  {
    doc_id: "d2", title: "Doc Two", content_title: "Doc <strong>Two</strong>",
    url: "https://ex.com/2", url_link: "https://ex.com/2",
    site: "ex.com", site_path: "ex.com/2", mimetype: "application/pdf", filetype: "pdf",
    last_modified: "2023-02-02T00:00:00Z", created: "2023-02-01T00:00:00Z",
    content_length: 5678, content_description: "second digest", digest: "second digest",
  },
];

/** Build a realistic /search envelope. `docs` become result cards. */
export function makeSearchEnv(docs, extra = {}) {
  return {
    query_id: "qid-1",
    requested_time: 1700000000000,
    highlight_params: "&hl.q=foo",
    partial: false,
    record_count: docs.length ? 42 : 0,
    record_count_relation: "EQUAL_TO",
    start_record_number: docs.length ? 1 : 0,
    end_record_number: docs.length,
    exec_time: 0.05,
    query_time: 50,
    page_number: 1,
    page_numbers: docs.length ? ["1", "2", "3", "4", "5"] : [],
    prev_page: false,
    next_page: docs.length > 0,
    all_record_count: docs.length ? 42 : 0,
    // helpdesk reads related queries/content straight off the search envelope
    // instead of the standalone /related-* endpoints the other themes call.
    related_query: ["rq1", "rq2"],
    related_contents: "<p>related</p>",
    data: docs,
    facet_field: [
      {
        name: "label",
        result: [
          { value: "lblA", count: 5 },
          { value: "lblB", count: 3 },
          { value: "lblZ", count: 0 },
        ],
      },
    ],
    facet_query: [
      { value: "filetype:html", count: 7 },
      { value: "filetype:pdf", count: 0 },
    ],
    ...extra,
  };
}

/**
 * Install an api.get implementation that dispatches per endpoint. Pass a
 * `get` mock (from loadSearchFlow) and optional overrides to replace the /search
 * envelope or the auxiliary payloads.
 *
 * @param {Function} get - the api.get vi.fn from loadSearchFlow
 * @param {object} [overrides]
 */
export function installDispatch(get, overrides = {}) {
  const searchEnv = "search" in overrides ? overrides.search : makeSearchEnv(SAMPLE_DOCS);
  get.mockImplementation(async (path) => {
    if (path === "/search") return searchEnv;
    if (path === "/labels")
      return { labels: overrides.labels || [{ value: "lblA", label: "Label A" }, { value: "lblB", label: "Label B" }] };
    if (path === "/popular-words")
      return { popular_words: overrides.popularWords || ["alpha", "beta", "gamma", "delta"] };
    if (path === "/related-queries") return { queries: overrides.relatedQueries || ["rq1", "rq2"] };
    if (path === "/related-content") return { content: "content" in overrides ? overrides.content : "<p>related</p>" };
    if (path === "/favorites") return { data: overrides.favorites || [] };
    if (path === "/suggest-words") return { suggest_words: overrides.suggestWords || [{ text: "sug1" }] };
    return {};
  });
}

/** Yield a macrotask so fire-and-forget helpers (popular words, related) settle. */
export const settle = () => new Promise((r) => setTimeout(r));

/** How many "/search" api.get calls the given mock has recorded. */
export const searchCalls = (get) => get.mock.calls.filter((c) => c[0] === "/search").length;
