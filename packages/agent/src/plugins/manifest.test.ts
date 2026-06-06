// ABOUTME: Tests the owner-keyed capability manifest record/reset surface
import { describe, it, expect, beforeEach } from 'vitest';
import { recordManifest, resetManifestsForTest } from './manifest';

describe('capability manifest', () => {
  beforeEach(() => resetManifestsForTest());
  it('records a declared capability manifest without error', () => {
    expect(() => recordManifest('vendor/creds', { capabilities: ['credentials'] })).not.toThrow();
  });
  it('records an empty manifest without error', () => {
    expect(() => recordManifest('vendor/grep', { capabilities: [] })).not.toThrow();
  });
  it('re-records the same owner without error (later wins)', () => {
    recordManifest('vendor/creds', { capabilities: [] });
    expect(() => recordManifest('vendor/creds', { capabilities: ['credentials'] })).not.toThrow();
  });
});
