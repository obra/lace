// ABOUTME: Syntax highlighting utility using cli-highlight
// ABOUTME: Processes code blocks and applies terminal color highlighting

import { highlight } from "cli-highlight";
import { highlightDiff } from "./diff-highlight";

interface CodeBlock {
  language: string;
  code: string;
  startIndex: number;
  endIndex: number;
}

export function detectCodeBlocks(content: string): CodeBlock[] {
  const codeBlocks: CodeBlock[] = [];
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    codeBlocks.push({
      language: match[1] || "text",
      code: match[2],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  return codeBlocks;
}

export function highlightCode(code: string, language: string): string {
  try {
    // Special handling for diff blocks
    if (language === "diff") {
      return highlightDiff(code);
    }

    // Use cli-highlight to apply syntax highlighting
    return highlight(code, { language, ignoreIllegals: true });
  } catch (error) {
    // Fallback to plain text if highlighting fails
    console.warn("Syntax highlighting failed:", error);
    return code;
  }
}

export function processContentWithHighlighting(content: string): string {
  const codeBlocks = detectCodeBlocks(content);

  if (codeBlocks.length === 0) {
    return content;
  }

  let result = content;
  let offset = 0;

  // Process code blocks from end to start to maintain correct indices
  for (let i = codeBlocks.length - 1; i >= 0; i--) {
    const block = codeBlocks[i];
    const originalBlock = content.substring(block.startIndex, block.endIndex);
    const highlightedCode = highlightCode(block.code, block.language);

    // Replace the code block with highlighted version
    const highlightedBlock = `\`\`\`${block.language}\n${highlightedCode}\`\`\``;

    result =
      result.substring(0, block.startIndex) +
      highlightedBlock +
      result.substring(block.endIndex);
  }

  return result;
}
