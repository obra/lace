// ABOUTME: Pins the context window of every model the fleet actually runs, because
// ABOUTME: a model missing from this catalog does not fail — it silently gets the
// ABOUTME: dynamic provider's INFERRED_CONTEXT_WINDOW of 200K. That guess is
// ABOUTME: invisible at runtime and now decides how much history compaction keeps.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CatalogProviderSchema } from '../types';
import { resolveModelAlias } from '../alias-resolver';

/**
 * Models named by sen's personas and environments. A model absent from the
 * static catalog resolves to a 200K window whether or not that is true, which
 * (a) makes compaction pressure fire five times too early on a 1M model and
 * (b) since PRI-2906 shrinks the preserved tail to match the wrong number.
 * `claude-sonnet-5` was exactly that case: three personas ran it while lace
 * believed it held 200K.
 */
const EXPECTED_WINDOWS: Record<string, number> = {
  'claude-opus-5': 1_000_000,
  'claude-opus-4-8': 1_000_000,
  'claude-sonnet-5': 1_000_000,
  'claude-haiku-4-5-20251001': 200_000,
};

describe('shipped Anthropic catalog', () => {
  const raw = readFileSync(path.resolve(__dirname, '../data/anthropic.json'), 'utf8');
  const catalog = CatalogProviderSchema.parse(JSON.parse(raw));
  const byId = new Map(catalog.models.map((m) => [m.id, m]));

  for (const [id, window] of Object.entries(EXPECTED_WINDOWS)) {
    it(`describes ${id} with a ${window / 1000}K context window`, () => {
      const model = byId.get(id);
      expect(model, `${id} is missing from the static catalog`).toBeDefined();
      expect(model!.context_window).toBe(window);
    });
  }

  // A bare alias is what someone types when they have not thought about the
  // exact id, so what it resolves to is a decision, not a detail. Pinned here
  // against the SHIPPED catalog, resolved through the real resolver — the same
  // path the registry and compaction both take.
  const EXPECTED_ALIASES: Record<string, string> = {
    opus: 'claude-opus-4-8',
    sonnet: 'claude-sonnet-5',
    haiku: 'claude-haiku-4-5-20251001',
  };

  for (const [alias, expected] of Object.entries(EXPECTED_ALIASES)) {
    it(`resolves the bare alias '${alias}' to ${expected}`, () => {
      expect(resolveModelAlias(alias, catalog.models, undefined, catalog.model_aliases)).toBe(
        expected
      );
    });
  }

  it('defaults to current-generation models', () => {
    // What a session with no configured model gets. These drifted a generation
    // behind the same way the aliases did, and just as quietly: nothing reports
    // which model a default resolved to.
    expect(catalog.default_large_model_id).toBe('claude-sonnet-5');
    expect(catalog.default_small_model_id).toBe('claude-haiku-4-5-20251001');
    expect(byId.has(catalog.default_large_model_id)).toBe(true);
    expect(byId.has(catalog.default_small_model_id)).toBe(true);
  });

  it('serves every model an alias points at', () => {
    // A pin naming a model this provider does not list falls back to the
    // ranking, silently — which is the failure the pins exist to prevent.
    for (const target of Object.values(catalog.model_aliases ?? {})) {
      expect(byId.has(target), `alias target ${target} is not in the catalog`).toBe(true);
    }
  });
});
