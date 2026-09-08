// ABOUTME: Textual redaction of credential-bearing components from URLs before they reach the model.
// ABOUTME: Presentation-only — callers keep fetching and comparing the raw URL.

const REDACTED = '[REDACTED]';

const SENSITIVE_PARAMS = [
  'code',
  'token',
  'secret',
  'password',
  'passwd',
  'pwd',
  'key',
  'apikey',
  'auth',
  'authorization',
  'credential',
  'credentials',
  'accesskeyid',
  'session',
  'sessionid',
  'sid',
  'sig',
  'signature',
  'jwt',
  'bearer',
  'hmac',
  'sas',
];

// A parameter value that is itself a URL gets recursed into; a URL nested
// inside a URL nested inside a URL is pathological, and the cap keeps a
// hand-crafted chain of encodings from turning into unbounded work.
const MAX_NESTED_URL_DEPTH = 3;

/**
 * Strip credentials out of a URL before it is shown to the model. URLs carry
 * secrets as routinely as headers do — OAuth codes and tokens, pre-signed S3
 * and SAS signatures, API keys pasted into a query string — and the redirect
 * destination the tool reports is exactly where those turn up.
 *
 * Purely textual: scheme, host, path and every parameter name survive so the
 * request is still diagnosable, and only values are replaced. Nothing here
 * feeds `isSameUrl`, so redaction cannot invent a redirect. Redacting an
 * already-redacted URL is a no-op, so the layers can safely overlap.
 */
export function redactSensitiveUrl(url: string): string {
  return redactUrlAtDepth(url, 0);
}

function redactUrlAtDepth(url: string, depth: number): string {
  const hashIndex = url.indexOf('#');
  const beforeFragment = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? undefined : url.slice(hashIndex + 1);

  const queryIndex = beforeFragment.indexOf('?');
  const origin = queryIndex === -1 ? beforeFragment : beforeFragment.slice(0, queryIndex);
  const query = queryIndex === -1 ? undefined : beforeFragment.slice(queryIndex + 1);

  // `https://user:pass@host/` hands over a password in the clear; the
  // username is half a credential too, so the whole userinfo goes.
  let redacted = origin.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/?#]*@/, `$1${REDACTED}@`);

  if (query !== undefined) {
    redacted += `?${redactSensitiveParams(query, depth)}`;
  }

  if (fragment !== undefined) {
    // Implicit-flow tokens ride in the fragment as a query string; a plain
    // anchor (`#install`) is worth keeping intact.
    redacted += `#${
      fragment.includes('=')
        ? redactSensitiveParams(fragment, depth)
        : isCredentialShapedValue(fragment)
          ? REDACTED
          : fragment
    }`;
  }

  return redacted;
}

// Anything that looks like `scheme://…` and runs to the first whitespace or
// quoting character. Free-form error text is all we have to go on when an
// error message came from a program that quoted the URL back at us.
const URL_IN_TEXT_RE = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s<>"'`]+/g;
// A URL at the end of a sentence takes the punctuation with it; leave the
// trailing run outside the redacted span rather than treating it as URL.
const TRAILING_PUNCTUATION_RE = /[.,;:!?)\]}>'"]+$/;

/**
 * Redact every URL-shaped span in free-form text — an error message from curl,
 * from `fetch`, or from anything else that quoted the request back at us.
 *
 * This is a backstop, not a parser. It only finds URLs carrying an explicit
 * scheme, and it stops at the first whitespace, so a URL the source wrapped,
 * re-encoded, or split cannot be caught here. Callers that know the exact URL
 * should also replace that known string outright.
 */
export function redactUrlsInText(text: string): string {
  return text.replace(URL_IN_TEXT_RE, (match) => {
    const trailing = trailingPunctuationOf(match);
    const url = trailing.length === 0 ? match : match.slice(0, -trailing.length);
    return `${redactSensitiveUrl(url)}${trailing}`;
  });
}

/**
 * The trailing punctuation the surrounding prose contributed, not the URL.
 *
 * The sentinel ends in `]`, which is punctuation. A URL that has already been
 * redacted at the throw site arrives here as `…code=[REDACTED]`; trimming that
 * `]` off would hand the rest back for a second redaction pass and re-emit the
 * closing bracket, printing `code=[REDACTED]]`. So only the run *after* the
 * last sentinel is ever eligible.
 */
function trailingPunctuationOf(match: string): string {
  const sentinelStart = match.lastIndexOf(REDACTED);
  const tailStart = sentinelStart === -1 ? 0 : sentinelStart + REDACTED.length;
  return TRAILING_PUNCTUATION_RE.exec(match.slice(tailStart))?.[0] ?? '';
}

