// ABOUTME: Resolves bare model aliases (haiku, sonnet, opus) to concrete catalog ids
// ABOUTME: Exact catalog ids pass through unchanged; unknown strings also pass through

import type { CatalogModel } from './types';

const KNOWN_ALIASES = new Set(['haiku', 'sonnet', 'opus']);
const DATE_PATTERN = /(\d{8})/;

function dateScore(id: string): number {
  const match = DATE_PATTERN.exec(id);
  return match ? Number(match[1]) : 0;
}

export function resolveModelAlias(
  modelId: string,
  models: CatalogModel[],
  fallbackModels?: CatalogModel[]
): string {
  if (models.some((m) => m.id === modelId)) {
    return modelId;
  }

  const aliasKey = modelId.toLowerCase();
  if (!KNOWN_ALIASES.has(aliasKey)) {
    return modelId;
  }

  const primaryMatches = models.filter((m) => m.id.toLowerCase().includes(aliasKey));
  if (primaryMatches.length > 0) {
    return pickNewest(primaryMatches);
  }

  // The primary catalog (typically a live/dynamic catalog) contains no entries that
  // match this known alias. This happens in production when the dynamic catalog is
  // cold, partial, or recently failed to refresh. Fall back to the static built-in
  // catalog so bare aliases stay resolvable.
  if (fallbackModels && fallbackModels.length > 0) {
    const fallbackMatches = fallbackModels.filter((m) => m.id.toLowerCase().includes(aliasKey));
    if (fallbackMatches.length > 0) {
      return pickNewest(fallbackMatches);
    }
  }

  return modelId;
}

function pickNewest(matches: CatalogModel[]): string {
  const sorted = [...matches].sort((a, b) => {
    const dateDiff = dateScore(b.id) - dateScore(a.id);
    if (dateDiff !== 0) return dateDiff;
    if (a.id < b.id) return 1;
    if (a.id > b.id) return -1;
    return 0;
  });
  return sorted[0].id;
}
