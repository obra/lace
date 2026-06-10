// ABOUTME: Tests the lone-surrogate sanitizer that keeps Anthropic request bodies well-formed.

import { describe, expect, it } from 'vitest';
import { sanitizeLoneSurrogates } from '../well-formed-json.js';

const HIGH = '\uD83D'; // lone high surrogate (the lead half of 😀)
const LOW = '\uDE00'; // lone low surrogate (the trail half of 😀)
const EMOJI = '😀'; // 😀 — a valid surrogate pair

describe('sanitizeLoneSurrogates', () => {
  it('replaces a lone high surrogate with U+FFFD', () => {
    expect(sanitizeLoneSurrogates(`hi ${HIGH}`)).toBe('hi �');
  });

  it('replaces a lone low surrogate with U+FFFD', () => {
    expect(sanitizeLoneSurrogates(`${LOW} bye`)).toBe('� bye');
  });

  it('leaves a valid surrogate pair (emoji) intact', () => {
    expect(sanitizeLoneSurrogates(`ok ${EMOJI}!`)).toBe(`ok ${EMOJI}!`);
  });

  it('round-trips through JSON.parse after JSON.stringify (the actual failure mode)', () => {
    const sanitized = sanitizeLoneSurrogates({ text: `trunc ${HIGH}` });
    // A lone surrogate makes the serialized body invalid for strict JSON parsers
    // (Anthropic rejects it). After sanitizing, it parses cleanly.
    expect(() => JSON.parse(JSON.stringify(sanitized))).not.toThrow();
  });

  it('sanitizes strings deep inside nested message structure', () => {
    const payload = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: `clean` }] },
        { role: 'assistant', content: [{ type: 'text', text: `bad ${HIGH} tail` }] },
      ],
      system: [{ type: 'text', text: `sys ${LOW}` }],
    };
    const out = sanitizeLoneSurrogates(payload);
    expect(out.messages[1]?.content[0]?.text).toBe('bad � tail');
    expect(out.system[0]?.text).toBe('sys �');
    // Clean content is untouched.
    expect(out.messages[0]?.content[0]?.text).toBe('clean');
  });

  it('returns the SAME reference when nothing needs fixing (preserves cache identity)', () => {
    const clean = { messages: [{ role: 'user', content: `hello ${EMOJI}` }] };
    expect(sanitizeLoneSurrogates(clean)).toBe(clean);
  });

  it('passes through non-string primitives unchanged', () => {
    expect(sanitizeLoneSurrogates(42)).toBe(42);
    expect(sanitizeLoneSurrogates(null)).toBe(null);
    expect(sanitizeLoneSurrogates(true)).toBe(true);
  });
});
