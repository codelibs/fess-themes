#!/usr/bin/env bash
#
# stage-maven.sh — stage themes for upload to a maven repository tree.
#
# Usage:
#   BASE_URL=<repository tree URL> ./scripts/stage-maven.sh [<theme> ...]
#
# Output:
#   dist/upload/org/codelibs/fess/themes/<name>/<version>/<name>-<version>.zip
#   dist/upload/org/codelibs/fess/themes/<name>/<version>/<name>-<version>.zip.sha1
#   dist/upload/org/codelibs/fess/themes/<name>/maven-metadata.xml
#   dist/upload/org/codelibs/fess/themes/<name>/maven-metadata.xml.sha1
#   dist/upload/org/codelibs/fess/themes/theme-index.txt
#   dist/upload/org/codelibs/fess/themes/theme-index.txt.sha1
#
# Only versions that do not already exist under $BASE_URL are staged, so the
# upload never overwrites a published artifact. Existence is probed over public
# HTTPS: no credentials are used or needed here.
set -euo pipefail

BASE_URL="${BASE_URL:?BASE_URL is required}"
BASE_URL="${BASE_URL%/}"

GROUP_ID="org.codelibs.fess.themes"
GROUP_PATH="org/codelibs/fess/themes"

# Names the themes this repository publishes, one per line. The directory index a web
# server generates is not usable for this: it is produced on a schedule, so a tree that
# has just been published to answers 403 until it runs, and the listing for the parent
# group is already behind. A consumer reads this file for the names and each theme's own
# maven-metadata.xml for its versions.
INDEX_NAME="theme-index.txt"

# What a theme name may be, from ThemeManifest.NAME_PATTERN in Fess. Every line of the
# index is checked against it, which is also what tells a real index from a proxy error
# page that happens to answer 200.
NAME_RE='^[a-z0-9][a-z0-9_-]{0,63}$'


REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
THEMES_DIR="$REPO_ROOT/themes"
DIST_DIR="$REPO_ROOT/dist"
UPLOAD_ROOT="$DIST_DIR/upload"
UPLOAD_DIR="$UPLOAD_ROOT/$GROUP_PATH"

# shellcheck source=lib/version.sh
. "$REPO_ROOT/scripts/lib/version.sh"

log() { printf '\033[0;34m[stage-maven]\033[0m %s\n' "$*"; }
err() { printf '\033[0;31m[error]\033[0m %s\n' "$*" >&2; }
die() { err "$*"; exit 1; }

sha1_of() {
  if command -v sha1sum >/dev/null 2>&1; then
    sha1sum "$1" | cut -d' ' -f1
  else
    shasum -a 1 "$1" | cut -d' ' -f1
  fi
}

# Prints the HTTP status for a URL using the given method (GET or HEAD), or
# 000 when the request never completed. HEAD is for existence checks only --
# it must not be used where the response body is needed.
http_status() {
  local url="$1" method="$2" code
  if [ "$method" = "HEAD" ]; then
    code="$(curl -s -o /dev/null -w '%{http_code}' -I "$url" 2>/dev/null)" || true
  else
    code="$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null)" || true
  fi
  printf '%s' "${code:-000}"
}

# Versions already published for a theme, one per line (empty when new).
# A confirmed 404 means "never published" (no output, success). Any other
# non-200 status (500, a transport failure, ...) must not be read as "no
# prior versions" -- that would let a transient error erase the published
# version history the next time metadata.xml is regenerated -- so it dies.
remote_versions() {
  local name="$1"
  local url="$BASE_URL/$GROUP_PATH/$name/maven-metadata.xml"
  local tmp
  tmp="$(mktemp)"
  local code
  code="$(curl -s -o "$tmp" -w '%{http_code}' "$url" 2>/dev/null)" || true
  code="${code:-000}"
  case "$code" in
    200)
      # A 200 whose body isn't actually maven-metadata.xml (a proxy page, a
      # captive portal, an HTML directory listing) would otherwise grep as
      # "zero prior versions" and, once written back by write_metadata,
      # permanently truncate the real published history. Refuse to trust it.
      grep -q '<metadata' "$tmp" || { rm -f "$tmp"; die "not a maven-metadata.xml: $url"; }
      grep -o '<version>[^<]*</version>' "$tmp" | sed 's/<[^>]*>//g' || true
      rm -f "$tmp"
      ;;
    404)
      rm -f "$tmp"
      ;;
    *)
      rm -f "$tmp"
      die "unexpected HTTP $code fetching $url"
      ;;
  esac
}

