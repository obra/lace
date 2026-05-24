// ABOUTME: Classifies HTTP 400 errors from Anthropic/OpenAI SDKs into a context_window_exceeded stop
// ABOUTME: Deliberately narrow whitelist — adding a pattern requires a fixture and an explicit comment

import type { ProviderResponse } from '@lace/agent/providers/base-provider';
import { logger } from '@lace/agent/utils/logger';

/**
 * Why a deliberately narrow whitelist?
 *
 * Many HTTP 400 responses are legitimate hard failures the agent SHOULD surface
 * by throwing (e.g. PRI-1796: malformed `tool_use`/`tool_result` pairing).
 * Silently swallowing them as "context window exceeded" would hide real bugs
 * and corrupt telemetry.
 *
 * The only 400s we classify here are the ones that have a single, unambiguous
 * meaning of "the prompt was too large for the model" — recoverable by
 * compaction. Each pattern below is documented inline with the provider source
 * signal we're matching on. Adding a new pattern is a deliberate act: write a
 * fixture for it first, then add the pattern.
 *
 * Patterns:
 *   1. Anthropic — body `error.message` matches `/prompt is too long/i`.
 *   2. OpenAI — body `error.code === 'context_length_exceeded'`.
 *
 * The classifier inspects unknown shapes cautiously (no SDK class instanceof
 * checks) so it works uniformly across `@anthropic-ai/sdk`,
 * `@anthropic-ai/bedrock-sdk`, and `openai`.
 */

/** Shape we need from an SDK-thrown HTTP error. Everything is optional — we probe. */
interface InspectableHttpError {
  status?: number;
  statusCode?: number;
  message?: string;
  code?: string;
  type?: string;
  // SDKs store the parsed JSON body in `error`. Anthropic nests it once more:
  // the outer object is `{ type: 'error', error: { type, message } }`.
  error?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function inspect(err: unknown): InspectableHttpError | null {
  if (!isObject(err)) return null;
  return err as InspectableHttpError;
}

function getStatus(err: InspectableHttpError): number | null {
  if (typeof err.status === 'number') return err.status;
  if (typeof err.statusCode === 'number') return err.statusCode;
  return null;
}

/** Extract Anthropic's body `{type, message}` from either flat or nested shapes. */
function getAnthropicBody(err: InspectableHttpError): { type?: string; message?: string } | null {
  // Flat: SDK lifts `error.type` / `error.message` to top-level on some paths.
  if (typeof err.type === 'string' || typeof err.message === 'string') {
    // Only treat top-level as the body if `error` is missing or doesn't contain
    // a parsed body. Otherwise prefer the parsed body for fidelity.
    if (!isObject(err.error)) {
      return { type: err.type, message: err.message };
    }
  }

  // Nested: SDK stores `error: { type: 'error', error: { type, message } }`
  if (isObject(err.error)) {
    const outer = err.error as Record<string, unknown>;
    if (isObject(outer.error)) {
      const inner = outer.error as Record<string, unknown>;
      const innerType = typeof inner.type === 'string' ? inner.type : undefined;
      const innerMessage = typeof inner.message === 'string' ? inner.message : undefined;
      return { type: innerType, message: innerMessage };
    }
    // Less nested: `error: { type, message }` directly
    const outerType = typeof outer.type === 'string' ? outer.type : undefined;
    const outerMessage = typeof outer.message === 'string' ? outer.message : undefined;
    if (outerType || outerMessage) {
      return { type: outerType, message: outerMessage };
    }
  }

  return null;
}

/** Extract OpenAI's body `{code, message}` from `error: { code, message, type }`. */
function getOpenAIBody(
  err: InspectableHttpError
): { code?: string; message?: string; type?: string } | null {
  if (isObject(err.error)) {
    const body = err.error as Record<string, unknown>;
    const code = typeof body.code === 'string' ? body.code : undefined;
    const message = typeof body.message === 'string' ? body.message : undefined;
    const type = typeof body.type === 'string' ? body.type : undefined;
    if (code || message || type) {
      return { code, message, type };
    }
  }
  // SDK also lifts `code` to top-level on its APIError class
  if (typeof err.code === 'string') {
    return { code: err.code, message: err.message, type: err.type };
  }
  return null;
}

interface ClassifierPattern {
  /** Human description for grepability. */
  description: string;
  /** Returns true when this error matches the pattern. Must check status code. */
  matches: (err: InspectableHttpError) => boolean;
}

const PATTERNS: readonly ClassifierPattern[] = [
  {
    // Anthropic 400 "prompt is too long: N tokens > M maximum" — direct API and
    // Bedrock both emit this. The body type is `invalid_request_error`. We
    // match on the message substring (case-insensitive) to handle both the
    // direct API wording and any minor variants.
    description: 'Anthropic 400 "prompt is too long"',
    matches: (err) => {
      if (getStatus(err) !== 400) return false;
      const body = getAnthropicBody(err);
      if (!body || body.type !== 'invalid_request_error') return false;
      return typeof body.message === 'string' && /prompt is too long/i.test(body.message);
    },
  },
  {
    // OpenAI 400 with `error.code === 'context_length_exceeded'`. This is the
    // canonical signal — message text is unstable across models, but the code
    // is documented.
    description: 'OpenAI context_length_exceeded',
    matches: (err) => {
      if (getStatus(err) !== 400) return false;
      const body = getOpenAIBody(err);
      return body?.code === 'context_length_exceeded';
    },
  },
];

/**
 * Narrow result type for the classifier. Every match is a context-window
 * overflow from a recognized HTTP 400 — there is no other classification path
 * here, so callers don't need to discriminate a wider union to read `source`.
 */
export interface ContextWindowExceededClassification {
  stopReason: 'context_window_exceeded';
  stopDetails: {
    type: 'context_window_exceeded';
    source: 'http_400_prompt_too_long';
  };
}

/**
 * Inspect a thrown provider error. If it matches a whitelisted "prompt too
 * long" pattern, return a classification with
 * `stopReason: 'context_window_exceeded'`. Otherwise return `null` — caller
 * should rethrow as before.
 *
 * Accepts `unknown` so callers can drop it straight into a `catch (err)` block
 * without narrowing.
 */
export function classifyHttpError(err: unknown): ContextWindowExceededClassification | null {
  const inspectable = inspect(err);
  if (!inspectable) return null;

  for (const pattern of PATTERNS) {
    if (pattern.matches(inspectable)) {
      return {
        stopReason: 'context_window_exceeded',
        stopDetails: {
          type: 'context_window_exceeded',
          source: 'http_400_prompt_too_long',
        },
      };
    }
  }
  return null;
}

/**
 * Convenience for provider `catch` blocks: if `err` classifies as a recoverable
 * context-window overflow, log it at INFO and return a synthetic
 * `ProviderResponse` (empty content, zeroed usage, stop reason set). Otherwise
 * return `null` so the caller can fall through to its existing rethrow path.
 *
 * `providerLabel` is the human-readable provider/path label embedded in the log
 * message (e.g. `'AnthropicProvider'`, `'AnthropicProvider (streaming)'`).
 */
export function tryClassifyAsContextWindow(
  err: unknown,
  providerLabel: string
): ProviderResponse | null {
  const classified = classifyHttpError(err);
  if (!classified) return null;

  logger.info(`${providerLabel}: HTTP error classified as context_window_exceeded`, {
    source: classified.stopDetails.source,
  });

  return {
    content: '',
    toolCalls: [],
    stopReason: classified.stopReason,
    stopDetails: classified.stopDetails,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}
