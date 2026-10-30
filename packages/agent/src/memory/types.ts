// ABOUTME: Bounded automatic extraction inputs and current-note read contracts.
import type { HostMemoryBinding, MemoryConfiguration } from '@lace/ent-protocol';
import type { ContentBlock } from '../providers/base-provider';
export type { MemoryConfiguration };
export const MEMORY_LIMITS = {
  sources: 16,
  candidates: 16,
  changes: 16,
  sourceBytes: 64 * 1024,
  imageBytes: 4 * 1024 * 1024,
  responseBytes: 64 * 1024,
  outputTokens: 16_384,
  noteCharacters: 4096,
  discoveryBytes: 256 * 1024,
  maintenanceMs: 30_000,
} as const;
export type SourceReference =
  | {
      kind: 'event';
      sessionId: string;
      eventSeq: number;
      file: string;
      offset: number;
      bytes: number;
    }
  | { kind: 'document'; gitRoot: string; path: string; commit: string; blob: string };
export type Source = { id: string; version: string; reference: SourceReference };
export const sourceHandle = (source: Pick<Source, 'id' | 'version'>): string =>
  `${source.id}@${source.version}`;
export const sourceReadHandle = (source: Source): string =>
  source.reference.kind === 'event'
    ? `${source.reference.sessionId}:${source.reference.eventSeq}`
    : sourceHandle(source);
export type SuppliedSource = Source & {
  recordedAt?: string;
  sourceStatus?: string;
  content: ContentBlock[];
  textBytes: number;
  imageBytes: number;
};
export type Note = {
  id: string;
  revision: number;
  text: string;
  producer: string;
  sources: Source[];
};
export type Support = Source & { status: string };
export type OriginalReference =
  | { kind: 'event'; sessionId: string; eventSeq: number }
  | { kind: 'document'; id: string; version: string };
export type CurrentAccount = {
  id: string;
  revision: number;
  text: string;
  attribution: string;
  support: Array<{ handle: string; status: string }>;
};
export type MemoryReader = {
  accountsFor(
    originals: OriginalReference[],
    expectedHeads?: Array<{ id: string; revision: number }>
  ): Promise<Array<{ accounts: CurrentAccount[] } | { reason: string }>>;
  search(
    query: string,
    limit: number
  ): Promise<
    Array<{
      event_id: string;
      revision: number;
      preview: string;
      attribution: string;
      support: Support[];
    }>
  >;
  read(id: string): Promise<(Omit<Note, 'sources'> & { support: Support[] }) | undefined>;
};
export type MemoryRuntime = {
  configuration: MemoryConfiguration;
  reader(binding: HostMemoryBinding): MemoryReader;
  bindingForRole(role: string, actorId: string): HostMemoryBinding;
  wake(): Promise<void>;
  close(): Promise<void>;
};
