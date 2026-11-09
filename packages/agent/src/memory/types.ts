// ABOUTME: Bounded automatic extraction inputs and current-note read contracts.
import { createHash } from 'node:crypto';
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
export const originalHandle = (source: Pick<Source, 'id' | 'version'>): string =>
  `source:${createHash('sha256').update(sourceHandle(source)).digest('hex')}`;
export const sourceReadHandle = (source: Source): string =>
  source.reference.kind === 'event'
    ? `${source.reference.sessionId}:${source.reference.eventSeq}`
    : originalHandle(source);
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
export type RepresentedOriginal = OriginalReference & { text: string };
export type AutomaticRecallInput = {
  query: string;
  tail?: string;
  cueIds: string[];
  represented: RepresentedOriginal[];
  signal: AbortSignal;
  maxTokens: number;
  selection?: Pick<AutomaticRecallResult, 'groups' | 'mode' | 'reason'>;
};
export type HistoricalQuotation = {
  kind: 'message' | 'journal' | 'source';
  metadata: Record<string, string>;
  excerpts: Array<{ metadata: Record<string, string>; text: string }>;
  read: { action: 'read'; event_id: string; context?: number; full?: true };
};
export type OriginalEvidence = {
  handle: string;
  source: OriginalReference;
  start: number;
  end: number;
  text: string;
  quotation?: HistoricalQuotation;
};
export type AutomaticEvidence = { originals: OriginalEvidence[]; accounts: CurrentAccount[] };
export type AutomaticRecallResult = {
  mode: 'hybrid' | 'semantic-only' | 'text-only' | 'unavailable';
  reason?: string;
  coverage: { sources: number; passages: number; vectors: number; partial: boolean };
  groups: AutomaticEvidence[];
  selected: AutomaticEvidence[];
  tokens: number;
  block: string | null;
};
export type OriginalRead = {
  handle: string;
  source: OriginalReference;
  status: string;
  text?: string;
  current_accounts?: CurrentAccount[];
  omitted?: string;
};
export type MemoryReader = {
  automatic(input: AutomaticRecallInput): Promise<AutomaticRecallResult>;
  readOriginal(handle: string): Promise<OriginalRead | undefined>;
  accountsFor(
    originals: OriginalReference[],
    expectedHeads?: Array<{ id: string; revision: number }>,
    attachmentBytes?: number
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
