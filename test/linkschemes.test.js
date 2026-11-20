// SPDX-License-Identifier: Apache-2.0
// The schemes a result link may use follow the server, in every theme but docsearch (which has its own
// copy of this in docsearch.linkschemes.test.js) and codesearch (see the last block).
//
// Fess 15.10 sends the list as result_link_schemes in /api/v2/ui/config (search.result.link.schemes)
// and enforces it itself (/go/, the admin lists). The themes used to carry their own copy of the default
// list, so a scheme the administrator added (hammerspoon://) rendered "#" instead of a link, and a
// scheme the administrator took out (ftp) was still linked.
//
//   - A scheme listed in result_link_schemes is linked, one that is not listed is not
//   - An empty list allows no scheme; a response without the field (Fess before 15.10) gets the old default list
//   - javascript:, data: and vbscript: are never linked, even when the administrator lists them
//
// safeHref() is module-private, so it is read through buildGoUrl(), which applies the same rule.

import { describe, it, expect } from "vitest";
import { loadSearch } from "./helpers/loadSearch.js";

const THEMES = ["docuforge", "filesearch", "helpdesk", "mosaic", "nomadkit", "rawblock", "semanticlens", "storefront", "voicebox"];
const DEFAULT_SCHEMES = ["http", "https", "ftp", "ftps", "file", "smb", "smb1", "storage", "s3", "gcs"];

describe.each(THEMES)("%s: result_link_schemes decides which result links are made", (THEME) => {
  /** The theme's own buildGoUrl with `cfg` as the /ui/config response. */
  const goUrl = async (cfg) => (await loadSearch(THEME, cfg)).buildGoUrl;

  it("links a scheme the administrator added", async () => {
    const buildGoUrl = await goUrl({ result_link_schemes: [...DEFAULT_SCHEMES, "hammerspoon"] });
    expect(buildGoUrl("hammerspoon://fessopen?path=smb://h/s/a.pdf", "d1", "q1", 2, 1)).toBe("go/?rt=1&docId=d1&queryId=q1&order=2");
  });

  it("does not link that scheme while it is not listed", async () => {
    const buildGoUrl = await goUrl({ result_link_schemes: DEFAULT_SCHEMES });
    expect(buildGoUrl("hammerspoon://fessopen?path=x", "d1", "q1", 2, 1)).toBe("#");
  });

  it("does not link a scheme the administrator removed from the default list", async () => {
    const buildGoUrl = await goUrl({ result_link_schemes: ["http", "https"] });
    expect(buildGoUrl("https://ex.com/a", "d1", "q1", 1, 1)).not.toBe("#");
    expect(buildGoUrl("ftp://ex.com/a", "d1", "q1", 1, 1)).toBe("#");
    expect(buildGoUrl("smb://h/s/a.pdf", "d1", "q1", 1, 1)).toBe("#");
  });

  it("reads the scheme case-insensitively and tolerates a trailing colon in the list", async () => {
    const buildGoUrl = await goUrl({ result_link_schemes: ["Hammerspoon:"] });
    expect(buildGoUrl("HammerSpoon://fessopen", "d1", "q1", 1, 1)).not.toBe("#");
  });

  it("allows no scheme when the list is empty", async () => {
    const buildGoUrl = await goUrl({ result_link_schemes: [] });
    for (const url of ["https://ex.com/a", "http://ex.com/a", "file:///a", "smb://h/s", "relative/path"]) {
      expect(buildGoUrl(url, "d1", "q1", 1, 1), url).toBe("#");
    }
  });

  it("ignores blank entries: a list of blanks allows no scheme", async () => {
    const buildGoUrl = await goUrl({ result_link_schemes: ["", "  ", ":"] });
    expect(buildGoUrl("https://ex.com/a", "d1", "q1", 1, 1)).toBe("#");
  });

  it.each([
    ["no config at all", null],
    ["a config without the field (Fess before 15.10)", { features: {} }],
    ["a field that is not a list", { result_link_schemes: "http,https" }],
  ])("falls back to the default list for %s", async (_name, cfg) => {
    const buildGoUrl = await goUrl(cfg);
    for (const scheme of DEFAULT_SCHEMES) {
      expect(buildGoUrl(`${scheme}://h/p`, "d1", "q1", 1, 1), scheme).not.toBe("#");
    }
    expect(buildGoUrl("hammerspoon://fessopen", "d1", "q1", 1, 1)).toBe("#");
    expect(buildGoUrl("mailto:a@b.com", "d1", "q1", 1, 1)).toBe("#");
  });

  it.each(["javascript", "data", "vbscript", "JavaScript", "javascript:"])(
    "never links %s:, even when the administrator lists it", async (scheme) => {
      const buildGoUrl = await goUrl({ result_link_schemes: [...DEFAULT_SCHEMES, scheme] });
      for (const url of ["javascript:alert(1)", "data:text/html,<b>x</b>", "vbscript:msgbox(1)",
        " JaVaScRiPt:alert(1)", "java\tscript:alert(1)"]) {
        expect(buildGoUrl(url, "d1", "q1", 1, 1), url).toBe("#");
      }
    });
});

// codesearch exports neither buildGoUrl nor safeHref: its result card for a document that is neither a
// repository file nor a web page (buildGenericCard) shows what safeHref decides as the link.
describe("codesearch: result_link_schemes decides which result links are made", () => {
  const linkOf = async (cfg, url) => {
    const { buildResultCard } = await loadSearch("codesearch", cfg);
    const li = buildResultCard({ doc_id: "d1", title: "T", url }, "q1", 1);
    const a = li.querySelector("a[href]");
    return a ? a.getAttribute("href") : null;
  };

  it("links a scheme the administrator added, and only while it is listed", async () => {
    const url = "hammerspoon://fessopen?path=x";
    expect(await linkOf({ result_link_schemes: [...DEFAULT_SCHEMES, "hammerspoon"] }, url)).toBe(url);
    expect(await linkOf({ result_link_schemes: DEFAULT_SCHEMES }, url)).toBeNull();
  });

  it("links nothing when the list is empty, and never a javascript: URL", async () => {
    expect(await linkOf({ result_link_schemes: [] }, "https://ex.com/a")).toBeNull();
    expect(await linkOf({ result_link_schemes: [...DEFAULT_SCHEMES, "javascript"] }, "javascript:alert(1)")).toBeNull();
  });
});
