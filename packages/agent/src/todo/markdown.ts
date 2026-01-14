// ABOUTME: Markdown parsing and serialization for todo lists
// ABOUTME: Format: - [ ] **Title** `id`\n  Description

import type { TodoItem } from './types';

/**
 * Parse markdown todo list into TodoItem array
 *
 * Expected format:
 * - [ ] **Title** `t_abc`
 *   Optional description
 *   that can span lines.
 */
export function parseTodoMarkdown(content: string): TodoItem[] {
  const items: TodoItem[] = [];

  if (!content.trim()) {
    return items;
  }

  // Split into item blocks - each starts with "- ["
  const blocks = content.split(/(?=^- \[)/m).filter((b) => b.trim());

  for (const block of blocks) {
    const item = parseItemBlock(block);
    if (item) {
      items.push(item);
    }
  }

  return items;
}

/**
 * Parse a single item block into a TodoItem
 */
function parseItemBlock(block: string): TodoItem | null {
  const lines = block.split('\n');
  const headerLine = lines[0];

  // Match: - [ ] **Title** `id` or - [x] **Title** `id`
  const headerMatch = headerLine.match(/^- \[([ xX])\] \*\*(.+?)\*\* `([^`]+)`/);
  if (!headerMatch) {
    return null;
  }

  const [, checkbox, title, id] = headerMatch;
  const done = checkbox.toLowerCase() === 'x';

  // Description is remaining lines, stripped of leading 2-space indent
  const descriptionLines = lines
    .slice(1)
    .map((line) => {
      // Remove 2-space indent if present
      if (line.startsWith('  ')) {
        return line.slice(2);
      }
      return line;
    })
    .filter((line, index, arr) => {
      // Remove trailing empty lines
      if (index === arr.length - 1 && line === '') return false;
      return true;
    });

  // Join non-empty description lines
  const description = descriptionLines.join('\n').trim() || undefined;

  return { id, done, title, description };
}

/**
 * Serialize TodoItem array to markdown
 */
export function serializeTodoMarkdown(items: TodoItem[]): string {
  if (items.length === 0) {
    return '';
  }

  const blocks = items.map((item, index) => {
    const checkbox = item.done ? 'x' : ' ';
    let block = `- [${checkbox}] **${item.title}** \`${item.id}\`\n`;

    if (item.description) {
      // Indent each line of description with 2 spaces
      const indentedDesc = item.description
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
      block += `${indentedDesc}\n`;
    }

    // Add blank line between items (but not after last)
    if (index < items.length - 1) {
      block += '\n';
    }

    return block;
  });

  return blocks.join('');
}
