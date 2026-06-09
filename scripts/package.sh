#!/usr/bin/env bash
#
# package.sh — bundle a Fess static theme into an uploadable ZIP.
#
# Usage:
#   ./scripts/package.sh <theme-name> [<theme-name> ...]
#   ./scripts/package.sh --all
#
# Output:
#   dist/<name>-<version>.zip   (theme.yml sits at the ZIP root, as Fess expects)
#
# Runtime-only files are shipped; README.md and OS cruft are excluded.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
THEMES_DIR="$REPO_ROOT/themes"
DIST_DIR="$REPO_ROOT/dist"

log()  { printf '\033[0;34m[package]\033[0m %s\n' "$*"; }
err()  { printf '\033[0;31m[error]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

read_version() {
  local yml="$1"
  if command -v yq >/dev/null 2>&1; then
    yq -r '.version' "$yml"
  else
    # fallback: grep the `version: "x.y.z"` line
    grep -E '^version:' "$yml" | head -1 | sed -E 's/^version:[[:space:]]*"?([^"]+)"?[[:space:]]*$/\1/'
  fi
}

package_one() {
  local name="$1"
  local dir="$THEMES_DIR/$name"
  [ -d "$dir" ] || die "theme not found: themes/$name"
  [ -f "$dir/theme.yml" ] || die "missing theme.yml: themes/$name/theme.yml"

  local version; version="$(read_version "$dir/theme.yml")"
  [ -n "$version" ] || die "could not read version from themes/$name/theme.yml"

  mkdir -p "$DIST_DIR"
  local out="$DIST_DIR/${name}-${version}.zip"
  rm -f "$out"

  log "packaging theme=$name version=$version -> dist/$(basename "$out")"
  ( cd "$dir" && zip -r -q "$out" . \
      -x 'README.md' -x 'DESIGN.md' \
      -x '.DS_Store' -x '*/.DS_Store' -x '*~' -x '*.swp' )
  log "done: $out"
}

main() {
  command -v zip >/dev/null 2>&1 || die "the 'zip' command is required"
  [ "$#" -ge 1 ] || die "usage: $0 <theme-name> [...] | --all"

  if [ "$1" = "--all" ]; then
    local found=0
    for d in "$THEMES_DIR"/*/; do
      [ -f "${d}theme.yml" ] || continue
      package_one "$(basename "$d")"
      found=1
    done
    [ "$found" = 1 ] || die "no themes found under themes/"
  else
    for name in "$@"; do package_one "$name"; done
  fi
}

main "$@"
