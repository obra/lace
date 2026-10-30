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
import { extract, type MemoryQuery } from './extraction';
import {
  MEMORY_LIMITS as L,
  sourceHandle,
  type MemoryConfiguration,
  type MemoryRuntime,
  type Source,
  type SuppliedSource,
  type Note,
} from './types';

export function createMemoryRuntime(
  input: MemoryConfiguration,
  deps: { query?: MemoryQuery; supportsImages?: () => Promise<boolean> } = {}
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
    const withheld = notes.omissions();
    let textBytes = 0;
    let imageBytes = 0;
    const images = await supportsImages();
    async function offer(source: Source, isPrimary: boolean): Promise<boolean> {
      if (primary.some((s) => sourceHandle(s) === sourceHandle(source))) return true;
      try {
        const input = await sources.load(source, images);
        const sourceStatus = await sources.status(source);
        if ((isPrimary && sourceStatus !== 'current') || sourceStatus === 'unavailable')
          throw new Error('Source missing, superseded or unavailable');
        const loaded = { ...input, sourceStatus };
        if (
          primary.length >= L.sources ||
          textBytes + loaded.textBytes > L.sourceBytes ||
          imageBytes + loaded.imageBytes > L.imageBytes
        ) {
          withheld.push({ id: sourceHandle(source), reason: 'Request input budget' });
          return false;
        }
        primary.push(loaded);
        textBytes += loaded.textBytes;
        imageBytes += loaded.imageBytes;
        return true;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        withheld.push({ id: sourceHandle(source), reason });
        if (isPrimary) notes.status(source, 'omitted', reason);
        return false;
      }
    }
    for (const source of available) await offer(source, true);
    if (!primary.length) return false;
    const primaries = [...primary];
    const candidates: Note[] = [];
    for (const note of notes.candidates()) {
      // A candidate's prose alone is never support for keeping its claims.
      const needed = note.sources.filter(
        (s) => !primary.some((p) => sourceHandle(p) === sourceHandle(s))
      );
      if (primary.length + needed.length > L.sources) continue;
      let complete = true;
      for (const source of needed) if (!(await offer(source, false))) complete = false;
      if (complete) candidates.push(note);
    }
    const offered = primary.map(({ id, version, reference }) => ({ id, version, reference }));
    const workId = notes.offer(
      primary,
      candidates,
      JSON.stringify(configuration.extraction),
      primaries
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
            results.push({
              event_id: `memory:${id}`,
              revision: note.revision,
              preview: note.text.slice(0, 500),
              attribution: note.producer,
              support: refs,
            });
          }
          return results;
        },
        async read(id) {
          checkReader(readBinding);
          if (!notes.available()) return undefined;
          const note = notes.note(id);
          if (!note) return undefined;
          const refs = await support(note.sources);
          checkReader(readBinding);
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
