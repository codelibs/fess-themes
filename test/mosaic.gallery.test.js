// SPDX-License-Identifier: Apache-2.0
// Mosaic gallery behaviour found while checking the theme against Fess 15.9 on the
// docker-multimodalsearch stack:
//
//   1. A label chosen through the sidebar facet or a shared URL (ex_q=label:<value>)
//      is kept in state.facets.label. Its active-filter chip must show the label's
//      name from label_options, and the options bar must list it, not "all".
//   2. The lightbox must not show the browser's broken-image glyph for a hit without
//      a thumbnail; it falls back to the same file-type icon the gallery tile uses.
//   3. The home view asks for popular words once (app.js renders them); the empty
//      state loads its own list only when a search finds nothing.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadSearchFlow } from "./helpers/loadSearch.js";
import { resetDom, mountBody, setLocation } from "./helpers/dom.js";
import { bootApp } from "./helpers/loadShell.js";
import { SEARCH_FIXTURE, FULL_CFG, makeSearchEnv, installDispatch, settle } from "./helpers/searchFlow.js";

const LIGHTBOX = `
  <div id="lightbox" hidden>
    <button class="lightbox__close" data-lb="close"></button>
    <button class="lightbox__nav lightbox__prev" data-lb="prev"></button>
    <figure class="lightbox__figure">
      <img class="lightbox__img" alt="">
      <figcaption class="lightbox__meta"></figcaption>
    </figure>
    <button class="lightbox__nav lightbox__next" data-lb="next"></button>
  </div>`;

const FIXTURE = SEARCH_FIXTURE.replace('<div id="lightbox"></div>', LIGHTBOX);

const CFG = {
  ...FULL_CFG,
  features: { ...FULL_CFG.features, thumbnail_enabled: true },
  label_options: [{ value: "photos", name: "Photos" }, { value: "docs" }],
};

const HTML_DOC = {
  doc_id: "h1", title: "Top page", content_title: "Top page",
  url: "http://content/", url_link: "http://content/",
  site: "content", site_path: "content/", mimetype: "text/html", filetype: "html",
  content_description: "top", digest: "top",
};
const THUMB_DOC = { ...HTML_DOC, doc_id: "h2", url: "http://content/a.html", url_link: "http://content/a.html", thumbnail: "http://content/a.jpg" };

beforeEach(() => {
  resetDom();
  sessionStorage.clear();
  window.scrollTo = () => {};
});
afterEach(() => setLocation("/"));

async function searchFrom(url, overrides = {}) {
  setLocation(url);
  const flow = await loadSearchFlow("mosaic", CFG);
  installDispatch(flow.get, overrides);
  mountBody(FIXTURE);
  flow.mod.attach();
  flow.mod.runFromUrl();
  await settle();
  return flow;
}

describe("mosaic label filter from ex_q", () => {
  it("names the label in its active-filter chip", async () => {
    await searchFrom("/search?q=sunset&ex_q=label%3Aphotos");
    const chips = document.getElementById("active-chips").textContent;
    expect(chips).toContain("labels.facet_label_title: Photos");
    expect(chips).not.toContain("label: photos");
  });

  it("falls back to the value for a label without a name", async () => {
    await searchFrom("/search?q=sunset&ex_q=label%3Adocs");
    expect(document.getElementById("active-chips").textContent).toContain("labels.facet_label_title: docs");
  });

  it("lists the label in the options bar instead of 'all'", async () => {
    await searchFrom("/search?q=sunset&ex_q=label%3Aphotos");
    const bar = document.getElementById("options-bar").textContent;
    expect(bar).toContain("Photos");
  });

  it("shows a label once when both the drawer and the facet hold it", async () => {
    await searchFrom("/search?q=sunset&ex_q=label%3Aphotos&fields.label=photos");
    const bar = document.getElementById("options-bar").textContent;
    expect(bar.match(/Photos/g)).toHaveLength(1);
  });
});

describe("mosaic lightbox without a thumbnail", () => {
  async function openFirst(docs) {
    await searchFrom("/search?q=top", { search: makeSearchEnv(docs) });
    document.querySelector("#results .tile").click();
    return document.getElementById("lightbox");
  }

  it("shows the file-type icon instead of requesting a thumbnail that does not exist", async () => {
    const lb = await openFirst([HTML_DOC]);
    expect(lb.hidden).toBe(false);
    const img = lb.querySelector(".lightbox__img");
    expect(img.hidden).toBe(true);
    expect(img.getAttribute("src")).toBe(null);
    expect(lb.querySelector(".lightbox__icon.fa-globe")).not.toBe(null);
  });

  it("loads the thumbnail when the hit has one, and falls back to the icon if it fails", async () => {
    const lb = await openFirst([THUMB_DOC]);
    const img = lb.querySelector(".lightbox__img");
    expect(img.hidden).toBe(false);
    expect(img.getAttribute("src")).toContain("thumbnail/?docId=h2");
    expect(lb.querySelector(".lightbox__icon")).toBe(null);
    img.dispatchEvent(new Event("error"));
    expect(img.hidden).toBe(true);
    expect(lb.querySelectorAll(".lightbox__icon")).toHaveLength(1);
  });

  it("restores the image when moving from a hit without a thumbnail to one with it", async () => {
    const lb = await openFirst([HTML_DOC, THUMB_DOC]);
    lb.querySelector(".lightbox__next").click();
    const img = lb.querySelector(".lightbox__img");
    expect(img.hidden).toBe(false);
    expect(img.getAttribute("src")).toContain("thumbnail/?docId=h2");
    expect(lb.querySelector(".lightbox__icon")).toBe(null);
  });
});

describe("mosaic popular words", () => {
  const calls = (get) => get.mock.calls.filter((c) => c[0] === "/popular-words").length;

  it("requests popular words once on the home view", async () => {
    const get = async (path) => (path === "/popular-words" ? { popular_words: ["alpha"] } : { authenticated: false });
    const booted = await bootApp("mosaic", { features: { popular_word: true }, notifications: {} }, { get });
    try {
      expect(calls(booted.get)).toBe(1);
      expect(document.getElementById("home-popular-words").textContent).toContain("alpha");
    } finally {
      booted.detach();
      vi.resetModules();
    }
  });

  it("fills the empty state's popular words when a search finds nothing", async () => {
    const flow = await searchFrom("/search?q=nothing", { search: makeSearchEnv([]) });
    const target = document.getElementById("popular-words");
    expect(target.textContent).toContain("alpha");
    expect(target.classList.contains("d-none")).toBe(false);
    expect(calls(flow.get)).toBe(1);
  });
});
