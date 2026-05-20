import { describe, expect, it } from 'vitest';
import { normalizeImagePlatform, validateResolvedImageDigest } from '../image-identity';

describe('container image identity', () => {
  it('normalizes supported platform syntax', () => {
    expect(normalizeImagePlatform('Linux/ARM64')).toBe('linux/arm64');
    expect(normalizeImagePlatform('linux/arm/v7')).toBe('linux/arm/v7');
  });

  it('rejects malformed platform syntax', () => {
    expect(() => normalizeImagePlatform('linux')).toThrow(/platform/i);
    expect(() => normalizeImagePlatform('linux/')).toThrow(/platform/i);
  });

  it('validates sha256 digest strings', () => {
    expect(() =>
      validateResolvedImageDigest(
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      )
    ).not.toThrow();
    expect(() => validateResolvedImageDigest('latest')).toThrow(/digest/i);
  });
});
