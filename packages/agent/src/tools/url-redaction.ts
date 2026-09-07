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
  'sig',
  'signature',
  'jwt',
  'bearer',
  'hmac',
  'sas',
];

/**
 * Strip credentials out of a URL before it is shown to the model. URLs carry
 * secrets as routinely as headers do — OAuth codes and tokens, pre-signed S3
 * and SAS signatures, API keys pasted into a query string — and the redirect
 * destination the tool reports is exactly where those turn up.
 *
 * Purely textual: scheme, host, path and every parameter name survive so the
 * request is still diagnosable, and only values are replaced. Nothing here
 * feeds `isSameUrl`, so redaction cannot invent a redirect.
 */
export function redactSensitiveUrl(url: string): string {
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
    redacted += `?${redactSensitiveParams(query)}`;
  }

  if (fragment !== undefined) {
    // Implicit-flow tokens ride in the fragment as a query string; a plain
    // anchor (`#install`) is worth keeping intact.
    redacted += `#${
      fragment.includes('=')
        ? redactSensitiveParams(fragment)
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
    const trailing = TRAILING_PUNCTUATION_RE.exec(match)?.[0] ?? '';
    const url = trailing.length === 0 ? match : match.slice(0, -trailing.length);
    return `${redactSensitiveUrl(url)}${trailing}`;
  });
}

function redactSensitiveParams(query: string): string {
  return query
    .split('&')
    .map((pair) => {
      const separator = pair.indexOf('=');
      if (separator === -1) {
        return isCredentialShapedValue(pair) ? REDACTED : pair;
      }

      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value.length === 0) return pair;

      return isSensitiveParamName(name) || isCredentialShapedValue(value)
        ? `${name}=${REDACTED}`
        : pair;
    })
    .join('&');
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
 * Values this long that happen not to be secrets lose nothing but noise.
 */
function isCredentialShapedValue(value: string): boolean {
  const decoded = decodeUrlComponent(value);
  return (
    decoded.length >= 32 &&
    /^[A-Za-z0-9._~+/=-]+$/.test(decoded) &&
    /[A-Za-z]/.test(decoded) &&
    /[0-9]/.test(decoded)
  );
}

function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
