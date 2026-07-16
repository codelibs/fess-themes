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
# Both checks skip DESIGN.md/README.md: those intentionally name the baseline to
# document what the theme was forked from, paths included ("we replaced every
# /themes/<baseline>/ path"). -F: the baseline is a fixed string, not a pattern.
if grep -riIFn --exclude=DESIGN.md --exclude=README.md "/themes/${BASELINE}/" "$DIR" >/dev/null 2>&1; then
  grep -riIFn --exclude=DESIGN.md --exclude=README.md "/themes/${BASELINE}/" "$DIR"; fail "stray /themes/${BASELINE}/ path"
fi
# Case-insensitive on purpose: the display spelling (e.g. "DocuForge") appears in
# doc comments and theme.yml#displayName. The original check was case-sensitive,
# so a copy could ship the baseline's brand in 15 files and still print PASS.
if grep -riIFn --exclude=DESIGN.md --exclude=README.md "$BASELINE" "$DIR" >/dev/null 2>&1; then
  grep -riIFn --exclude=DESIGN.md --exclude=README.md "$BASELINE" "$DIR"; fail "leftover '${BASELINE}' substring (any case) in a shipped file"
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

# 5. stale-facet invariant: runFromUrl() must reset every in-memory filter store,
# or facets leak across navigations. The three resets also occur in
# resetSearchState()/attach()/renderFacets(), so grepping the whole file stays
# green even when runFromUrl() itself loses them — i.e. it cannot catch the very
# regression it exists for. Slice the function body out first and assert on that.
SEARCH_JS="$DIR/assets/search.js"
[ -f "$SEARCH_JS" ] || fail "assets/search.js not found"
# Top-level functions here are formatted with their closing brace at column 0, so
# the body spans the declaration through the first such brace. Reaching the next
# top-level declaration first means that convention broke and the slice would
# silently swallow the following function (whose resets would mask the failure) —
# exit 2 instead. exit 3 = declaration never found (renamed?).
SLICE_RC=0
BODY=$(awk '
  /^(export )?(async )?function [A-Za-z_$]/ {
    if (started) exit 2
    if ($0 ~ /^(export )?(async )?function runFromUrl[[:space:]]*\(/) started=1
  }
  started { print; if ($0 ~ /^}$/) { done=1; exit 0 } }
  END { if (!started) exit 3; if (!done) exit 2 }
' "$SEARCH_JS") || SLICE_RC=$?
# A check that matches nothing must fail loudly, never pass.
[ "$SLICE_RC" -ne 3 ] || fail "runFromUrl() declaration not found in assets/search.js — invariant unverifiable"
[ "$SLICE_RC" -eq 0 ] || fail "runFromUrl() body not terminated by a column-0 '}' in assets/search.js — invariant unverifiable"
[ -n "$BODY" ] || fail "runFromUrl() body sliced empty from assets/search.js — invariant unverifiable"
# Anchor each reset to the start of its line so a commented-out one ("// state.
# facets = {}") no longer satisfies the check — that is a disabled reset, i.e.
# the bug, not evidence against it.
for inv in 'state\.facets = \{\}' 'state\.facetQueries = \[\]' 'state\.sdh = ""'; do
  grep -Eq "^[[:space:]]*$inv" <<<"$BODY" || fail "runFromUrl() invariant missing: ${inv//\\/}"
done
echo "OK: stale-facet invariant intact (checked inside runFromUrl(), $(printf '%s\n' "$BODY" | wc -l | tr -d ' ') lines)"
echo "PASS: $NAME"
