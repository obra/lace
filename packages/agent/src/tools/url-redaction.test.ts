// ABOUTME: Unit tests for the URL credential redactor's parameter, shape and nesting rules.
// ABOUTME: Asserts exact output, so an over-redaction or a doubled sentinel fails the test.

import { describe, it, expect } from 'vitest';
import { redactSensitiveUrl, redactUrlsInText } from '@lace/agent/tools/url-redaction';

describe('redactSensitiveUrl', () => {
  describe('credentials nested inside a parameter value', () => {
    it('redacts a token inside a percent-encoded redirect_uri', () => {
      expect(
        redactSensitiveUrl(
          'https://example.com/authorize?redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb%3Ftoken%3Dsecret123&client=web'
        )
      ).toBe(
        'https://example.com/authorize?redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb%3Ftoken%3D[REDACTED]&client=web'
      );
    });

    it('redacts a token inside an unencoded nested URL', () => {
      expect(
        redactSensitiveUrl('https://example.com/go?next=https://app.example.com/cb?code=abc123')
      ).toBe('https://example.com/go?next=https://app.example.com/cb?code=[REDACTED]');
    });

    it('redacts a token nested two encodings deep', () => {
      const inner = encodeURIComponent('https://b.example.com/cb?token=secret123');
      const middle = encodeURIComponent(`https://a.example.com/cb?next=${inner}`);

      expect(redactSensitiveUrl(`https://example.com/go?next=${middle}`)).toBe(
        'https://example.com/go?next=https%3A%2F%2Fa.example.com%2Fcb%3Fnext%3D' +
          'https%253A%252F%252Fb.example.com%252Fcb%253Ftoken%253D[REDACTED]'
      );
    });

    it('leaves a nested URL carrying no credentials byte-identical', () => {
      // Only half-encoded on purpose: if the recursion re-encoded a value it
      // did not change, this would come back fully percent-encoded.
      const url = 'https://example.com/go?next=https://app.example.com/docs%3Fpage%3D3';
      expect(redactSensitiveUrl(url)).toBe(url);
    });
  });

  describe('long values that are identifiers rather than credentials', () => {
    it('keeps a form-encoded search query, where + is a space', () => {
      const url = 'https://example.com/search?q=how+do+i+configure+the+widget+today2';
      expect(redactSensitiveUrl(url)).toBe(url);
    });

    it('keeps a canonical UUID', () => {
      const url = 'https://example.com/r?id=550e8400-e29b-41d4-a716-446655440000';
      expect(redactSensitiveUrl(url)).toBe(url);
    });

    it('keeps a long hyphenated anchor slug', () => {
      const url = 'https://example.com/report#section-about-the-2024-annual-report-summary';
      expect(redactSensitiveUrl(url)).toBe(url);
    });

    it('still redacts a long opaque hex value', () => {
      expect(
        redactSensitiveUrl(
          'https://example.com/x?blob=f3a91c7de204b8615c9d0af27be431905ca8d76e12b34f9087ac5de6103b2f4d'
        )
      ).toBe('https://example.com/x?blob=[REDACTED]');
    });

    it('still redacts a base64url token that happens to contain hyphens', () => {
      expect(
        redactSensitiveUrl(
          'https://example.com/x?blob=8Kd-2Qm7Xr4Tz-9Lb0Nv6Wq3Yh1Pj5Sc-Ae8Gu2Mi4Ko'
        )
      ).toBe('https://example.com/x?blob=[REDACTED]');
    });

    it('still redacts a UUID under a denylisted parameter name', () => {
      expect(
        redactSensitiveUrl('https://example.com/r?sid=550e8400-e29b-41d4-a716-446655440000')
      ).toBe('https://example.com/r?sid=[REDACTED]');
    });
  });

  describe('legacy `;` query separator', () => {
    it('redacts a denylisted parameter that follows a semicolon', () => {
      expect(
        redactSensitiveUrl('https://example.com/cb?b=1;token=SECRETCODE0123456789abcdef')
      ).toBe('https://example.com/cb?b=1;token=[REDACTED]');
    });

    it('keeps benign semicolon-separated parameters byte-identical', () => {
      const url = 'https://example.com/cb?b=1;page=3';
      expect(redactSensitiveUrl(url)).toBe(url);
    });
  });
});

describe('redactUrlsInText', () => {
  it('leaves an already-redacted URL alone rather than doubling the sentinel', () => {
    expect(redactUrlsInText('fetch failed for https://example.com/cb?code=[REDACTED]')).toBe(
      'fetch failed for https://example.com/cb?code=[REDACTED]'
    );
  });

  it('still strips real trailing punctuation that follows the sentinel', () => {
    expect(redactUrlsInText('failed (https://example.com/cb?code=[REDACTED]).')).toBe(
      'failed (https://example.com/cb?code=[REDACTED]).'
    );
  });

  it('still redacts a raw URL wrapped in parentheses', () => {
    const secret = 'f3a91c7de204b8615c9d0af27be431905ca8d76e12b34f9087ac5de6103b2f4d';
    expect(redactUrlsInText(`failed (https://example.com/x?blob=${secret}).`)).toBe(
      'failed (https://example.com/x?blob=[REDACTED]).'
    );
  });
});
