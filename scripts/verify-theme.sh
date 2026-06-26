#!/usr/bin/env bash
# verify-theme.sh — static validation for a Fess static theme in this repo.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="${1:?usage: verify-theme.sh <theme-name>}"
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

CNT=$(ls "$DIR/i18n" | grep -c '^messages\..*\.json$')
[ "$CNT" -eq 16 ] || fail "expected 16 i18n bundles, found $CNT"

# 2. no stray baseline paths, and no leftover 'docuforge' substring in SHIPPED files
if grep -rIn '/themes/docuforge/' "$DIR" >/dev/null 2>&1; then
  grep -rIn '/themes/docuforge/' "$DIR"; fail "stray /themes/docuforge/ path"
fi
# DESIGN.md/README.md intentionally reference docuforge as the baseline → exclude them.
if grep -rIn --exclude=DESIGN.md --exclude=README.md 'docuforge' "$DIR" >/dev/null 2>&1; then
  grep -rIn --exclude=DESIGN.md --exclude=README.md 'docuforge' "$DIR"; fail "leftover 'docuforge' substring in a shipped file"
fi
echo "OK: no stray baseline paths/substrings"

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

# 4. stale-facet invariant in search.js
for inv in 'state.facets = {}' 'state.facetQueries = \[\]' 'state.sdh = ""'; do
  grep -Eq "$inv" "$DIR/assets/search.js" || fail "runFromUrl invariant missing: $inv"
done
echo "OK: stale-facet invariant intact"
echo "PASS: $NAME"
