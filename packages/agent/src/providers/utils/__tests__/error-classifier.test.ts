// ABOUTME: Unit tests for the HTTP error classifier that maps "prompt too long"
// ABOUTME: 400 responses into a NormalizedStop with stopReason='context_window_exceeded'

import { describe, it, expect } from 'vitest';
import { classifyHttpError } from '@lace/agent/providers/utils/error-classifier';

/**
 * Build a stub that mimics an `@anthropic-ai/sdk` `BadRequestError` instance
 * — the SDK exposes `status: 400`, `error: <parsed JSON body>`, `type` (the
 * `error.type` lifted from the body), and `message`. We don't extend the SDK
 * class because the classifier is intentionally SDK-agnostic and inspects
 * shape, not identity.
 */
function makeAnthropic400(body: { type: string; message: string }): {
  status: number;
  error: { error: { type: string; message: string } };
  type: string;
  message: string;
} {
  return {
    status: 400,
    // SDK stores the parsed JSON body — Anthropic's body shape is
    // `{ "type": "error", "error": { "type": "...", "message": "..." } }`.
    error: { error: { type: body.type, message: body.message } },
    type: body.type,
    message: body.message,
  };
}

function makeOpenAI400(body: { code: string; message: string; type?: string }): {
  status: number;
  error: { code: string; message: string; type?: string };
  code: string;
  message: string;
} {
  return {
    status: 400,
    // OpenAI's body shape: `{ "error": { "code": "...", "message": "...", "type": "..." } }`.
    error: { code: body.code, message: body.message, type: body.type },
    code: body.code,
    message: body.message,
  };
}

describe('classifyHttpError', () => {
  describe('Anthropic patterns', () => {
    it('classifies Anthropic 400 "prompt is too long" as context_window_exceeded', () => {
      const err = makeAnthropic400({
        type: 'invalid_request_error',
        message: 'prompt is too long: 250000 tokens > 200000 maximum',
      });

      const result = classifyHttpError(err);

      expect(result).toEqual({
        stopReason: 'context_window_exceeded',
        stopDetails: {
          type: 'context_window_exceeded',
          source: 'http_400_prompt_too_long',
        },
      });
    });

    it('returns null for the PRI-1796 tool_use ids 400 (not context-overflow)', () => {
      const err = makeAnthropic400({
        type: 'invalid_request_error',
        message:
          'messages.1298: `tool_use` ids were found without `tool_result` blocks immediately after',
      });

      expect(classifyHttpError(err)).toBeNull();
    });

    it('returns null for a 500 Anthropic api_error', () => {
      const err = {
        status: 500,
        error: { error: { type: 'api_error', message: 'Internal server error' } },
        type: 'api_error',
        message: 'Internal server error',
      };

      expect(classifyHttpError(err)).toBeNull();
    });

    it('returns null for a 429 Anthropic rate_limit_error', () => {
      const err = {
        status: 429,
        error: {
          error: { type: 'rate_limit_error', message: 'Number of request tokens has exceeded' },
        },
        type: 'rate_limit_error',
        message: 'Number of request tokens has exceeded',
      };

      expect(classifyHttpError(err)).toBeNull();
    });
  });

  describe('OpenAI patterns', () => {
    it('classifies OpenAI context_length_exceeded as context_window_exceeded', () => {
      const err = makeOpenAI400({
        code: 'context_length_exceeded',
        type: 'invalid_request_error',
        message: "This model's maximum context length is 128000 tokens, however you requested ...",
      });

      const result = classifyHttpError(err);

      expect(result).toEqual({
        stopReason: 'context_window_exceeded',
        stopDetails: {
          type: 'context_window_exceeded',
          source: 'http_400_prompt_too_long',
        },
      });
    });

    it('returns null for an unrelated OpenAI 400 invalid_request_error', () => {
      const err = makeOpenAI400({
        code: 'invalid_value',
        type: 'invalid_request_error',
        message: 'Unknown parameter: foo',
      });

      expect(classifyHttpError(err)).toBeNull();
    });
  });

  describe('non-error inputs', () => {
    it('returns null for null', () => {
      expect(classifyHttpError(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(classifyHttpError(undefined)).toBeNull();
    });

    it('returns null for a plain string', () => {
      expect(classifyHttpError('prompt is too long')).toBeNull();
    });

    it('returns null for a plain Error with the matching message but no status', () => {
      // Defensive: we require some signal that this is an HTTP 400, not just
      // a substring match on an arbitrary Error instance.
      expect(classifyHttpError(new Error('prompt is too long'))).toBeNull();
    });

    it('returns null for an object with status but no recognizable body', () => {
      expect(classifyHttpError({ status: 400, message: 'nope' })).toBeNull();
    });
  });

  describe('classifier invariants', () => {
    it('only returns context_window_exceeded stop reasons when it returns non-null', () => {
      const matches = [
        makeAnthropic400({
          type: 'invalid_request_error',
          message: 'prompt is too long: 1 tokens > 0 maximum',
        }),
        makeOpenAI400({
          code: 'context_length_exceeded',
          message: 'too long',
        }),
      ];
      for (const err of matches) {
        const result = classifyHttpError(err);
        expect(result).not.toBeNull();
        // Narrowed return type lets us read stopDetails.source directly — no
        // discriminated-union narrowing required.
        expect(result!.stopReason).toBe('context_window_exceeded');
        expect(result!.stopDetails.source).toBe('http_400_prompt_too_long');
      }
    });

    it('case-insensitive Anthropic message match', () => {
      const err = makeAnthropic400({
        type: 'invalid_request_error',
        message: 'PROMPT IS TOO LONG: 250000 tokens > 200000 maximum',
      });

      expect(classifyHttpError(err)?.stopReason).toBe('context_window_exceeded');
    });
  });
});
