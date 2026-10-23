// ABOUTME: Renders the leading <message_meta sent_at="..."/> line that tells a
// ABOUTME: subagent when each message it receives was sent. The time comes from the
// ABOUTME: durable event's own timestamp at projection time, so the sent text and
// ABOUTME: every later rebuild of it are byte-identical. Root sessions are never
// ABOUTME: stamped: the embedder (sen-core) already renders sent_at on its envelope.
// ABOUTME: Pure rendering only: the compaction toolkit imports it, and must not
// ABOUTME: pull in the storage layer (see toolkit-purity.test.ts).

import type { ContentBlock } from '@lace/agent/providers/base-provider';

const SENT_AT_META_LINE = /^<message_meta sent_at="[^"]*"\/>\n/;

/**
 * `<message_meta sent_at="YYYY-MM-DDTHH:mm:ssZ"/>` for the given ISO timestamp,
 * in UTC to the second. Undefined when the timestamp is missing or unparseable,
 * so an event without one renders exactly as it always has.
 */
export function sentAtMetaLine(timestamp: string | undefined): string | undefined {
  if (!timestamp) return undefined;
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return undefined;
  const sentAt = new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `<message_meta sent_at="${sentAt}"/>`;
}

/** Prefix `text` with the sent_at meta line, on its own line. */
export function stampSentAt(text: string, timestamp: string | undefined): string {
  const meta = sentAtMetaLine(timestamp);
  return meta ? `${meta}\n${text}` : text;
}

/**
 * Stamp string or block content. Block content gets the meta line inside its
 * first text block, or as a new leading text block when the first block is not
 * text (an image-first prompt). Empty content stays empty: there is no message
 * to date.
 */
export function stampSentAtContent(
  content: string | ContentBlock[],
  timestamp: string | undefined
): string | ContentBlock[] {
  if (content.length === 0) return content;
  if (typeof content === 'string') return stampSentAt(content, timestamp);
  const meta = sentAtMetaLine(timestamp);
  if (!meta) return content;
  const [first, ...rest] = content;
  if (first?.type === 'text') return [{ ...first, text: `${meta}\n${first.text}` }, ...rest];
  return [{ type: 'text', text: meta }, ...content];
}

/** Remove a leading sent_at meta line, for code that pattern-matches message text. */
export function stripSentAtMeta(text: string): string {
  return text.replace(SENT_AT_META_LINE, '');
}
