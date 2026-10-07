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
 *
 * Design decision — qualifier values are escaped:
 *   A value is data, not query syntax, so the Lucene characters in it are escaped
 *   ("path:src/main" is sent as `path:src\/main*`). Left bare, a "/" opens a regex and
 *   the query no longer parses; Fess then escapes the WHOLE query and the filter
 *   silently vanishes. A backslash already in the value escapes the next character
 *   (as in Lucene), so a query that was escaped once is not escaped again. "*" and "?"
 *   stay wildcards, and a range such as `content_length:[1 TO 5]` is passed as typed.
 *   Free text is not escaped: it may carry Lucene syntax on purpose ("foo*", "(a OR b)").
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
 * Unbalanced quotes in key:"value form are tolerated (closing quote is optional).
 * A token is one of:
 *   - key:[a TO b] / key:{a TO b}  (a range, spaces and all)
 *   - key:"quoted value"
 *   - key:unquoted-value
 *   - "quoted phrase", optionally followed by a ~N proximity
 *   - bare word (including operator tokens like "or")
 * Leading `-` (for negation) is kept as part of the token.
 */
function tokenize(input) {
  const tokens = [];
  // Regex: optionally a leading -, then either key:[…] | key:"…" | key:word | "…"~N | word
  const re = /(-?[A-Za-z0-9_.*/-]+:[[{][^\]}]*\sTO\s[^\]}]*[\]}](?=\s|$)|-?[A-Za-z0-9_.*/-]+:"[^"]*"?|-?[A-Za-z0-9_.*/-]+:[^\s"]+|-?"[^"]*"(?:~\d+)?|-?[^\s"]+)/g;
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
 * @returns {{ terms: string[], qualifiers: Array<{key: string, value: string, negate: boolean, quoted: boolean, range: boolean}> }}
 *
 * Tokens of the form [−]key:value are qualifiers; `quoted` says the value was typed in
 * double quotes, `range` that it is a [a TO b] / {a TO b} range (kept as typed).
 * The literal token "or" (case-insensitive) is treated as an operator and put into terms.
 * A "quoted phrase" (with its quotes, and its ~N if any) is one free term, whatever it
 * holds. A token starting with two hyphens is text, not a negation: it is a free term
 * as typed. Everything else is a free term.
 */
