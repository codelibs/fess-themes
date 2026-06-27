/**
 * query.js — Query qualifier parser for the codesearch theme.
 *
 * Parses an inline search string (e.g. "repo:fess lang:java parse") into
 * structured qualifiers and free-text terms, then maps them to Fess/Lucene
 * field queries.
 *
 * String form used by addQualifier / removeQualifier:
 *   "field:value" for unquoted values, "field:\"value with spaces\"" for quoted.
 *   These functions operate on FESS-mapped field names (e.g. "repository", not "repo"),
 *   matching what Fess expects in its Lucene query string.
 *
 * Design decision — "or" operator handling:
 *   The literal token "or" (case-insensitive) is treated as a boolean operator
 *   and passed through as the string "OR" in the Fess query output.  It does not
 *   qualify as a key:value pair even if followed by a colon (e.g. "or:x" would
 *   be treated as an unknown qualifier and kept literally).
 */

// ---------------------------------------------------------------------------
// Qualifier map: user-typed prefix → Fess field name
// ---------------------------------------------------------------------------

export const QUALIFIER_MAP = {
  repo: 'repository',
  org: 'organization',
  path: 'path',
  file: 'filename',
  lang: 'filetype',
};

// ---------------------------------------------------------------------------
// Tokenizer helpers
// ---------------------------------------------------------------------------

/**
 * Tokenize a raw query string into an array of raw token strings.
 * Respects double-quoted values: `path:"src/main app"` yields one token.
 * A token is one of:
 *   - key:"quoted value"
 *   - key:unquoted-value
 *   - "quoted bare word"
 *   - bare word (including operator tokens like "or")
 * Leading `-` (for negation) is kept as part of the token.
 */
function tokenize(input) {
  const tokens = [];
  // Regex: optionally a leading -, then either key:"…" | key:word | "…" | word
  const re = /(-?[A-Za-z0-9_.*/-]+:"[^"]*"|-?[A-Za-z0-9_.*/-]+:[^\s"]+|"[^"]*"|-?[^\s"]+)/g;
  let m;
  while ((m = re.exec(input)) !== null) {
    tokens.push(m[1]);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// parseQuery
// ---------------------------------------------------------------------------

/**
 * Parse a raw query string into structured parts.
 *
 * @param {string} input  Raw query string, e.g. "repo:fess -lang:python parse"
 * @returns {{ terms: string[], qualifiers: Array<{key: string, value: string, negate: boolean}> }}
 *
 * Tokens of the form [−]key:value are qualifiers.
 * The literal token "or" (case-insensitive) is treated as an operator and put into terms.
 * Everything else is a free term.
 */
export function parseQuery(input) {
  if (!input || !input.trim()) {
    return { terms: [], qualifiers: [] };
  }

  const tokens = tokenize(input.trim());
  const terms = [];
  const qualifiers = [];

  for (const raw of tokens) {
    // Check for negation prefix
    const negate = raw.startsWith('-');
    const token = negate ? raw.slice(1) : raw;

    // Check for key:value form
    const colonIdx = token.indexOf(':');
    if (colonIdx > 0) {
      const key = token.slice(0, colonIdx);
      let value = token.slice(colonIdx + 1);

      // Strip surrounding quotes from value if present
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }

      qualifiers.push({ key, value, negate });
    } else {
      // Bare word or operator
      // Strip surrounding quotes from quoted bare words
      let word = token;
      if (word.startsWith('"') && word.endsWith('"')) {
        word = word.slice(1, -1);
      }
      terms.push(negate ? `-${word}` : word);
    }
  }

  return { terms, qualifiers };
}

// ---------------------------------------------------------------------------
// toFessQuery
// ---------------------------------------------------------------------------

/**
 * Convert a parsed query object to a Fess/Lucene query string.
 *
 * - Known qualifiers (in QUALIFIER_MAP) are mapped: repo → repository, etc.
 * - Unknown qualifiers are kept as literal key:value Lucene field queries.
 * - Negated qualifiers → "NOT field:value".
 * - Negated free terms → "NOT word".
 * - The operator term "or" (any case) → "OR".
 * - Values containing spaces are double-quoted.
 *
 * @param {{ terms: string[], qualifiers: Array<{key: string, value: string, negate: boolean}> }} parsed
 * @returns {string}
 */
export function toFessQuery(parsed) {
  const parts = [];

  for (const { key, value, negate } of parsed.qualifiers) {
    const field = QUALIFIER_MAP[key] !== undefined ? QUALIFIER_MAP[key] : key;
    const quotedValue = value.includes(' ') ? `"${value}"` : value;
    const fieldExpr = `${field}:${quotedValue}`;
    parts.push(negate ? `NOT ${fieldExpr}` : fieldExpr);
  }

  for (const term of parsed.terms) {
    // Negated terms are stored with a leading '-'
    if (term.startsWith('-')) {
      parts.push(`NOT ${term.slice(1)}`);
    } else if (term.toLowerCase() === 'or') {
      parts.push('OR');
    } else {
      parts.push(term);
    }
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// addQualifier
// ---------------------------------------------------------------------------

/**
 * Append a Fess-mapped qualifier to the raw input string.
 *
 * Operates on the FESS field name (e.g. "repository"), NOT the user-typed
 * prefix ("repo").  Deduplicates: if the exact "field:value" token already
 * appears in the string, the input is returned unchanged.
 *
 * @param {string} input       Raw query string (may already contain qualifiers)
 * @param {string} mappedField Fess field name, e.g. "repository"
 * @param {string} value       Field value
 * @returns {string}
 */
export function addQualifier(input, mappedField, value) {
  const quotedValue = value.includes(' ') ? `"${value}"` : value;
  const token = `${mappedField}:${quotedValue}`;

  // Deduplicate: check whether the token already exists
  if (_containsToken(input, token)) {
    return input;
  }

  const base = input ? input.trim() : '';
  return base ? `${base} ${token}` : token;
}

// ---------------------------------------------------------------------------
// removeQualifier
// ---------------------------------------------------------------------------

/**
 * Remove an existing "field:value" (or negated "-field:value") token from
 * the raw input string.  Collapses extra whitespace in the result.
 *
 * @param {string} input       Raw query string
 * @param {string} mappedField Fess field name, e.g. "repository"
 * @param {string} value       Field value
 * @returns {string}
 */
export function removeQualifier(input, mappedField, value) {
  if (!input) return '';

  const quotedValue = value.includes(' ') ? `"${value}"` : value;
  // Build a regex that matches the token with or without a leading '-'
  // Escape special regex characters in field and value
  const escaped = _reEscape(`${mappedField}:${quotedValue}`);
  const re = new RegExp(`-?${escaped}`, 'g');
  return input.replace(re, '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Return true if the exact token appears as a standalone word in str. */
function _containsToken(str, token) {
  if (!str) return false;
  // Simple whole-word check using a boundary pattern
  const escaped = _reEscape(token);
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(str);
}

/** Escape a string for use inside a RegExp. */
function _reEscape(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
