// ABOUTME: Tests that the Anthropic dynamic catalog never downgrades a model the
// ABOUTME: static catalog already describes, and that an inferred entry for an
// ABOUTME: unknown model cannot silently impose a truncating output cap. A cached
// ABOUTME: catalog is merged against the CURRENT static catalog for the same reason:
// ABOUTME: the 24h TTL must not outlive a deploy that adds a model.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AnthropicDynamicProvider } from './dynamic-provider';
import type { CatalogProvider } from '../catalog/types';

/**
 * A static catalog carrying the rich metadata a deploy adds — the real
 * claude-opus-5 shape: 1M context, a 50k output budget, effort enabled.
 */
function staticCatalog(): CatalogProvider {
  return {
    name: 'Anthropic',
    default_large_model_id: 'claude-opus-5',
    default_small_model_id: 'claude-haiku-4-5-20251001',
    models: [
      {
        id: 'claude-opus-5',
        name: 'Claude Opus 5',
        context_window: 1_000_000,
        default_max_tokens: 50_000,
        can_reason: true,
        has_reasoning_effort: true,
        default_reasoning_effort: 'medium',
      },
    ],
  } as unknown as CatalogProvider;
}

describe('AnthropicDynamicProvider catalog merge', () => {
  let tempDir: string;
  let originalLaceDir: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-dyncat-'));
    originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('keeps the static entry for a model the API also reports', async () => {
    // The API returns the model; the static catalog knows its real limits. The
    // dynamic layer exists to filter by availability, never to re-describe.
    const provider = new AnthropicDynamicProvider('sen-anthropic');
    const inner = (provider as unknown as { client: { fetchAllModels: unknown } }).client;
    vi.spyOn(
      inner as { fetchAllModels: () => Promise<unknown> },
      'fetchAllModels'
    ).mockResolvedValue([{ id: 'claude-opus-5', display_name: 'Claude Opus 5' }]);

    const merged = await provider.getCatalog('sk-test', staticCatalog(), true);
    const model = merged.models.find((m) => m.id === 'claude-opus-5');
    expect(model?.default_max_tokens).toBe(50_000);
    expect(model?.context_window).toBe(1_000_000);
  });

  it('a STALE cache must not shadow a model the static catalog just gained', async () => {
    // The 24h TTL outlived a deploy: Cadence went silent on 2026-08-04 because a
    // cache written before the claude-opus-5 catalog entry landed kept serving an
    // inferred 8192-token cap. Adaptive thinking counts against max_tokens, so an
    // 8192 ceiling truncates any substantial turn — the reply was cut mid-flight.
    const provider = new AnthropicDynamicProvider('sen-anthropic');
    const cacheDir = path.join(tempDir, 'catalogs');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, 'anthropic-sen-anthropic.json'),
      JSON.stringify({
        _meta: {
          fetchedAt: new Date().toISOString(), // fresh by TTL, stale by content
          version: '1',
          availableModelCount: 1,
          source: 'api',
        },
        provider: {
          name: 'Anthropic',
          models: [
            // What inferModelMetadata produced before the deploy.
            {
              id: 'claude-opus-5',
              name: 'Claude Opus 5',
              context_window: 200_000,
              default_max_tokens: 8192,
            },
          ],
        },
      })
    );

    const merged = await provider.getCatalog('sk-test', staticCatalog(), false);
    const model = merged.models.find((m) => m.id === 'claude-opus-5');
    expect(model?.default_max_tokens).toBe(50_000);
    expect(model?.context_window).toBe(1_000_000);
  });
});
