// ABOUTME: Resolves bare model aliases (haiku, sonnet, opus) to concrete catalog ids
// ABOUTME: Exact catalog ids pass through unchanged; unknown strings also pass through

import type { CatalogModel } from './types';

const KNOWN_ALIASES = new Set(['haiku', 'sonnet', 'opus']);
const DATE_PATTERN = /(\d{8})/;

function dateScore(id: string): number {
  const match = DATE_PATTERN.exec(id);
  return match ? Number(match[1]) : 0;
}

export function resolveModelAlias(modelId: string, models: CatalogModel[]): string {
  if (models.some((m) => m.id === modelId)) {
    return modelId;
  }

  const aliasKey = modelId.toLowerCase();
  if (!KNOWN_ALIASES.has(aliasKey)) {
    return modelId;
  }

  const matches = models.filter((m) => m.id.toLowerCase().includes(aliasKey));
  if (matches.length === 0) {
    return modelId;
  }

  const sorted = [...matches].sort((a, b) => {
    const dateDiff = dateScore(b.id) - dateScore(a.id);
    if (dateDiff !== 0) return dateDiff;
    if (a.id < b.id) return 1;
    if (a.id > b.id) return -1;
    return 0;
  });

  return sorted[0].id;
}
