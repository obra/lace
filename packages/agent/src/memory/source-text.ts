// ABOUTME: Shared redacted text representation for original passages and required tool history.
import { redact } from '../storage/recall/redact';

export function toolSourceHeader(name: unknown, input: unknown): string {
  return `tool=${String(name)}\ninput=${JSON.stringify(input)}`;
}
export function sourceText(content: ReadonlyArray<{ type: string; text?: unknown }>): string {
  return redact(
    content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
  ).replace(/^Transcript event type=[^\n]*\n?/, '');
}
export function representedToolText(data: Record<string, unknown>): string {
  const result = data.result as { outcome?: unknown; content?: unknown } | undefined;
  if (result?.outcome !== 'completed' || !Array.isArray(result.content)) return '';
  const text = result.content.flatMap((block: unknown) => {
    if (!block || typeof block !== 'object') return [];
    const value = block as { type?: unknown; text?: unknown };
    return value.type === 'text' && typeof value.text === 'string'
      ? [{ type: 'text', text: value.text }]
      : [];
  });
  return sourceText([{ type: 'text', text: toolSourceHeader(data.name, data.input) }, ...text]);
}
