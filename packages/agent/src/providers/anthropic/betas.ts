// ABOUTME: Helpers for computing the typed betas[] array sent to client.beta.messages.*
// ABOUTME: Merges per-model catalog betas, global observability betas, and per-call betas

import type { AnthropicBeta } from '@anthropic-ai/sdk/resources/beta/beta';
import type { CatalogProvider } from '@lace/agent/providers/catalog/types';

/**
 * Observability betas that Anthropic-direct requests opt into by default.
 *
 * - `cache-diagnosis-2026-04-07`: surfaces cache-miss reasons inline on responses.
 * - `model-context-window-exceeded-2025-08-26`: makes the API return a typed
 *   stop_reason instead of failing with a 400 when the prompt is too long.
 *
 * Operators can disable both by setting `observability_betas_enabled: false`
 * on the provider instance config — see {@link getBetasForRequest}.
 */
export const OBSERVABILITY_BETAS: readonly AnthropicBeta[] = [
  'cache-diagnosis-2026-04-07',
  'model-context-window-exceeded-2025-08-26',
] as const;

/**
 * Per-request options that callers may pass through to influence the betas[]
 * array. The `additionalBetas` slot is intentionally undocumented for end
 * users — it exists for future internal use (e.g. a one-off beta opt-in from
 * an experimental code path) without forcing a new config field.
 */
export interface BetaRequestOptions {
  additionalBetas?: AnthropicBeta[];
}

/**
 * Parse the per-model `extra_headers["anthropic-beta"]` value into typed beta
 * identifiers. The catalog encodes betas as the wire-format header value —
 * either a single token or a comma-separated list (matching how Anthropic's
 * API itself serializes the header). Whitespace around tokens is stripped.
 * Returns an empty array if the model has no matching catalog entry or no
 * anthropic-beta header.
 */
export function parseCatalogBetas(catalog: CatalogProvider, model: string): AnthropicBeta[] {
  const entry = catalog.models.find((m) => m.id === model);
  const raw = entry?.extra_headers?.['anthropic-beta'];
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0) as AnthropicBeta[];
}

/**
 * Compute the deduped betas[] array for an Anthropic-direct request.
 *
 * Sources, in precedence order (earlier sources keep their position when
 * later sources contain duplicates):
 *   1. Catalog betas declared on the model via `extra_headers["anthropic-beta"]`.
 *   2. Global observability betas — enabled by default; opt out by setting
 *      `observability_betas_enabled: false` on the per-instance config.
 *   3. Per-call additional betas from `opts.additionalBetas`.
 *
 * The default-on semantics for observability betas use `!== false` so that
 * both `undefined` and `true` keep them enabled. Only an explicit `false`
 * disables them.
 */
export function getBetasForRequest(
  catalog: CatalogProvider,
  model: string,
  config: { observability_betas_enabled?: boolean },
  opts?: BetaRequestOptions
): AnthropicBeta[] {
  const fromCatalog = parseCatalogBetas(catalog, model);
  const fromInstance: AnthropicBeta[] =
    config.observability_betas_enabled !== false ? [...OBSERVABILITY_BETAS] : [];
  const fromOpts = opts?.additionalBetas ?? [];
  return Array.from(new Set<AnthropicBeta>([...fromCatalog, ...fromInstance, ...fromOpts]));
}
