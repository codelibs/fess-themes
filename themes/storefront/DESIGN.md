# Storefront Design System

## Concept

Storefront's core idea is **"a result is a product, not a document."**

Every other theme in this repository answers a query with a *document*: a title, a prose
snippet, a URL. That is the right shape for a docs site, a code search or an FAQ. It is the
wrong shape for a catalogue. A shopper scanning results does not read a fragment of the
product page — they look at the picture and the price, and decide. So the product card
carries a photo, name, price, star rating, stock badge and brand, and **carries no snippet
at all**. Deleting the snippet is the theme, not an omission.

The second idea follows from the first: once results are products, the interesting axis is
**price**. So facet counts are not numeric badges but **bars proportional to their counts** —
a price band's bar shows, without reading, where the catalogue actually sits.

Derived from `mosaic`, whose thumbnail grid, lazy-loading and no-image fallback are exactly
what a product grid needs. Mosaic's multimodal apparatus — searcher badges, composition
band, lightbox, list view — was removed rather than adapted: none of it means anything for a
keyword-only product search, and a badge saying "matched visually" on a catalogue would be a
lie.

## Palette

Inherited from the `docuforge` lineage and left alone: the product photos are what should
carry the visual interest, so the chrome stays quiet.

| Token | Hex | Role |
|---|---|---|
| Brand primary (`--df-primary`) | `#6D28D9` | Buttons, active fills, key accents |
| Brand hover (`--df-primary-hover`) | `#5B21B6` | Hover state, darker accent |
| Secondary / links (`--df-secondary`) | `#0369A1` | Link text, secondary actions, focus indicators |
| Page background (`--df-bg`) | `#FAFBFF` | Body background — cool near-white |
| Card surface (`--df-surface`) | `#FFFFFF` | Result cards, panels, modals, tiles |
| Neutral stone-200 (`--df-stone-200`) | `#E2E8F0` | Card and panel borders |
| Neutral stone-500 (`--df-stone-500`) | `#64748B` | Muted icons / secondary text |
| Neutral stone-900 (`--df-stone-900`) | `#0F172A` | Headings, dark header background |

Product-specific tokens add to it rather than replace it:

| Token | Role |
|---|---|
| `--sf-bar-track` | The unfilled track behind a count bar |
| `--sf-bar-fill` | The filled portion of a count bar |
| `--df-success` / `--df-success-subtle` | In-stock badge |
| `--df-error` / `--df-error-subtle` | Out-of-stock badge |
| `--df-warning` | Star fill |

## The product card

`buildGalleryTile()` in `assets/search.js`. Structure:

```
li.tile
  img.tile__img            ← lazy, via attachThumb(); or buildTileIcon() when absent
  a                        ← wraps image + name; href is the /go/ click-logging redirect
  div.tile__cap
    span.tile__title       ← product name (highlight tags stripped)
    span.sf-price          ← formatPrice(); omitted entirely when non-numeric
    span.sf-stars          ← ratingStars(); omitted entirely when there is no rating
    span.sf-avail          ← availabilityLabel(); omitted when the value is unrecognised
    span.sf-brand          ← raw brand text
```

Three decisions worth keeping:

- **The card must never collapse.** It uses mosaic's *grid* no-image strategy — retry with
  backoff, then swap in a typed icon — rather than docuforge's list-card strategy of hiding
  the image on error. An image-less product still has to show its price.
- **Every field gates independently.** No rating means no star row (five empty stars would
  imply a real zero); an unrecognised availability means no badge rather than an invented
  status; a non-numeric price renders nothing, because a string there means the deployment
  is misconfigured and rendering it raw would hide that.
- **The anchor goes through `/go/`**, not the raw URL, or Fess's click-through counting
  silently stops working.

The card's values all go through `el({text})` / `img.alt` — textContent, never `innerHTML`
with document data.

## Pure helpers: `assets/storefront.js`

Price, rating and availability formatting live in a DOM-free module, so the logic is pure
and can be exercised under plain Node with no DOM shim:

