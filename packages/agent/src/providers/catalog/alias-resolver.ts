// ABOUTME: Resolves bare model aliases (haiku, sonnet, opus) to concrete catalog ids
// ABOUTME: Exact catalog ids pass through unchanged; unknown strings also pass through

/**
 * Anything with an id can be ranked — the resolver reads nothing else. Widened
 * from CatalogModel so a caller holding a provider's own ModelInfo[] can resolve
 * an alias against exactly the model list that provider was built with, rather
 * than re-deriving one from the catalog and risking a different answer.
 */
interface HasModelId {
  id: string;
}

const KNOWN_ALIASES = new Set(['haiku', 'sonnet', 'opus']);
const DATE_PATTERN = /(\d{8})/;

function dateScore(id: string): number {
  const match = DATE_PATTERN.exec(id);
  return match ? Number(match[1]) : 0;
}

export function resolveModelAlias(
  modelId: string,
  models: HasModelId[],
  fallbackModels?: HasModelId[],
  /**
   * The provider's own statement of what its aliases mean, from the catalog's
   * `model_aliases`. Consulted before the ranking below, because the ranking is
   * a guess and this is not: it says `opus` means Opus 4.8 because that is the
   * model we chose to run, which no ordering of ids would tell you.
   */
  aliasPins?: Record<string, string>
): string {
  if (models.some((m) => m.id === modelId)) {
    return modelId;
  }

  const aliasKey = modelId.toLowerCase();
  if (!KNOWN_ALIASES.has(aliasKey)) {
    return modelId;
  }

  const pinned = aliasPins?.[aliasKey];
  if (pinned) {
    // Only honour a pin the provider can actually serve. A stale pin naming a
    // retired model would otherwise hand back an id that 404s at request time;
    // falling through to the ranking at least returns something servable.
    const servable =
      models.some((m) => m.id === pinned) || fallbackModels?.some((m) => m.id === pinned);
    if (servable) {
      return pinned;
    }
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

function pickNewest(matches: HasModelId[]): string {
  const sorted = [...matches].sort((a, b) => {
    const dateDiff = dateScore(b.id) - dateScore(a.id);
    if (dateDiff !== 0) return dateDiff;
    if (a.id < b.id) return 1;
    if (a.id > b.id) return -1;
    return 0;
  });
  return sorted[0].id;
}
