// ABOUTME: Unit tests for getBetasForRequest and parseCatalogBetas
// ABOUTME: Verifies dedup, default-on observability betas, and per-call additions

import { describe, it, expect } from 'vitest';
import { OBSERVABILITY_BETAS, parseCatalogBetas, getBetasForRequest } from '../betas';
import type { CatalogProvider } from '@lace/agent/providers/catalog/types';

const plainModel = {
  id: 'claude-plain',
  name: 'Claude Plain',
  context_window: 200_000,
  default_max_tokens: 32_000,
};

const oneMillionModel = {
  id: 'claude-1m',
  name: 'Claude 1M context',
  context_window: 1_000_000,
  default_max_tokens: 32_000,
  extra_headers: { 'anthropic-beta': 'context-1m-2025-08-07' },
};

const multiBetaModel = {
  id: 'claude-multi',
  name: 'Claude Multi-beta',
  context_window: 200_000,
  default_max_tokens: 32_000,
  // Catalogs may declare multiple betas as a comma-separated value, matching
  // how Anthropic's anthropic-beta header is serialized on the wire.
  extra_headers: { 'anthropic-beta': 'context-1m-2025-08-07, skills-2025-10-02' },
};

const catalog: CatalogProvider = {
  name: 'Anthropic',
  id: 'anthropic',
  type: 'anthropic',
  default_large_model_id: plainModel.id,
  default_small_model_id: plainModel.id,
  models: [plainModel, oneMillionModel, multiBetaModel],
};

describe('parseCatalogBetas', () => {
  it('returns empty array when the model has no extra_headers entry', () => {
    expect(parseCatalogBetas(catalog, plainModel.id)).toEqual([]);
  });

  it('returns empty array when the model is not in the catalog', () => {
    expect(parseCatalogBetas(catalog, 'nonexistent')).toEqual([]);
  });

  it('parses a single beta from anthropic-beta header', () => {
    expect(parseCatalogBetas(catalog, oneMillionModel.id)).toEqual(['context-1m-2025-08-07']);
  });

  it('splits comma-separated anthropic-beta header into multiple entries', () => {
    expect(parseCatalogBetas(catalog, multiBetaModel.id)).toEqual([
      'context-1m-2025-08-07',
      'skills-2025-10-02',
    ]);
  });
});

describe('getBetasForRequest', () => {
  it('returns observability betas by default for a plain model', () => {
    // Default config + model with no catalog betas → just the observability betas.
    expect(getBetasForRequest(catalog, plainModel.id, {})).toEqual([...OBSERVABILITY_BETAS]);
  });

  it('combines catalog betas and observability betas for a 1M-context model', () => {
    expect(getBetasForRequest(catalog, oneMillionModel.id, {})).toEqual([
      'context-1m-2025-08-07',
      ...OBSERVABILITY_BETAS,
    ]);
  });

  it('returns only catalog betas when observability_betas_enabled is false (1M model)', () => {
    expect(
      getBetasForRequest(catalog, oneMillionModel.id, {
        observability_betas_enabled: false,
      })
    ).toEqual(['context-1m-2025-08-07']);
  });

  it('returns an empty array when observability_betas_enabled is false (plain model)', () => {
    expect(
      getBetasForRequest(catalog, plainModel.id, {
        observability_betas_enabled: false,
      })
    ).toEqual([]);
  });

  it('appends opts.additionalBetas to the union and dedupes', () => {
    const result = getBetasForRequest(
      catalog,
      plainModel.id,
      {},
      {
        additionalBetas: ['some-future-beta'],
      }
    );
    expect(result).toEqual([...OBSERVABILITY_BETAS, 'some-future-beta']);
  });

  it('dedupes betas that appear in multiple sources', () => {
    // Caller passes an additionalBeta that the catalog already declared and
    // an observability beta — the result must contain each beta exactly once.
    const result = getBetasForRequest(
      catalog,
      oneMillionModel.id,
      {},
      {
        additionalBetas: ['context-1m-2025-08-07', 'cache-diagnosis-2026-04-07'],
      }
    );
    expect(result).toEqual([
      'context-1m-2025-08-07',
      'cache-diagnosis-2026-04-07',
      'model-context-window-exceeded-2025-08-26',
    ]);
    expect(new Set(result).size).toBe(result.length);
  });

  it('treats observability_betas_enabled === undefined as on (default-on inversion)', () => {
    // Explicit undefined matches the !== false invariant — observability betas remain on.
    expect(
      getBetasForRequest(catalog, plainModel.id, {
        observability_betas_enabled: undefined,
      })
    ).toEqual([...OBSERVABILITY_BETAS]);
  });
});
