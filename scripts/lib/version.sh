#!/usr/bin/env bash
#
# version.sh — read a theme's version from its theme.yml.
#
# Sourced by scripts/package.sh and scripts/stage-maven.sh so both agree on
# exactly which line of theme.yml is authoritative.

# read_theme_version <path-to-theme.yml>
# Prints the version to stdout. Empty output means it could not be read, or
# the value did not look like a version Fess would accept -- callers must
# treat empty output as "unreadable", not as a literal empty version.
read_theme_version() {
  local yml="$1"
  local v
  if command -v yq >/dev/null 2>&1; then
    v="$(yq -r '.version' "$yml")"
  else
    # fallback: grep the `version: "x.y.z"` line at column 0
    v="$(grep -E '^version:' "$yml" | head -1 | sed -E 's/^version:[[:space:]]*"?([^"]+)"?[[:space:]]*$/\1/')"
  fi
  # Validate against the same pattern ThemeManifest.SEMVER_PATTERN enforces
  # server-side (fess repo, org.codelibs.fess.theme.ThemeManifest). This is
  # what rejects `null` (yq on a missing key), a trailing "# comment" that
  # the grep fallback would otherwise keep, and anything else malformed --
  # instead of letting a caller's `[ -n "$version" ]` guard wave it through.
  [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]] || return 0
  printf '%s\n' "$v"
}
