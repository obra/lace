// ABOUTME: Every surfaced transcript group keeps its directly linked current accounts or is omitted whole.
import {
  sourceReadHandle,
  type MemoryReader,
  type CurrentAccount,
  type Note,
  type OriginalReference,
} from './types';
import { redact } from '../storage/recall/redact';
import type { MemoryNotes } from './notes';
import type { MemorySources } from './sources';

export const CURRENT_ACCOUNT_ATTACHMENT_BYTES = 64 * 1024;
const emptyAccount: CurrentAccount = {
  id: '',
  revision: 0,
  text: '',
  attribution: '',
  support: [],
};
const minimumAccountBytes = JSON.stringify(emptyAccount).length;

export function maxRequiredAccounts(attachmentBytes: number): number {
  // Even redacted accounts need these JSON fields. Extra accounts make the whole group impossible to fit.
  return Math.floor(attachmentBytes / minimumAccountBytes);
}

export async function loadCurrentAccount(
  note: Note,
  sources: MemorySources,
  check: () => void
): Promise<CurrentAccount> {
  const support = [];
  for (const source of note.sources) {
    let status = await sources.status(source);
    check();
    if (status === 'superseded' && source.reference.kind === 'document') {
      // A superseded tree entry does not establish that its pinned blob is readable.
      try {
        await sources.load(source, false);
      } catch {
        status = 'unavailable';
      }
      check();
    }
    support.push({ handle: sourceReadHandle(source), status });
  }
  return {
    id: note.id,
    revision: note.revision,
    text: note.text,
    attribution: note.producer,
    support,
  };
}

export function validateCurrentAccount(
  account: CurrentAccount,
  notes: MemoryNotes,
  sources: MemorySources
): void {
  const head = notes.note(account.id);
  if (head?.revision !== account.revision)
    throw new Error('Current account revision changed during recall');
  if (!head.sources.length || head.sources.length !== account.support.length)
    throw new Error('Required current account support unavailable');
  sources.validateAtAcceptance(
    head.sources.map((source, index) => {
      const { handle, status } = account.support[index];
      if (
        handle !== sourceReadHandle(source) ||
        (status !== 'current' && !(status === 'superseded' && source.reference.kind === 'document'))
      )
        throw new Error('Required current account support unavailable');
      return { ...source, sourceStatus: status, content: [], textBytes: 0, imageBytes: 0 };
    })
  );
}

export async function attachCurrentAccounts<T extends { event_id: string }>(
  groups: T[],
  reader?: MemoryReader,
  expectedHeads: Array<{ id: string; revision: number }> = [],
  originalReferences?: OriginalReference[]
) {
  if (!reader) return { groups, omitted: [] };
  const originals =
    originalReferences ??
    groups.map((group) => {
      const split = group.event_id.lastIndexOf(':');
      return {
        kind: 'event' as const,
        sessionId: group.event_id.slice(0, split),
        eventSeq: Number(group.event_id.slice(split + 1)),
      };
    });
  const results = await reader.accountsFor(originals, expectedHeads);
  const kept: Array<T & { current_accounts?: CurrentAccount[] }> = [];
  const omitted: Array<{ event_id: string; reason: string }> = [];
  let remaining = CURRENT_ACCOUNT_ATTACHMENT_BYTES;
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
