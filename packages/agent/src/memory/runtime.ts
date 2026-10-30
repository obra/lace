// ABOUTME: One lifetime-owned worker and authority-checked current-note recall.
import { MemoryConfigurationSchema, type HostMemoryBinding } from '@lace/ent-protocol';
import { randomUUID } from 'node:crypto';
import { oneShotQuery } from '../conversation/one-shot-query';
import { ProviderRegistry } from '../providers/registry';
import { onDurableEventAppend } from '../storage/event-log';
import { logger } from '../utils/logger';
import { assertMemoryAccess, openMemoryDatabase, resolveMemoryBinding } from './authority';
import { MemoryNotes } from './notes';
import { MemorySources } from './sources';
import { localMemoryEncoder, type MemoryEncoder } from './encoder';
import { relatedNotes } from './related';
import { extract, type MemoryQuery } from './extraction';
import {
  MEMORY_LIMITS as L,
  sourceHandle,
  sourceReadHandle,
  type MemoryConfiguration,
  type MemoryRuntime,
  type Source,
  type SuppliedSource,
  type Note,
  type Support,
} from './types';

export function createMemoryRuntime(
  input: MemoryConfiguration,
  deps: {
    query?: MemoryQuery;
    supportsImages?: () => Promise<boolean>;
    encoder?: MemoryEncoder;
  } = {}
): MemoryRuntime {
  const configuration = MemoryConfigurationSchema.parse(input);
  const binding = configuration.binding;
  const db = openMemoryDatabase(configuration.databasePath, binding.instanceId, false);
  try {
    assertMemoryAccess(db, binding, !!configuration.extraction);
    if (!binding.isRoot && (configuration.extraction || configuration.documentSources))
      throw new Error('Only root may configure memory discovery');
    MemorySources.validatePaths(configuration);
  } catch (error) {
    db.close();
    throw error;
  }
  const attempt = randomUUID();
  let notes: MemoryNotes;
  try {
    notes = db
      .transaction(() => {
        assertMemoryAccess(db, binding, !!configuration.extraction);
        const store = new MemoryNotes(db, binding.isRoot && binding.canMutate, () => {
          assertMemoryAccess(db, binding, true);
          if (
            (
              db.prepare('SELECT attempt FROM memory_worker WHERE singleton=1').get() as {
                attempt: string;
              }
            )?.attempt !== attempt
          )
            throw new Error('Extraction attempt replaced');
        });
        if (configuration.extraction)
          db.prepare('INSERT OR REPLACE INTO memory_worker VALUES(1,?)').run(attempt);
        return store;
      })
      .immediate();
  } catch (error) {
    db.close();
    throw error;
  }
  const sources = new MemorySources(notes, configuration);
  const controller = new AbortController();
  let closed = false;
  let pending = false;
  let running: Promise<void> | undefined;
  const supportsImages =
    deps.supportsImages ??
    (async () => {
      const registry = ProviderRegistry.getInstance();
      const config = await registry.getInstanceManager().loadInstances();
      const instance = config.instances[configuration.extraction!.connectionId];
      return (
        !!instance &&
        (
          await registry.getModelFromCatalog(
            instance.catalogProviderId,
            configuration.extraction!.modelId
          )
        )?.supports_attachments === true
      );
    });
  async function support(refs: Source[]) {
    const result = [];
    for (const source of refs) result.push({ ...source, status: await sources.status(source) });
    return result;
  }
  function checkReader(readBinding: HostMemoryBinding) {
    if (closed) throw new Error('Memory runtime closed');
    if (readBinding.instanceId !== binding.instanceId) throw new Error('Memory instance mismatch');
    assertMemoryAccess(db, readBinding);
  }
  async function runBatch(): Promise<boolean> {
    assertMemoryAccess(db, binding, true);
    const available = notes.pending();
    if (!available.length) return false;
    const primary: SuppliedSource[] = [];
    const primaries: SuppliedSource[] = [];
    const candidates: Note[] = [];
    const withheld = notes.omissions();
    let textBytes = 0;
    let imageBytes = 0;
    const images = await supportsImages();
    function checkWorker() {
      if (closed || controller.signal.aborted) throw new Error('Extraction closed');
      assertMemoryAccess(db, binding, true);
      if (
        (
          db.prepare('SELECT attempt FROM memory_worker WHERE singleton=1').get() as {
            attempt: string;
          }
        )?.attempt !== attempt
      )
        throw new Error('Extraction attempt replaced');
    }
    checkWorker();
    async function load(source: Source, isPrimary: boolean): Promise<SuppliedSource> {
      const input = await sources.load(source, images);
      const sourceStatus = await sources.status(source);
      checkWorker();
      if ((isPrimary && sourceStatus !== 'current') || sourceStatus === 'unavailable')
        throw new Error('Source missing, superseded or unavailable');
      return { ...input, sourceStatus };
    }
    function fits(inputs: SuppliedSource[]) {
      return (
        primary.length + inputs.length <= L.sources &&
        textBytes + inputs.reduce((sum, source) => sum + source.textBytes, 0) <= L.sourceBytes &&
        imageBytes + inputs.reduce((sum, source) => sum + source.imageBytes, 0) <= L.imageBytes
      );
    }
    function admit(inputs: SuppliedSource[]) {
      primary.push(...inputs);
      for (const source of inputs) {
        textBytes += source.textBytes;
        imageBytes += source.imageBytes;
      }
    }
    for (const source of available) {
      let fresh: SuppliedSource;
      try {
        fresh = await load(source, true);
      } catch (error) {
        checkWorker();
        const reason = error instanceof Error ? error.message : String(error);
        withheld.push({ id: sourceHandle(source), reason });
        notes.status(source, 'omitted', reason);
        continue;
      }
      const already = primary.some((input) => sourceHandle(input) === sourceHandle(source));
      if (!fits(already ? [] : [fresh])) break;
      const related = await relatedNotes(
        notes,
        deps.encoder ?? localMemoryEncoder,
        fresh.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n'),
        checkWorker
      );
      if (related.reason) withheld.push({ id: sourceHandle(source), reason: related.reason });
      // Stage a fresh original and its entire candidate support before committing capacity.
      const staged = already ? [] : [fresh];
      const stagedCandidates: Note[] = [];
      const rejected: Array<{ id: string; reason: string }> = [];
      let split = false;
      for (const note of related.notes) {
        if (candidates.some((candidate) => candidate.id === note.id)) continue;
        if (candidates.length + stagedCandidates.length >= L.candidates) {
          rejected.push({ id: `memory:${note.id}`, reason: 'Candidate union budget; unexamined' });
          continue;
        }
        const needed: SuppliedSource[] = [];
        try {
          for (const ref of note.sources) {
            if (
              [...primary, ...staged, ...needed].some(
                (input) => sourceHandle(input) === sourceHandle(ref)
              )
            )
              continue;
            needed.push(await load(ref, false));
          }
          if (!fits([...staged, ...needed])) {
            if (primaries.length) {
              split = true;
              break;
            }
            throw new Error('Candidate support request budget');
          }
          staged.push(...needed);
          stagedCandidates.push(note);
        } catch (error) {
          checkWorker();
          rejected.push({
            id: `memory:${note.id}`,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (split) {
        withheld.push({
          id: sourceHandle(source),
          reason: 'Fresh original deferred with candidate support to next batch',
        });
        break;
      }
      admit(staged);
      candidates.push(...stagedCandidates);
      withheld.push(...rejected);
      primaries.push(fresh);
    }
    if (!primaries.length) return false;
    const offered = primary.map(({ id, version, reference }) => ({ id, version, reference }));
    const workId = notes.offer(
      primary,
      candidates,
      JSON.stringify(configuration.extraction),
      primaries,
      withheld
    );
    try {
      const proposal = await extract(
        deps.query ?? oneShotQuery,
        configuration.extraction!,
        primary,
        candidates,
        withheld,
        controller.signal
      );
      if (closed) return false;
      // Refresh heads even when a final-turn Git commit happened during inference.
      await sources.documents();
      for (const source of primary)
        if ((await sources.status(source)) !== source.sourceStatus)
          throw new Error('Offered source changed during extraction');
      for (const change of proposal.changes)
        for (const id of change.sourceIds)
          if (!primary.some((s) => sourceHandle(s) === id && s.sourceStatus === 'current'))
            throw new Error('Unoffered or non-current support');
      notes.accept(
        binding,
        attempt,
        workId,
        offered,
        candidates,
        proposal,
        () => {
          if (closed || controller.signal.aborted) throw new Error('Extraction closed');
          sources.validateAtAcceptance(primary);
          for (const source of primaries)
            if (source.reference.kind === 'document') {
              const current = db
                .prepare('SELECT version FROM memory_documents WHERE path=?')
                .get(source.reference.path) as { version: string | null } | undefined;
              if (current?.version !== source.version) throw new Error('Document head changed');
            }
        },
        primaries
      );
    } catch (error) {
      if (!closed) {
        const detail = error instanceof Error ? error.message : String(error);
        // Never write coverage after this process has lost its host authority.
        try {
          assertMemoryAccess(db, binding, true);
          if (
            (
              db.prepare('SELECT attempt FROM memory_worker WHERE singleton=1').get() as {
                attempt: string;
              }
            )?.attempt === attempt
          )
            notes.failed(workId, primaries, detail);
        } catch {
          /* Replaced owners cannot mutate receipts. */
        }
        logger.warn('memory.extraction.failed', { detail });
      }
      return false;
    }
    return available.length > primaries.length;
  }
  function wake(): Promise<void> {
    if (closed || !configuration.extraction) return Promise.resolve();
    pending = true;
    if (!running)
      running = (async () => {
        try {
          do {
            pending = false;
            await sources.discover();
            while (!closed && (await runBatch())) {
              /* Each batch awaits its sole provider call. */
            }
          } while (pending && !closed);
        } catch (error) {
          logger.warn('memory.worker.failed', { error: String(error) });
        } finally {
          running = undefined;
        }
      })();
    return running;
  }
  const unsubscribe = configuration.extraction
    ? onDurableEventAppend(() => {
        void wake();
      })
    : undefined;
  const timer = configuration.extraction
    ? setInterval(() => {
        void wake();
      }, L.maintenanceMs)
    : undefined;
  timer?.unref();
  return {
    configuration,
    reader(readBinding) {
      checkReader(readBinding);
      return {
        async accountsFor(originals, expectedHeads = []) {
          checkReader(readBinding);
          if (!notes.available()) return originals.map(() => ({ accounts: [] }));
          const groups = originals.map((original) => {
            try {
              return { original, heads: notes.linked(original) };
            } catch (error) {
              return { original, heads: [], reason: String(error) };
            }
          });
          const checked = new Map<string, { note: Note; refs: Support[] }>();
          for (const group of groups) {
            for (const note of group.heads) {
              if (checked.has(note.id)) continue;
              checked.set(note.id, { note, refs: await support(note.sources) });
              checkReader(readBinding);
            }
          }
          // No awaited work follows these authority/head/source checks. All groups share this fence.
          checkReader(readBinding);
          for (const expected of expectedHeads) {
            if (notes.note(expected.id)?.revision !== expected.revision)
              throw new Error('Current account revision changed during recall');
          }
          return groups.map((group) => {
            try {
              if (group.reason) throw new Error(group.reason);
              const current = notes.linked(group.original);
              if (
                current.length !== group.heads.length ||
                current.some(
                  (head) =>
                    !group.heads.some(
                      (note) => note.id === head.id && note.revision === head.revision
                    )
                )
              )
                throw new Error('Linked current accounts changed during recall');
              const accounts = group.heads.map((head) => {
                const { note, refs } = checked.get(head.id)!;
                if (notes.note(note.id)?.revision !== note.revision)
                  throw new Error('Current account revision changed during recall');
                if (!refs.length || refs.some((ref) => ref.status !== 'current'))
                  throw new Error('Required current account support unavailable or non-current');
                sources.validateAtAcceptance(
                  refs.map((ref) => ({
                    ...ref,
                    sourceStatus: 'current',
                    content: [],
                    textBytes: 0,
                    imageBytes: 0,
                  }))
                );
                return {
                  id: note.id,
                  revision: note.revision,
                  text: note.text,
                  attribution: note.producer,
                  support: refs.map((ref) => ({
                    handle: sourceReadHandle(ref),
                    status: ref.status,
                  })),
                };
              });
              return { accounts };
            } catch (error) {
              return { reason: error instanceof Error ? error.message : String(error) };
            }
          });
        },
        async search(query, limit) {
          checkReader(readBinding);
          if (!notes.available()) return [];
          const rows = db
            .prepare('SELECT id FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?')
            .all(query, Math.min(limit, L.candidates)) as { id: string }[];
          const results = [];
          for (const { id } of rows) {
            const note = notes.note(id);
            if (!note) continue;
            const refs = await support(note.sources);
            checkReader(readBinding);
            if (notes.note(note.id)?.revision !== note.revision)
              throw new Error('Current account revision changed during recall');
            results.push({
              event_id: `memory:${id}`,
              revision: note.revision,
              preview: note.text.slice(0, 500),
              attribution: note.producer,
              support: refs,
            });
          }
          checkReader(readBinding);
          for (const result of results)
            if (notes.note(result.event_id.slice(7))?.revision !== result.revision)
              throw new Error('Current account revision changed during recall');
          return results;
        },
        async read(id) {
          checkReader(readBinding);
          if (!notes.available()) return undefined;
          const note = notes.note(id);
          if (!note) return undefined;
          const refs = await support(note.sources);
          checkReader(readBinding);
          if (notes.note(note.id)?.revision !== note.revision)
            throw new Error('Current account revision changed during recall');
          const { sources: _sources, ...head } = note;
          return { ...head, support: refs };
        },
      };
    },
    bindingForRole(role, actorId) {
      return resolveMemoryBinding(db, binding, role, actorId);
    },
    wake,
    async close() {
      if (closed) return;
      closed = true;
      unsubscribe?.();
      if (timer) clearInterval(timer);
      // Fence synchronously before aborting; a provider may ignore the abort.
      controller.abort();
      db.close();
    },
  };
}
