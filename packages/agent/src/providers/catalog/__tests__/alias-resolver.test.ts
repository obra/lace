// ABOUTME: Tests for catalog model alias resolver
// ABOUTME: Verifies bare alias names like 'haiku' resolve to newest matching catalog id

import { describe, it, expect } from 'vitest';
import { resolveModelAlias } from '../alias-resolver';
import type { CatalogModel } from '../types';

function makeModel(id: string, overrides?: Partial<CatalogModel>): CatalogModel {
  return {
    id,
    name: id,
    context_window: 200000,
    default_max_tokens: 8192,
    ...overrides,
  };
}

const anthropicLike: CatalogModel[] = [
  makeModel('claude-sonnet-4-5-20250929'),
  makeModel('claude-opus-4-5-20251101'),
  makeModel('claude-haiku-4-5-20251001'),
  makeModel('claude-opus-4-1-20250805'),
  makeModel('claude-3-5-haiku-20241022'),
  makeModel('claude-3-5-sonnet-20241022'),
];

describe('resolveModelAlias', () => {
  it('returns input unchanged for exact id match', () => {
    expect(resolveModelAlias('claude-haiku-4-5-20251001', anthropicLike)).toBe(
      'claude-haiku-4-5-20251001'
    );
  });

  it('returns input unchanged for exact id match even when input also matches an alias substring', () => {
    // 'claude-3-5-haiku-20241022' contains 'haiku' but is an exact id, so it should pass through
    expect(resolveModelAlias('claude-3-5-haiku-20241022', anthropicLike)).toBe(
      'claude-3-5-haiku-20241022'
    );
  });

  it('resolves haiku to the newest haiku by date', () => {
    expect(resolveModelAlias('haiku', anthropicLike)).toBe('claude-haiku-4-5-20251001');
  });

  it('resolves sonnet to the newest sonnet by date', () => {
    expect(resolveModelAlias('sonnet', anthropicLike)).toBe('claude-sonnet-4-5-20250929');
  });

  it('resolves opus to the newest opus by date', () => {
    expect(resolveModelAlias('opus', anthropicLike)).toBe('claude-opus-4-5-20251101');
  });

  it('matches aliases case-insensitively', () => {
    expect(resolveModelAlias('HAIKU', anthropicLike)).toBe('claude-haiku-4-5-20251001');
    expect(resolveModelAlias('Sonnet', anthropicLike)).toBe('claude-sonnet-4-5-20250929');
  });

  it('returns input unchanged for unknown string with no exact match', () => {
    expect(resolveModelAlias('gpt-4', anthropicLike)).toBe('gpt-4');
  });

  it('returns input unchanged when models array is empty', () => {
    expect(resolveModelAlias('haiku', [])).toBe('haiku');
  });

  it('uses lexical desc as tie-breaker when ids share no date', () => {
    const models: CatalogModel[] = [makeModel('claude-haiku-4'), makeModel('claude-haiku-4.5')];
    expect(resolveModelAlias('haiku', models)).toBe('claude-haiku-4.5');
  });

  it('uses lexical desc as tie-breaker when ids share the same date', () => {
    const models: CatalogModel[] = [
      makeModel('claude-haiku-a-20250101'),
      makeModel('claude-haiku-b-20250101'),
    ];
    expect(resolveModelAlias('haiku', models)).toBe('claude-haiku-b-20250101');
  });

  it('prioritizes date suffix over lexical order', () => {
    // 'claude-haiku-9-9-20200101' is lexically greater than 'claude-haiku-4-5-20251001'
    // but the latter has a later date, so date wins.
    const models: CatalogModel[] = [
      makeModel('claude-haiku-9-9-20200101'),
      makeModel('claude-haiku-4-5-20251001'),
    ];
    expect(resolveModelAlias('haiku', models)).toBe('claude-haiku-4-5-20251001');
  });

  it('treats missing date as 0 so dated id wins over undated id', () => {
    const models: CatalogModel[] = [
      makeModel('claude-haiku-4.5'),
      makeModel('claude-haiku-old-20200101'),
    ];
    expect(resolveModelAlias('haiku', models)).toBe('claude-haiku-old-20200101');
  });
});
