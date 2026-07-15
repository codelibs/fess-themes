#!/usr/bin/env bash
# verify-theme.sh — static validation for a Fess static theme in this repo.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="${1:?usage: verify-theme.sh <theme-name> [<baseline-name>]}"
# The theme this one was copied from. A copy must retain neither the baseline's
# name nor its /themes/<baseline>/ asset paths in any shipped file — the single
# most common copy-paste defect here.
BASELINE="${2:-docuforge}"
DIR="$REPO_ROOT/themes/$NAME"
[ -d "$DIR" ] || { echo "FAIL: theme dir not found: $DIR"; exit 1; }
fail() { echo "FAIL: $1"; exit 1; }

# 1. i18n key parity: every bundle has exactly messages.en.json's flat key set.
node -e '
const fs=require("fs"),path=require("path");
const dir=process.argv[1];
const keys=o=>Object.keys(o);
const en=new Set(keys(JSON.parse(fs.readFileSync(path.join(dir,"messages.en.json")))));
let bad=0;
for(const f of fs.readdirSync(dir).filter(f=>/^messages\..*\.json$/.test(f))){
  const ks=new Set(keys(JSON.parse(fs.readFileSync(path.join(dir,f)))));
  const missing=[...en].filter(k=>!ks.has(k)), extra=[...ks].filter(k=>!en.has(k));
  if(missing.length||extra.length){bad++;console.error(`  ${f}: missing=${missing.length} extra=${extra.length}`);
    if(missing.length)console.error("    missing: "+missing.slice(0,10).join(", "));
    if(extra.length)console.error("    extra: "+extra.slice(0,10).join(", "));}
}
process.exit(bad?1:0);
' "$DIR/i18n" || fail "i18n key parity"
echo "OK: i18n parity"

CNT=$(ls "$DIR/i18n" 2>/dev/null | grep -c '^messages\..*\.json$' || true)
[ "$CNT" -eq 16 ] || fail "expected 16 i18n bundles, found $CNT"

# 2. no stray baseline paths, and no leftover baseline substring in SHIPPED files
if grep -riIn "/themes/${BASELINE}/" "$DIR" >/dev/null 2>&1; then
  grep -riIn "/themes/${BASELINE}/" "$DIR"; fail "stray /themes/${BASELINE}/ path"
fi
# Case-insensitive on purpose: the display spelling (e.g. "DocuForge") appears in
# doc comments and theme.yml#displayName. The original check was case-sensitive,
# so a copy could ship the baseline's brand in 15 files and still print PASS.
# DESIGN.md/README.md intentionally reference the baseline → exclude them.
if grep -riIn --exclude=DESIGN.md --exclude=README.md "$BASELINE" "$DIR" >/dev/null 2>&1; then
  grep -riIn --exclude=DESIGN.md --exclude=README.md "$BASELINE" "$DIR"; fail "leftover '${BASELINE}' substring (any case) in a shipped file"
fi
echo "OK: no stray baseline paths/substrings (baseline=${BASELINE}, case-insensitive)"

# 3. required element IDs present in index.html
REQUIRED_IDS=(query searchButton searchOptions suggest-dropdown header-nav auth-controls \
  chat-nav-item help-link home-view contentQuery home-suggest-dropdown results-view \
  content-results results-status facet-body facet-body-mobile facetOffcanvas result \
  results pagination empty-state advance-view error-view profile-view help-view \
  chat-view cache-view login-modal login-form contextPath)
for id in "${REQUIRED_IDS[@]}"; do
  grep -q "id=\"$id\"" "$DIR/index.html" || fail "missing required id=\"$id\" in index.html"
done
echo "OK: required element IDs present (${#REQUIRED_IDS[@]})"

# 4. help bundles: 8 locales, identical section id sets.
HCNT=$(ls "$DIR/help" 2>/dev/null | grep -c '\.json$' || true)
[ "$HCNT" -eq 8 ] || fail "expected 8 help bundles, found $HCNT"
node -e '
const fs=require("fs"),path=require("path");
const dir=process.argv[1];
const ids=f=>{const j=JSON.parse(fs.readFileSync(path.join(dir,f)));
  const arr=Array.isArray(j)?j:(j.sections||[]);
  return new Set(arr.map(s=>s.id).filter(Boolean));};
const en=ids("en.json"); let bad=0;
for(const f of fs.readdirSync(dir).filter(f=>/\.json$/.test(f))){
  const s=ids(f);
  const missing=[...en].filter(k=>!s.has(k)), extra=[...s].filter(k=>!en.has(k));
  if(missing.length||extra.length){bad++;console.error(`  ${f}: missing=${missing} extra=${extra}`);}
}
process.exit(bad?1:0);
' "$DIR/help" || fail "help section id parity"
echo "OK: help bundles (8, section ids match en.json)"

# 5. stale-facet invariant in search.js
for inv in 'state.facets = {}' 'state.facetQueries = \[\]' 'state.sdh = ""'; do
  grep -Eq "$inv" "$DIR/assets/search.js" || fail "runFromUrl invariant missing: $inv"
done
echo "OK: stale-facet invariant intact"
echo "PASS: $NAME"
