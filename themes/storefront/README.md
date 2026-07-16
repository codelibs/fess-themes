# Storefront — Fess Static Theme (EC / Product Search)

Storefront is a **self-contained** Fess static theme for **product search**: each result is
a card with a photo, price, rating and stock — and deliberately **no text snippet**. Facet
counts are drawn as proportional bars, so a price band shows how many products fall in it at
a glance.

It is derived from the `mosaic` theme, whose thumbnail grid, lazy-loading and no-image
fallback are what a product grid needs. Mosaic's multimodal parts — searcher badges,
composition band, lightbox and the list view — are not present here.

## Installation

```bash
cd repos/fess-themes
./scripts/package.sh storefront
# Produces dist/storefront-<version>.zip
```

Upload the ZIP via **Admin > Theme** (`/admin/theme/`) in the Fess admin console, or set

```properties
theme.default=storefront
```

in `fess_config.properties` (or as a Java system property) and restart Fess.

## What it is

- **Product cards** — results render as tiles carrying photo, name, price, star rating,
  stock badge and brand. There is no `content_description` snippet: a shopper scanning a
  grid reads the price and the picture, and a prose fragment of the product page is noise.
  Every other theme in this repository renders a document; a product is not one.
- **Count bars** — each facet-query group (a price band group, Updated, Size, anything the
  server defines) is drawn as bars proportional to its real counts, with the count beside
  it, instead of a bare numeric badge.
- **Price-aware sorting** — sort by price or rating, driven by the server's `sort_options`.
- **Grid only** — there is no grid/list toggle. Grid *is* the thesis.

## Requirements / Configuration

These are **required**, not suggestions. The theme cannot detect a missing one, and does not
pretend to.

### The index mapping must be supplied externally

Fess has no `*_i` / `*_d` dynamic-suffix convention — a numeric price does not become a
number by naming it. Supply a mapping that types the fields (`price` as `double`, `rating`
as `float`, `availability` / `brand` / `category` as `keyword`) by mounting an
`fess_indices/_<type>/fess/doc.json` and setting `search_engine.type=<type>`.

There is no workaround via `.keyword`: **`sort=price.keyword` is impossible**, because the
sort value is split on `.` and the second token is read as the order. The field has to be
sortable at the top level, which means the mapping is mandatory rather than tidy.

### `fess_config.properties`

```properties
query.additional.response.fields=price,rating,availability,brand,category
query.additional.api.response.fields=price,rating,availability,brand,category
query.additional.search.fields=price,rating,availability,brand,category
query.additional.facet.fields=availability,brand,category
query.additional.sort.fields=price,rating
query.additional.not.analyzed.fields=availability,brand,category
query.facet.fields=label,brand,category,availability
```

Each list fails differently, and one of them fails **silently**:

- `api.response.fields` — without it the card has nothing to draw.
- **`search.fields` — omit `price` and `price:[0 TO 999]` does not error.** The field name is
  dropped and the bare range text is match-phrased against the default fields, returning
  wrong results. Nothing in the response distinguishes that from a correct range facet that
  legitimately matched nothing.
- `facet.fields` — else `SearchQueryException("Invalid facet field")`.
- `sort.fields` — else `InvalidQueryException`.
- `not.analyzed.fields` — keyword fields only; numeric fields must not be listed.

### Price bands

The bands are configuration, not code — the theme renders whatever the server sends, so a
¥100 shop and a car dealer differ only by this block:

```properties
query.facet.queries=\
Price:\
¥0〜999=price:[0 TO 999]\t\
¥1,000〜2,999=price:[1000 TO 2999]\t\
¥3,000〜5,999=price:[3000 TO 5999]\t\
¥6,000〜9,999=price:[6000 TO 9999]\t\
¥10,000〜=price:[10000 TO *]\n
```

A label that does not start with `labels.` is rendered verbatim, so changing the bands needs
no i18n plumbing. **The value is read once at boot — changing it requires a restart.**

### Thumbnails

**`thumbnail.enabled=true` is a SYSTEM property (`system.properties`), default `false`** —
not a `fess_config` key. Without it no product image ever renders and every card falls back
to an icon. `thumbnail.crawler.enabled` is already `true` in stock Fess, so setting it
changes nothing.

Fess takes the image from `<meta property="og:image">`, then the first `<img>` clearing the
generator's minimum size (100×100) and aspect ratio (≤ 3.0).

### Extracting the attributes from crawled HTML