| Export | Contract |
|---|---|
| `formatPrice(hit, locale)` | `""` unless `price` is a finite, non-negative number |
| `ratingStars(hit)` | `null` when absent or negative; else `{full, half, empty}` with `full + (half?1:0) + empty === 5` |
| `availabilityLabel(hit)` | `"in_stock"` / `"out_of_stock"`, else `null`; caller joins `t("product." + label)` |
| `hasImage(hit, features)` | the thumbnail gate — the doc has one *and* the feature is on |
| `barWidths(counts)` | integer percentages of the group's largest count; all-zero rather than dividing by zero |

The module ships; its test does not. That matches `helpdesk`, and the repository has no test
runner by design.

## Count bars, and why not a histogram

`barWidths()` scales each count against the largest in its group; `renderFacetQueryViews()`
sets the width from JS with `setProperty("--bar-w", …)` and CSS draws it via
`.sf-facet-bar::before { width: var(--bar-w, 0%) }`.

**They are count bars, not a histogram, and that distinction is load-bearing.** A histogram
implies a distribution over disjoint buckets. Fess's own shipped `timestamp` facet is
cumulative and overlapping (`[now/d-1d TO *]`, `[now/d-7d TO *]`, …), and a theme cannot
tell disjoint bands from cumulative ones by parsing the query string. A bar proportional to
a *count* is truthful either way — and for a disjoint band set, which a price facet is, it
happens to also be a distribution. So the theme infers nothing and draws every group the
same way.

The bands themselves come from the server (`query.facet.queries` → `/api/v2/ui/config`'s
`facet_views`), joined against `facet_query` counts from the search response. The theme
renders `label_key`/`value` pairs it has never seen, so it stays generic: a ¥100 shop and a
car dealer differ only by a properties file.

**Counts are BM25-only.** That is why `mosaic` and `semanticlens` deliberately ship
count-free sidebars — under a semantic or visual search their counts go empty or misleading.
Storefront is keyword-only, so re-requesting `facet.query` here is correct rather than a
regression. Note mosaic's own design doc justifies count-free facets with an "N fan-out
requests" cost that does not exist: the bands go out as repeated `facet.query` parameters on
a single call.

## Structure

- **Home** — hero with the search box, plus three cards stating what the theme does (prices
  at a glance / narrow by price / sort by price). They describe real behaviour; the block
  they replaced advertised Keyword/Visual/Blend badges that this theme does not have.
- **Results** — `ul.gallery` of `li.tile` product cards. **Grid only.** There is no
  grid/list toggle: the list view rendered document cards with snippets, one click away and
  persisted in `localStorage`, which contradicted the whole premise.
- **Sidebar** — label facets plus facet-query groups drawn as count bars.

## Accessibility

- The star row carries an `aria-label` with the numeric rating; the stars themselves are
  decorative. A rating that renders as shapes and nothing else is invisible to a screen
  reader.
- Tiles are plain anchors, so they are keyboard-focusable and activatable without any
  `tabIndex`/`role` scaffolding (that scaffolding existed only to open the removed lightbox).
- Stock state is conveyed by text, not colour alone.

## Content Security Policy

`style-src` permits `'unsafe-inline'`, so a literal `style="width:42%"` would render — the
theme does not use one. No theme in this repository ships a literal `style=` attribute, and
per-element styling goes through `.style.*` or a custom property. Bar widths follow that
convention.

Font Awesome is served by Fess from `/css/font-awesome.min.css` (same-origin, allowed). Only
icons that Fess's copy actually defines are usable — `fa-sliders` and `fa-sort-amount-asc`,
for instance, are not there.

## Out of scope

- Cart, checkout, comparison tray, personalisation. This is a search theme.
- A currency model — the price is yen (`¥`), hardcoded.
- Auto-derived price bands: no stats/min/max aggregation is reachable from `/api/v2`, so
  bands are configuration.
- Similar-products discovery. `renderSimilarDocBanner`/`state.sdh` survive but are
  unreachable: their only trigger was the removed list card, and Fess's similar-document
  detection is content-minhash near-duplicate matching, which is not "similar products".
