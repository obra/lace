// ABOUTME: Search text highlighting utility for marking search matches in messages
// ABOUTME: Provides functions to highlight search terms with background colors in terminal text

/**
 * Highlights search terms in text with background color
 * @param text - The text to search and highlight in
 * @param searchTerm - The term to highlight (case insensitive)
 * @returns Text with highlighted search terms
 */
export function highlightSearchTerm(text: string, searchTerm: string): string {
  if (!searchTerm.trim()) return text;
  
  const regex = new RegExp(`(${escapeRegex(searchTerm)})`, 'gi');
  
  // Use ANSI escape codes for yellow background highlighting
  return text.replace(regex, '\x1b[43m\x1b[30m$1\x1b[0m');
}

/**
 * Escapes special regex characters in search term
 * @param text - Text to escape
 * @returns Escaped text safe for regex
 */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks if text contains the search term (case insensitive)
 * @param text - Text to search in
 * @param searchTerm - Term to search for
 * @returns True if text contains the search term
 */
export function containsSearchTerm(text: string, searchTerm: string): boolean {
  if (!searchTerm.trim()) return false;
  return text.toLowerCase().includes(searchTerm.toLowerCase());
}