# A confirmed 404 means "not published" (return 1). A confirmed 200 means
# "published" (return 0). Any other status (500, a transport failure, ...)
# must not be read as "absent" -- that would let stage_one stage a version
# that is already released, and the upload would overwrite it -- so it dies.
remote_zip_exists() {
  local name="$1" version="$2"
  local url="$BASE_URL/$GROUP_PATH/$name/$version/$name-$version.zip"
  local code
  code="$(http_status "$url" HEAD)"
  case "$code" in
    200) return 0 ;;
    404) return 1 ;;
    *) die "unexpected HTTP $code probing $url" ;;
  esac
}

# Numeric sort for <major>.<minor>.<patch>; keeps 15.8.10 after 15.8.9.
sort_versions() {
  sort -t. -k1,1n -k2,2n -k3,3n
}

# Merge $published (existing versions, one per line, possibly empty) with the
# newly staged $new_version and regenerate maven-metadata.xml for $name.
stage_metadata() {
  local name="$1" published="$2" new_version="$3"
  local versions
  versions="$( { printf '%s\n' "$published"; echo "$new_version"; } | grep -v '^$' | sort -u | sort_versions )"
  write_metadata "$name" "$versions"
}

write_metadata() {
  local name="$1" versions="$2"
  local latest
  latest="$(printf '%s\n' "$versions" | tail -1)"
  local ts
  ts="$(date -u +%Y%m%d%H%M%S)"
  # Not guaranteed to exist: the metadata-repair path in stage_one writes
  # here without ever staging a zip, which is what used to create this
  # directory as a side effect of `mkdir -p ".../$version"`.
  mkdir -p "$UPLOAD_DIR/$name"
  local out="$UPLOAD_DIR/$name/maven-metadata.xml"
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<metadata>'
    echo "  <groupId>$GROUP_ID</groupId>"
    echo "  <artifactId>$name</artifactId>"
    echo '  <versioning>'
    echo "    <latest>$latest</latest>"
    echo "    <release>$latest</release>"
    echo '    <versions>'
    printf '%s\n' "$versions" | while read -r v; do
      if [ -n "$v" ]; then echo "      <version>$v</version>"; fi
    done
    echo '    </versions>'
    echo "    <lastUpdated>$ts</lastUpdated>"
    echo '  </versioning>'
    echo '</metadata>'
  } >"$out"
  printf '%s' "$(sha1_of "$out")" >"$out.sha1"
}

# The theme names already published, one per line (empty when the index is absent).
# A confirmed 404 means "no index yet". Any other non-200 must not be read as "no names":
# the index is rewritten from what this returns, so a transient error would erase the
# published names. A 200 whose body is not an index is refused for the same reason.
remote_index() {
  local url="$BASE_URL/$GROUP_PATH/$INDEX_NAME"
  local tmp
  tmp="$(mktemp)"
  local code
  code="$(curl -s -o "$tmp" -w '%{http_code}' "$url" 2>/dev/null)" || true
  code="${code:-000}"
  case "$code" in
    200)
      local line
      # `|| [ -n "$line" ]` keeps the last line of a body that does not end in a
      # newline. Without it the final name is silently dropped, which is how a retired
      # theme sitting last in the file would disappear from the union.
      while IFS= read -r line || [ -n "$line" ]; do
        [ -n "$line" ] || continue
        if ! [[ "$line" =~ $NAME_RE ]]; then
          rm -f "$tmp"
          die "not a theme index: $url"
        fi
        printf '%s\n' "$line"
      done <"$tmp"
      rm -f "$tmp"
      ;;
    404)
      rm -f "$tmp"
      ;;
    *)
      rm -f "$tmp"
      die "unexpected HTTP $code fetching $url"
      ;;
  esac
}

