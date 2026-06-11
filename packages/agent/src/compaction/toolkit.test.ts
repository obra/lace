// ABOUTME: Tests compaction toolkit helpers, incl. surrogate-safe truncation tails.

import { describe, expect, it } from 'vitest';
import { stripTrailingLoneSurrogate } from './toolkit.js';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const EMOJI = '😀'; // U+1F600 = '😀'

describe('stripTrailingLoneSurrogate', () => {
  it('drops a trailing lone high surrogate left by a mid-emoji slice', () => {
    // Slice an emoji in half: keep the lead surrogate, drop the trail.
    const torn = `done ${EMOJI}`.slice(0, 'done '.length + 1); // 'done \uD83D'
    expect(LONE_SURROGATE.test(torn)).toBe(true); // precondition: it IS torn
    const fixed = stripTrailingLoneSurrogate(torn);
    expect(LONE_SURROGATE.test(fixed)).toBe(false);
    expect(fixed).toBe('done ');
    // The real failure mode — strict JSON round-trip — now succeeds.
    expect(() => JSON.parse(JSON.stringify({ t: fixed }))).not.toThrow();
  });

  it('leaves a string ending in a complete emoji intact', () => {
    expect(stripTrailingLoneSurrogate(`hi ${EMOJI}`)).toBe(`hi ${EMOJI}`);
  });

  it('leaves an ordinary string and the empty string unchanged', () => {
    expect(stripTrailingLoneSurrogate('hello')).toBe('hello');
    expect(stripTrailingLoneSurrogate('')).toBe('');
  });
});
