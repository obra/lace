// ABOUTME: Every surfaced transcript group keeps its directly linked current accounts or is omitted whole.
import type { MemoryReader, CurrentAccount } from './types';
import { redact } from '../storage/recall/redact';

export async function attachCurrentAccounts<T extends { event_id: string }>(
  groups: T[],
  reader?: MemoryReader,
  expectedHeads: Array<{ id: string; revision: number }> = []
) {
  if (!reader) return { groups, omitted: [] };
  const originals = groups.map((group) => {
    const split = group.event_id.lastIndexOf(':');
    return {
      kind: 'event' as const,
      sessionId: group.event_id.slice(0, split),
      eventSeq: Number(group.event_id.slice(split + 1)),
    };
  });
  const results = await reader.accountsFor(originals, expectedHeads);
  const kept: Array<T & { current_accounts?: unknown }> = [];
  const omitted: Array<{ event_id: string; reason: string }> = [];
  let remaining = 64 * 1024;
  for (const [index, group] of groups.entries()) {
    const result = results[index];
    if (!result || 'reason' in result) {
      omitted.push({
        event_id: group.event_id,
        reason: result?.reason ?? 'Required account lookup unavailable',
      });
      continue;
    }
    if (!result.accounts.length) {
      kept.push(group);
      continue;
    }
    const accounts = JSON.parse(redact(JSON.stringify(result.accounts))) as CurrentAccount[];
    const bytes = Buffer.byteLength(JSON.stringify({ current_accounts: accounts }));
    if (bytes > remaining) {
      omitted.push({ event_id: group.event_id, reason: 'Current account attachment budget' });
      continue;
    }
    remaining -= bytes;
    kept.push({ ...group, current_accounts: accounts });
  }
  return { groups: kept, omitted };
}