# Adds the themes in this checkout to the published index, and stages it when that
# changes anything.
#
# The union is deliberate. Nothing here can know whether a name missing from the checkout
# was retired or is simply not in this run -- stage-maven.sh can be called with a subset --
# so a name is never dropped, exactly as a published version is never dropped. Retiring a
# theme is a deliberate edit of the published file.
stage_index() {
  # Kept out of a pipeline on purpose. `x="$(remote_index | sort -u)"` reports sort's
  # status, so a die inside remote_index -- an unreadable index, or a 200 that is not one --
  # would be swallowed and the published names replaced by whatever the checkout holds.
  local raw
  raw="$(remote_index)"
  local published desired
  # sed, not `grep -v`: grep exits 1 when it prints nothing, and under `set -o pipefail`
  # that fails the assignment -- so the very first run, with no index published yet, would
  # abort instead of creating one.
  published="$(printf '%s\n' "$raw" | sed '/^$/d' | sort -u)"
  desired="$( { printf '%s\n' "$published"; printf '%s\n' "$@"; } | sed '/^$/d' | sort -u )"
  local count
  count="$(printf '%s\n' "$desired" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [ "$desired" = "$published" ]; then
    log "index unchanged ($count theme(s))"
    return 0
  fi
  mkdir -p "$UPLOAD_DIR"
  local out="$UPLOAD_DIR/$INDEX_NAME"
  printf '%s\n' "$desired" >"$out"
  printf '%s' "$(sha1_of "$out")" >"$out.sha1"
  STAGED=$((STAGED + 1))
  log "staging index ($count theme(s))"
}

stage_one() {
  local name="$1"
  local dir="$THEMES_DIR/$name"
  [ -f "$dir/theme.yml" ] || die "missing theme.yml: themes/$name/theme.yml"

  local version
  version="$(read_theme_version "$dir/theme.yml")"
  [ -n "$version" ] || die "could not read version from themes/$name/theme.yml"

  if remote_zip_exists "$name" "$version"; then
    # The ZIP is already published. Normally there is nothing left to do --
    # but a prior run could have uploaded the ZIP and then died (or lost the
    # metadata file) before copying maven-metadata.xml, leaving a published
    # version the metadata never lists. Anything that enumerates available
    # versions from maven-metadata.xml alone would then never see it again,
    # and the only fix would be hand-editing XML or deleting a published
    # ZIP -- exactly what this design exists to avoid. So check the published
    # version list before deciding, and repair the metadata if it is missing.
    #
    # NOTE: assignment kept on its own statement, separate from `local`.
    # `local x=$(cmd)` reports `local`'s own exit status (always 0), which
    # would silently swallow a `die` inside remote_versions instead of
    # aborting here.
    local published
    published="$(remote_versions "$name")"
    if printf '%s\n' "$published" | grep -qx "$version"; then
      log "skip (already published): $name $version"
      return 0
    fi

    log "repairing metadata (published zip missing from maven-metadata.xml): $name $version"
    stage_metadata "$name" "$published" "$version"
    STAGED=$((STAGED + 1))
    return 0
  fi

  log "staging: $name $version"
  "$REPO_ROOT/scripts/package.sh" "$name" >/dev/null

  local zip="$DIST_DIR/$name-$version.zip"
  [ -f "$zip" ] || die "package.sh did not produce $zip"

  mkdir -p "$UPLOAD_DIR/$name/$version"
  cp "$zip" "$UPLOAD_DIR/$name/$version/"
  printf '%s' "$(sha1_of "$zip")" >"$UPLOAD_DIR/$name/$version/$name-$version.zip.sha1"
  rm -f "$zip"

  local published
  published="$(remote_versions "$name")"
  stage_metadata "$name" "$published" "$version"

  STAGED=$((STAGED + 1))
}

main() {
  command -v curl >/dev/null 2>&1 || die "the 'curl' command is required"
  command -v zip >/dev/null 2>&1 || die "the 'zip' command is required"

  rm -rf "$UPLOAD_ROOT"
  STAGED=0

  local names=()
  if [ "$#" -ge 1 ]; then
    names=("$@")
  else
    for d in "$THEMES_DIR"/*/; do
      [ -f "${d}theme.yml" ] || continue
      names+=("$(basename "$d")")
    done
  fi
  for name in "${names[@]}"; do stage_one "$name"; done

  # After the themes, so a name only reaches the index once its archive is staged or was
  # already published: stage_one dies on a bad theme and takes the whole run with it.
  stage_index "${names[@]}"

  if [ "$STAGED" -eq 0 ]; then
    log "nothing to upload"
  else
    log "staged $STAGED version(s) under dist/upload"
    find "$UPLOAD_ROOT" -type f | sort
  fi
}

main "$@"
