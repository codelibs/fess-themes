// SPDX-License-Identifier: Apache-2.0
// docsearch: the schemes a result link may use follow the server.
//
// Fess 15.10 sends the list as result_link_schemes in /api/v2/ui/config (search.result.link.schemes)
// and enforces it itself (/go/, the admin lists). The theme used to carry its own copy of the default
// list, so a scheme the administrator added (hammerspoon://) rendered "#" instead of a link, and a
// scheme the administrator took out (ftp) was still linked.
//
//   - A scheme listed in result_link_schemes is linked, one that is not listed is not
//   - An empty list allows no scheme; a response without the field (Fess before 15.10) gets the old default list
//   - javascript:, data: and vbscript: are never linked, even when the administrator lists them
//
// safeHref() is module-private, so it is read through what it decides on a result card (the
// data-uri / title of the title link) and through buildGoUrl().

import { describe, it, expect } from "vitest";
import { loadSearch } from "./helpers/loadSearch.js";

const THEME = "docsearch";
const DEFAULT_SCHEMES = ["http", "https", "ftp", "ftps", "file", "smb", "smb1", "storage", "s3", "gcs"];

/** The theme's own search.js with `cfg` as the /ui/config response. */
const load = (cfg) => loadSearch(THEME, cfg);

/** A result card for `url`, built with `cfg`; returns its title link. */
async function titleLinkOf(cfg, url) {
  const { buildResultCard } = await load(cfg);
  const li = buildResultCard({ doc_id: "d1", title: "T", url, url_link: url }, "q1", 1);
  return li.querySelector("h3.title a.link");
}

describe(`${THEME}: result_link_schemes decides which result links are made`, () => {
  it("links a scheme the administrator added", async () => {
    const url = "hammerspoon://fessopen?path=smb://h/s/a.pdf";
    const { buildGoUrl } = await load({ result_link_schemes: [...DEFAULT_SCHEMES, "hammerspoon"] });
    expect(buildGoUrl(url, "d1", "q1", 2, 1)).toBe("go/?rt=1&docId=d1&queryId=q1&order=2");
    const a = await titleLinkOf({ result_link_schemes: [...DEFAULT_SCHEMES, "hammerspoon"] }, url);
    expect(a.getAttribute("href")).toBe("go/?rt=" + a.getAttribute("href").split("rt=")[1]);
    expect(a.getAttribute("data-uri")).toBe(url);
    expect(a.getAttribute("title")).toBe(url);
  });

  it("does not link that scheme while it is not listed", async () => {
    const url = "hammerspoon://fessopen?path=x";
    const { buildGoUrl } = await load({ result_link_schemes: DEFAULT_SCHEMES });
    expect(buildGoUrl(url, "d1", "q1", 2, 1)).toBe("#");
    const a = await titleLinkOf({ result_link_schemes: DEFAULT_SCHEMES }, url);
    expect(a.getAttribute("href")).toBe("#");
    expect(a.getAttribute("data-uri")).toBe("");
  });

  it("does not link a scheme the administrator removed from the default list", async () => {
    const { buildGoUrl } = await load({ result_link_schemes: ["http", "https"] });
    expect(buildGoUrl("https://ex.com/a", "d1", "q1", 1, 1)).not.toBe("#");
    expect(buildGoUrl("ftp://ex.com/a", "d1", "q1", 1, 1)).toBe("#");
    expect(buildGoUrl("smb://h/s/a.pdf", "d1", "q1", 1, 1)).toBe("#");
  });

  it("reads the scheme case-insensitively and tolerates a trailing colon in the list", async () => {
    const url = "HammerSpoon://fessopen";
    const { buildGoUrl } = await load({ result_link_schemes: ["Hammerspoon:"] });
    expect(buildGoUrl(url, "d1", "q1", 1, 1)).not.toBe("#");
  });

  it("allows no scheme when the list is empty", async () => {
    const { buildGoUrl } = await load({ result_link_schemes: [] });
    for (const url of ["https://ex.com/a", "http://ex.com/a", "file:///a", "smb://h/s", "relative/path"]) {
      expect(buildGoUrl(url, "d1", "q1", 1, 1), url).toBe("#");
    }
    const a = await titleLinkOf({ result_link_schemes: [] }, "https://ex.com/a");
    expect(a.getAttribute("href")).toBe("#");
    expect(a.getAttribute("data-uri")).toBe("");
  });

  it("ignores blank entries: a list of blanks allows no scheme", async () => {
    const { buildGoUrl } = await load({ result_link_schemes: ["", "  ", ":"] });
    expect(buildGoUrl("https://ex.com/a", "d1", "q1", 1, 1)).toBe("#");
  });

  it.each([
    ["no config at all", null],
    ["a config without the field (Fess before 15.10)", { features: {} }],
    ["a field that is not a list", { result_link_schemes: "http,https" }],
  ])("falls back to the default list for %s", async (_name, cfg) => {
    const { buildGoUrl } = await load(cfg);
    for (const scheme of DEFAULT_SCHEMES) {
      expect(buildGoUrl(`${scheme}://h/p`, "d1", "q1", 1, 1), scheme).not.toBe("#");
    }
    expect(buildGoUrl("hammerspoon://fessopen", "d1", "q1", 1, 1)).toBe("#");
    expect(buildGoUrl("mailto:a@b.com", "d1", "q1", 1, 1)).toBe("#");
  });

  it.each(["javascript", "data", "vbscript", "JavaScript", "javascript:"])(
    "never links %s:, even when the administrator lists it", async (scheme) => {
      const cfg = { result_link_schemes: [...DEFAULT_SCHEMES, scheme] };
      const { buildGoUrl } = await load(cfg);
      for (const url of ["javascript:alert(1)", "data:text/html,<b>x</b>", "vbscript:msgbox(1)",
        " JaVaScRiPt:alert(1)", "java\tscript:alert(1)"]) {
        expect(buildGoUrl(url, "d1", "q1", 1, 1), url).toBe("#");
        const a = await titleLinkOf(cfg, url);
        expect(a.getAttribute("href"), url).toBe("#");
        expect(a.getAttribute("data-uri"), url).toBe("");
      }
    });
});