function redactSensitiveParams(query: string, depth: number): string {
  // `;` is a legacy query separator alongside `&`. Splitting with a capturing
  // group keeps whichever one the URL actually used in place.
  return query
    .split(/([&;])/)
    .map((part, index) => (index % 2 === 1 ? part : redactSensitiveParam(part, depth)))
    .join('');
}

function redactSensitiveParam(pair: string, depth: number): string {
  const separator = pair.indexOf('=');
  if (separator === -1) {
    return isCredentialShapedValue(pair) ? REDACTED : pair;
  }

  const name = pair.slice(0, separator);
  const value = pair.slice(separator + 1);
  if (value.length === 0) return pair;

  if (isSensitiveParamName(name) || isCredentialShapedValue(value)) {
    return `${name}=${REDACTED}`;
  }

  const nested = redactNestedUrl(value, depth);
  return nested === undefined ? pair : `${name}=${nested}`;
}

/**
 * A parameter value that is itself a URL carries its own query string, and
 * OAuth routinely puts a token in there: `?redirect_uri=…%3Ftoken%3D…`,
 * `?next=`, `?state=`. Neither the denylist (the outer name is benign) nor the
 * shape test (a URL has `:` and `?` in it) sees the credential, so recurse.
 *
 * Returns undefined when nothing changed, so a value that needed no redaction
 * comes back byte-identical rather than re-encoded.
 */
function redactNestedUrl(value: string, depth: number): string | undefined {
  if (depth >= MAX_NESTED_URL_DEPTH) return undefined;

  const decoded = decodeUrlComponent(value);
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(decoded)) return undefined;

  const redacted = redactUrlAtDepth(decoded, depth + 1);
  if (redacted === decoded) return undefined;
  if (decoded === value) return redacted;

  // Re-encode to the level the caller used, but keep the sentinel legible
  // rather than shipping `%5BREDACTED%5D` to the model.
  return encodeURIComponent(redacted).split(encodeURIComponent(REDACTED)).join(REDACTED);
}

function isSensitiveParamName(name: string): boolean {
  // Match whole words, not substrings: `api_key` and `X-Amz-Signature` are
  // credentials, `keywords` and `sort_order` are not.
  const words = decodeUrlComponent(name)
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  return words.some((word) => SENSITIVE_PARAMS.includes(word));
}

/**
 * A long opaque string is a credential whatever its parameter is called —
 * this is what catches token parameters the denylist has never heard of.
 *
 * "Opaque" is the load-bearing word. Values this long that carry a recognisable
 * identifier structure — a canonical UUID, or a run of words joined by `+`,
 * `-` or spaces — are the common long non-secrets of the web (record ids,
 * search queries, anchor slugs) and are left alone. Everything else long
 * enough, alphanumeric, and mixed letters-and-digits is redacted.
 */
function isCredentialShapedValue(value: string): boolean {
  const decoded = decodeUrlComponent(value);
  return (
    decoded.length >= 32 &&
    /^[A-Za-z0-9._~+/=-]+$/.test(decoded) &&
    /[A-Za-z]/.test(decoded) &&
    /[0-9]/.test(decoded) &&
    !isStructuredIdentifier(decoded)
  );
}

// `550e8400-e29b-41d4-a716-446655440000` — the 8-4-4-4-12 grouping is a
// format, not just an alphabet, and in a URL it is overwhelmingly a record id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A word: letters, optionally with a small number suffix (`today2`, `q3`), or
// a bare year/number. Random base64 segments are not shaped like this.
const WORD_SEGMENT_RE = /^(?:[A-Za-z]{1,24}[0-9]{0,4}|[0-9]{1,4})$/;
const WORD_SEPARATOR_RE = /[-+ ]+/;

function isStructuredIdentifier(value: string): boolean {
  return UUID_RE.test(value) || isWordJoinedText(value);
}

/**
 * Prose that arrived as one parameter value: a search query (`?q=how+do+i+…`,
 * where `+` is a space that `decodeURIComponent` does not decode), a slug, an
 * anchor. Demanding several genuinely alphabetic words keeps hyphenated or
 * `+`-bearing base64 out: its segments are long and mix digits throughout.
 */
function isWordJoinedText(value: string): boolean {
  const segments = value.split(WORD_SEPARATOR_RE);
  if (segments.length < 4) return false;
  if (!segments.every((segment) => WORD_SEGMENT_RE.test(segment))) return false;
  return segments.filter((segment) => /^[A-Za-z]{2,}$/.test(segment)).length >= 3;
}

function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
