#!/usr/bin/env bash
#
# verify-versions.sh — fail when a theme's shipped files changed without a
# version bump, measured against the tip of the base branch.
#
# Usage:
#   ./scripts/verify-versions.sh [<base-ref>]   # default: origin/main
#
# "Shipped files" are everything under themes/<name>/ except README.md and
# DESIGN.md, which scripts/package.sh excludes from the ZIP.
set -euo pipefail

BASE_REF="${1:-origin/main}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/version.sh
. "$REPO_ROOT/scripts/lib/version.sh"

log() { printf '\033[0;34m[verify-versions]\033[0m %s\n' "$*"; }
err() { printf '\033[0;31m[error]\033[0m %s\n' "$*" >&2; }

merge_base="$(git merge-base "$BASE_REF" HEAD)"

# Themes this branch touched, ignoring files that ship nothing.
touched="$(git diff --name-only "$merge_base" HEAD -- 'themes/*' \
  | grep -v -E '^themes/[^/]+/(README|DESIGN)\.md$' \
  | cut -d/ -f2 | sort -u || true)"

if [ -z "$touched" ]; then
  log "no shipped theme files changed"
  exit 0
fi

status=0
for name in $touched; do
  if [ ! -f "themes/$name/theme.yml" ]; then
    log "theme removed, skipping: $name"
    continue
  fi
  here="$(read_theme_version "themes/$name/theme.yml")"
  there=""
  if git cat-file -e "$BASE_REF:themes/$name/theme.yml" 2>/dev/null; then
    tmp="$(mktemp)"
    git show "$BASE_REF:themes/$name/theme.yml" >"$tmp"
    there="$(read_theme_version "$tmp")"
    rm -f "$tmp"
  fi
  if [ -z "$there" ]; then
    log "new theme, no baseline version: $name ($here)"
    continue
  fi
  if [ -z "$here" ]; then
    err "$name: theme.yml#version is missing or does not match the required"
    err "  <major>.<minor>.<patch>[-pre] pattern -- cannot compare against $BASE_REF ($there)."
    status=1
    continue
  fi
  if [ "$here" = "$there" ]; then
    err "$name: shipped files changed but theme.yml version is still $here (same as $BASE_REF)."
    err "  Bump themes/$name/theme.yml#version. If you already bumped it, a rebase"
    err "  may have collapsed your bump into an identical one already on $BASE_REF."
    status=1
  else
    log "$name: $there -> $here"
  fi
done

exit "$status"
