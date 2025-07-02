// ABOUTME: Utility to find similar file paths for helpful error messages
// ABOUTME: Uses edit distance and fuzzy matching to suggest alternatives for misspelled filenames

import { readdir } from 'fs/promises';
import { dirname, basename, extname } from 'path';

export async function findSimilarPaths(targetPath: string, maxSuggestions = 5): Promise<string[]> {
  const dir = dirname(targetPath);
  const targetName = basename(targetPath);

  try {
    // Find files in same directory
    const files = await readdir(dir, { withFileTypes: true });
    const fileNames = files.filter((dirent) => dirent.isFile()).map((dirent) => dirent.name);

    // Score files by similarity, focusing on misspelling detection
    const scored = fileNames
      .map((fileName) => ({
        fileName,
        fullPath: `${dir}/${fileName}`,
        score: calculateSimilarityScore(targetName, fileName),
      }))
      .filter((item) => item.score > 0.3) // Only suggest reasonably similar files
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSuggestions)
      .map((item) => item.fullPath);

    return scored;
  } catch {
    // If we can't read the directory, return empty suggestions
    return [];
  }
}

/**
 * Calculate similarity score between target and candidate filenames
 * Focuses on detecting common misspellings and typos
 */
function calculateSimilarityScore(target: string, candidate: string): number {
  // Exact match
  if (target === candidate) {
    return 1.0;
  }

  // Case-insensitive exact match
  if (target.toLowerCase() === candidate.toLowerCase()) {
    return 0.95;
  }

  const targetLower = target.toLowerCase();
  const candidateLower = candidate.toLowerCase();

  // Check for common patterns
  let score = 0;

  // 1. Edit distance similarity (catches typos, transpositions, missing chars)
  const editDistance = getLevenshteinDistance(targetLower, candidateLower);
  const maxLength = Math.max(targetLower.length, candidateLower.length);
  const editSimilarity = 1 - editDistance / maxLength;
  score += editSimilarity * 0.6;

  // 2. Prefix/suffix similarity (catches extension changes, prefixes)
  const prefixSimilarity = getLongestCommonPrefix(targetLower, candidateLower) / maxLength;
  const suffixSimilarity = getLongestCommonSuffix(targetLower, candidateLower) / maxLength;
  score += Math.max(prefixSimilarity, suffixSimilarity) * 0.2;

  // 3. Token similarity (for hyphenated or underscore-separated names)
  const targetTokens = tokenize(targetLower);
  const candidateTokens = tokenize(candidateLower);
  const tokenSimilarity = getTokenSimilarity(targetTokens, candidateTokens);
  score += tokenSimilarity * 0.2;

  // 4. Bonus for same extension
  const targetExt = extname(target).toLowerCase();
  const candidateExt = extname(candidate).toLowerCase();
  if (targetExt && candidateExt && targetExt === candidateExt) {
    score += 0.1;
  }

  // 5. Penalty for very different lengths (likely not a typo)
  const lengthRatio =
    Math.min(target.length, candidate.length) / Math.max(target.length, candidate.length);
  if (lengthRatio < 0.5) {
    score *= 0.5;
  }

  return Math.min(score, 1.0);
}

/**
 * Calculate Levenshtein distance between two strings
 * Optimized for detecting common typing errors
 */
function getLevenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        // Cost of substitution, insertion, deletion
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Find longest common prefix length
 */
function getLongestCommonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i++;
  }
  return i;
}

/**
 * Find longest common suffix length
 */
function getLongestCommonSuffix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) {
    i++;
  }
  return i;
}

/**
 * Tokenize filename into parts for comparison
 */
function tokenize(filename: string): string[] {
  // Split on common separators and remove extension
  const nameWithoutExt = basename(filename, extname(filename));
  return nameWithoutExt.split(/[-_.\s]+/).filter((token) => token.length > 0);
}

/**
 * Calculate similarity between token arrays
 */
function getTokenSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 && tokensB.length === 0) return 1.0;
  if (tokensA.length === 0 || tokensB.length === 0) return 0.0;

  let matches = 0;
  const used = new Set<number>();

  for (const tokenA of tokensA) {
    for (let i = 0; i < tokensB.length; i++) {
      if (!used.has(i) && tokenA === tokensB[i]) {
        matches++;
        used.add(i);
        break;
      }
    }
  }

  return (2 * matches) / (tokensA.length + tokensB.length);
}