export function parseQuery(input) {
  if (!input || !input.trim()) {
    return { terms: [], qualifiers: [] };
  }

  const tokens = tokenize(input.trim());
  const terms = [];
  const qualifiers = [];

  for (const raw of tokens) {
    // "--verbose" is what the user is looking for, not a negated "-verbose".
    if (raw.startsWith('--')) {
      terms.push(raw);
      continue;
    }

    // Check for negation prefix
    const negate = raw.startsWith('-');
    const token = negate ? raw.slice(1) : raw;

    // A phrase is one term even when it holds a colon ("case x: break").
    if (token.startsWith('"')) {
      if (!token.startsWith('""')) {
        terms.push(negate ? `-${token}` : token);
      }
      continue;
    }

    // Check for key:value form
    const colonIdx = token.indexOf(':');
    if (colonIdx > 0) {
      const key = token.slice(0, colonIdx);
      let value = token.slice(colonIdx + 1);

      // Strip surrounding quotes from value if present (balanced or leading-only for unbalanced)
      const quoted = value.startsWith('"');
      if (quoted && value.endsWith('"') && value.length > 1) {
        value = value.slice(1, -1);
      } else if (quoted) {
        // Unbalanced quote: strip the leading quote only
        value = value.slice(1);
      }

      qualifiers.push({ key, value, negate, quoted, range: !quoted && RANGE_RE.test(value) });
    } else {
      // Bare word or operator
      terms.push(negate ? `-${token}` : token);
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
 * - Qualifier values are escaped (see qualifierToFess).
 * - Negated qualifiers → "NOT field:value".
 * - Negated free terms → "NOT word".
 * - A term of two or more leading hyphens is text → a "quoted" phrase.
 * - The operator term "or" (any case) → "OR".
 * - Values containing spaces are double-quoted.
 *
 * @param {{ terms: string[], qualifiers: Array<{key: string, value: string, negate: boolean, quoted: boolean, range: boolean}> }} parsed
 * @returns {string}
 */
export function toFessQuery(parsed) {
  const parts = [];

  for (const qualifier of parsed.qualifiers) {
    parts.push(qualifierToFess(qualifier));
  }

  for (const term of parsed.terms) {
    if (term.startsWith('--')) {
      parts.push(`"${escapeQuoted(term)}"`);
    } else if (term.startsWith('-')) {
      // Negated terms are stored with a leading '-'
      parts.push(`NOT ${term.slice(1)}`);
    } else if (term.toLowerCase() === 'or') {
      parts.push('OR');
    } else {
      parts.push(term);
    }
  }

  return parts.join(' ');
}

/**
 * One parsed qualifier as the clause Fess is sent.
 *
 * - A range is passed as typed.
 * - A value with white space is quoted, as is a quoted `path` value: quotes make it exact.
 * - Any other value is escaped (see escapeValue).
 * - An unquoted `path` value without a wildcard is a prefix, so `path:src/main` finds
 *   every file under src/main: `*` is appended. A wildcard the user typed is kept as typed.
 *
 * @param {{key: string, value: string, negate: boolean, quoted: boolean, range: boolean}} qualifier
 * @returns {string}
 */
export function qualifierToFess({ key, value, negate, quoted, range }) {
  const field = escapeValue(Object.hasOwn(QUALIFIER_MAP, key) ? QUALIFIER_MAP[key] : key);
  let clause;
  if (range) {
    clause = `${field}:${value}`;
  } else if (/\s/.test(value) || (quoted && field === 'path')) {
    clause = `${field}:"${escapeQuoted(value)}"`;
  } else {
    const escaped = escapeValue(value);
    const prefix = field === 'path' && escaped !== '' && !HAS_WILDCARD_RE.test(escaped);
    clause = `${field}:${escaped}${prefix ? '*' : ''}`;
  }
  return negate ? `NOT ${clause}` : clause;
}

/**
 * One parsed qualifier as it is typed in the box: `[-]key:value`, quoted when the value
 * was or must be. A range is not quoted.
 */
export function qualifierText({ key, value, negate, quoted, range }) {
  const text = !range && (quoted || value.includes(' ')) ? `"${value}"` : value;
  return `${negate ? '-' : ''}${key}:${text}`;
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

  // Remove any existing negated form to avoid contradictory tokens like
  // `-repository:fess repository:fess`.
  let base = input ? input.trim() : '';
  if (base) {
    // Strip -field:value
    const negToken = `-${token}`;
    const escapedNeg = _reEscape(negToken);
    base = base.replace(new RegExp(`(?:^|\\s)${escapedNeg}(?=\\s|$)`, 'g'), ' ').replace(/\s+/g, ' ').trim();
    // Strip NOT field:value
    const notToken = `NOT ${token}`;
    const escapedNot = _reEscape(notToken);
    base = base.replace(new RegExp(`(?:^|\\s)${escapedNot}(?=\\s|$)`, 'g'), ' ').replace(/\s+/g, ' ').trim();
  }

  // Deduplicate: check whether the positive token already exists
  if (_containsToken(base, token)) {
    return base;
  }

  return base ? `${base} ${token}` : token;
}

// ---------------------------------------------------------------------------
// removeQualifier
// ---------------------------------------------------------------------------

/**
 * Remove an existing "field:value" (or negated "-field:value") token from
 * the raw input string.  Collapses extra whitespace in the result.
 * A value without spaces is also removed when it was typed in quotes
 * (`path:"src/main"`), which is how an exact `path:` value is written.
 *
 * @param {string} input       Raw query string
 * @param {string} mappedField Fess field name, e.g. "repository"
 * @param {string} value       Field value
 * @returns {string}
 */
export function removeQualifier(input, mappedField, value) {
  if (!input) return '';

  const quotedToken = `${mappedField}:"${value}"`;
  const tokens = value.includes(' ') ? [quotedToken] : [`${mappedField}:${value}`, quotedToken];
  const escaped = `(?:${tokens.map(_reEscape).join('|')})`;

  // Remove the positive token (optionally negated with a leading '-')
  let result = input.replace(
    new RegExp(`(?:^|(?<=\\s))-?${escaped}(?=\\s|$)`, 'g'),
    ''
  );
  // Remove the NOT form: "NOT field:value"
  result = result.replace(
    new RegExp(`(?:^|(?<=\\s))NOT\\s+${escaped}(?=\\s|$)`, 'g'),
    ''
  );
  return result.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** A range value: [a TO b], {a TO b} or a mix of the two. */
const RANGE_RE = /^[[{][^\]}]*\sTO\s[^\]}]*[\]}]$/;

/** An unescaped * or ? in an escaped value: pairs `\x` and plain characters, then the wildcard. */
const HAS_WILDCARD_RE = /^(?:[^\\*?]|\\[^])*[*?]/;

/**
 * Escape the characters of a value that the Lucene classic parser reads as syntax.
 *
 * - `/ : ( ) [ ] { } ^ ~ ! "` are escaped wherever they are, `+` and `-` only at the
 *   start (inside a term they are plain, so `fess-crawler` is left alone), `&&` and `||`.
 * - `*` and `?` stay: they are the wildcards the user typed.
 * - A backslash and the character after it are one escape already, and are kept; a lone
 *   trailing backslash is doubled. So an escaped value is not escaped again.
 */
function escapeValue(value) {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '\\') {
      out += i + 1 < value.length ? c + value[++i] : '\\\\';
    } else if ('/:()[]{}^~!"'.includes(c) || (i === 0 && (c === '+' || c === '-'))) {
      out += '\\' + c;
    } else if ((c === '&' || c === '|') && value[i + 1] === c) {
      out += '\\' + c + '\\' + c;
      i++;
    } else {
      out += c;
    }
  }
  return out;
}

/** Escape the text of a "quoted" phrase: only a backslash and the quote itself can matter there. */
function escapeQuoted(value) {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '\\') {
      out += i + 1 < value.length ? c + value[++i] : '\\\\';
    } else {
      out += c === '"' ? '\\"' : c;
    }
  }
  return out;
}

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
