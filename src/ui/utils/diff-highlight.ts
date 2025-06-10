// ABOUTME: Diff highlighting utility for unified diff format display
// ABOUTME: Adds color codes for additions (green) and deletions (red) in diff blocks

/**
 * Highlights unified diff content with ANSI color codes
 * Green for additions (+), red for deletions (-), normal for context
 */
export function highlightDiff(diffContent: string): string {
  const lines = diffContent.split("\n");
  const highlightedLines = lines.map((line) => {
    // Addition lines start with +
    if (line.startsWith("+") && !line.startsWith("+++")) {
      return `\x1b[32m${line}\x1b[0m`; // Green color
    }

    // Deletion lines start with -
    if (line.startsWith("-") && !line.startsWith("---")) {
      return `\x1b[31m${line}\x1b[0m`; // Red color
    }

    // Context lines and headers remain unchanged
    return line;
  });

  return highlightedLines.join("\n");
}

/**
 * Processes content to detect and highlight diff blocks
 * Looks for ```diff code blocks and applies diff highlighting
 */
export function processContentWithDiffHighlighting(content: string): string {
  // Pattern to match diff code blocks
  const diffBlockPattern = /```diff\n([\s\S]*?)\n```/g;

  return content.replace(diffBlockPattern, (match, diffContent) => {
    try {
      const highlightedDiff = highlightDiff(diffContent);
      return `\`\`\`diff\n${highlightedDiff}\n\`\`\``;
    } catch (error) {
      // Fallback to original content if highlighting fails
      return match;
    }
  });
}

/**
 * Detects if content contains diff blocks
 */
export function containsDiffBlocks(content: string): boolean {
  return /```diff\n[\s\S]*?\n```/.test(content);
}
