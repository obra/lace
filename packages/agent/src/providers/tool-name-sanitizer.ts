// ABOUTME: Provider-independent tool-name sanitization. Anthropic/OpenAI/Gemini/Ollama/
// ABOUTME: LMStudio all reject characters outside [a-zA-Z0-9_-] (and similar limits) in
// ABOUTME: tool names. MCP tools come in named `<server>/<tool>` which has '/' — illegal.
// ABOUTME: This module rewrites names to a safe form per request, with a mapping that
// ABOUTME: lets the provider response parser recover the original name when the model
// ABOUTME: invokes a tool. Request-scoped (no shared state) so concurrent requests are safe.

const ALLOWED = /[^a-zA-Z0-9_-]/g;
const COLLAPSE_UNDERSCORES = /_+/g;

// Most provider limits live around 64-128 chars. 64 is the strictest (OpenAI). Use the
// strictest as the universal cap so sanitized names work for every provider.
const MAX_NAME_LENGTH = 64;
const COLLISION_SUFFIX_RESERVE = 4;

/**
 * Pure-function sanitize. Replaces any character outside [a-zA-Z0-9_-] with '_' and
 * collapses runs of underscores. Length is NOT capped here — collision handling in
 * buildSanitizedToolNames manages length.
 */
export function sanitizeToolName(name: string): string {
  const sanitized = name.replace(ALLOWED, '_').replace(COLLAPSE_UNDERSCORES, '_');
  if (!sanitized || /^_+$/.test(sanitized)) {
    throw new Error(
      `Tool name "${name}" is invalid — sanitizes to empty or underscore-only string`
    );
  }
  return sanitized;
}

/**
 * Builds a sanitized-name mapping for a batch of tools. Handles collisions (two tools
 * sanitize to the same name) by appending `_2`, `_3`, etc., truncating the base name as
 * needed to stay within the universal 64-char limit.
 *
 * Returns:
 *  - `names`: parallel array — `names[i]` is the sanitized name corresponding to `tools[i]`
 *  - `mapping`: sanitizedName → originalName, used to recover the original on response
 */
export function buildSanitizedToolNames(toolNames: string[]): {
  names: string[];
  mapping: Map<string, string>;
} {
  const mapping = new Map<string, string>();
  const names: string[] = [];

  for (const original of toolNames) {
    const baseSanitized = sanitizeToolName(original);
    const maxBaseLength = MAX_NAME_LENGTH - COLLISION_SUFFIX_RESERVE;
    let baseName =
      baseSanitized.length > maxBaseLength
        ? baseSanitized.substring(0, maxBaseLength)
        : baseSanitized;

    let sanitizedName = baseName;
    if (mapping.has(sanitizedName)) {
      let suffix = 2;
      sanitizedName = `${baseName}_${suffix}`;
      while (mapping.has(sanitizedName) || sanitizedName.length > MAX_NAME_LENGTH) {
        suffix++;
        sanitizedName = `${baseName}_${suffix}`;
        if (sanitizedName.length > MAX_NAME_LENGTH) {
          const suffixStr = `_${suffix}`;
          baseName = baseName.substring(0, MAX_NAME_LENGTH - suffixStr.length);
          sanitizedName = `${baseName}${suffixStr}`;
        }
      }
    }

    if (sanitizedName.length > MAX_NAME_LENGTH) {
      sanitizedName = sanitizedName.substring(0, MAX_NAME_LENGTH);
    }

    mapping.set(sanitizedName, original);
    names.push(sanitizedName);
  }

  return { names, mapping };
}

/**
 * Recover the original tool name from the sanitized one the provider sent back. Returns
 * the sanitized name unchanged if not found in the mapping — that's the legitimate case
 * where the tool name didn't actually need sanitization (no special chars to begin with).
 */
export function unsanitizeToolName(sanitizedName: string, mapping: Map<string, string>): string {
  return mapping.get(sanitizedName) ?? sanitizedName;
}