Use a Web crawl config's **config parameters**. `field.xpath.*` pulls the raw string and
`field.script.*` post-processes it; the script's return value is stored **un-stringified**,
so a Groovy script returning a number puts a real number in the document:

```
field.xpath.price=//*[@itemprop='price']
field.script.price=value == null ? null : Double.parseDouble(value.replaceAll('[^0-9.]',''))
field.xpath.availability=//*[@itemprop='availability']/@href
field.script.availability=value == null ? null : value.replaceAll('.*/','')
```

Three things that will otherwise cost you an afternoon:

- **The Groovy binding is `value`**, never the field name. A wrong name is not a silent
  null — it throws, and the whole document is dropped from the index.
- **JSON-LD is unreachable from the web-crawl path.** `FessXpathTransformer` never calls an
  extractor, so `schema.org` JSON-LD is invisible however much of it the page carries. Use
  XPath against ordinary DOM; `itemprop` attributes work.
- **The XPath helper concatenates every matching node** rather than taking the first. Two
  `itemprop="price"` elements on one page silently yield `¥1,280¥999`.

## Known limitations

- **The price is formatted as yen (`¥`), hardcoded.** There is no currency model; a non-yen
  shop needs a change in `assets/storefront.js`.
- **`availability` is matched on the bare tails `InStock` / `OutOfStock`.** The crawl must
  strip the `https://schema.org/` prefix (the example above does). Any other value renders
  no badge rather than an invented one.
- **A non-numeric `price` renders nothing.** Deliberate: a string means the mapping or the
  response fields are misconfigured, and rendering it raw would hide that.
- **A missing rating omits the star row** rather than showing five empty stars — an empty
  row would imply a real zero. A genuine `0` rating does render five empty stars.
- No cart, no comparison tray, no personalisation. This is a search theme.

## Counts are BM25-only — read this before porting the count bars

The bars are driven by real `facet.query` counts from the server, and those counts come from
the BM25 branch only. That is precisely why `mosaic` and `semanticlens` ship **count-free**
facet sidebars: under a semantic or visual search their counts go empty or misleading.
Storefront is keyword-only, so the counts are always accurate here.

**Do not port count bars into a semantic or multimodal theme without solving that first** —
you will ship empty bars. (For the record, the counts cost one request, not N: every band
goes out as a repeated `facet.query` parameter on the same search call.)

## Why bars, and why not a histogram

A histogram implies a distribution over disjoint buckets. Fess's own shipped `timestamp`
facet is cumulative and overlapping (`[now/d-1d TO *]`, `[now/d-7d TO *]`, …), and a theme
cannot tell disjoint bands from cumulative ones by parsing the query string. So the theme
does not try to: it draws **every** facet-query group as bars proportional to their counts,
which is truthful either way. For a disjoint band set — which a price facet is — the result
is a distribution anyway, for free, with no inference.

## Content Security Policy

`StaticThemeResponder` serves `index.html` under a strict CSP, and the page's own meta CSP
intersects with it:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; connect-src 'self'; frame-src blob:; child-src blob:;
frame-ancestors 'none'; base-uri 'self'
```

So: no external fonts (there is no `font-src`, and `default-src 'self'` catches it), no CDN,
no inline `<script>`, no `on*=` handlers. Font Awesome is served by Fess itself from
`/css/font-awesome.min.css`, which is same-origin and therefore allowed.

Per-element styling goes through `.style.*` or a CSS custom property: the theme ships no
literal `style="` attribute, and the bar widths are set with `setProperty("--bar-w", …)`.

## Shared core

`assets/format.js` (the HTML sanitizer) is shared core and carries the `DROP_WITH_CONTENT`
guard, which drops raw-text elements whole instead of unwrapping them. Every theme in this
repository — and the bundled `bootstrap` reference theme in the `fess` repo — carries the
same copy, identical but for the per-theme comment on line 2.

**Port any change to it into every copy in the same PR; never overwrite one theme's copy
with another's.** Nothing enforces this — CI checks locale bundles only.

## Verifying

```bash
node scripts/verify-bundles.mjs storefront
```

That checks the **locale-bundle contract only**: a bundle for every locale `assets/i18n.js`
serves, key parity across all of them, and help section-id parity. It does not check element
ids, baseline leaks, or behaviour — verify those by hand and by running the theme.

A theme cannot be previewed from `file://`: it is an SPA on absolute `/themes/storefront/`
paths calling `/api/v2/*`, so it only runs when served by Fess 15.7+.
