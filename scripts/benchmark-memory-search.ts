// ABOUTME: Prepare and run a private, persistent Qdrant memory index qualification.
import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import {
  configureMemoryEncoderDirectory,
  localMemoryEncoder,
} from '../packages/agent/src/memory/encoder';
import {
  createOutput,
  exerciseMutations,
  importSnapshot,
  prepareSnapshot,
  qdrantCollection,
  querySnapshot,
  TOP,
  validateVector,
} from './lib/memory-search-benchmark';

const usage = `Usage: tsx scripts/benchmark-memory-search.ts <command> [options]

  prepare   --snapshot FILE --panel FILE --model-dir DIR --output FRESH_DIR
  import    --snapshot FILE --prepared DIR --qdrant-url URL --collection NAME --output FRESH_DIR
  query     --snapshot FILE --prepared DIR --qdrant-url URL --collection NAME --output FRESH_DIR [--mode exact|hnsw|both]
  mutations --prepared DIR --qdrant-url URL --collection NAME --output FRESH_DIR [--verify]

For Qdrant commands, pass --api-key-file FILE when authentication is configured.
See docs/development/memory-search-benchmark.md.`;

const queryPanel = z.object({
  queries: z.array(z.object({ id: z.string().min(1), text: z.string().min(1) })).min(1),
});
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const preparedFile = z.object({
  dataset: z.object({
    runId: z.string().uuid(),
    generation: z.string().min(1),
    points: z.number().int().positive(),
    digest,
    fileDigest: digest,
  }),
  queries: z
    .array(
      z.object({
        id: z.string().min(1),
        vector: z.array(z.number()),
        reference: z
          .array(z.object({ id: z.string().uuid(), score: z.number().finite() }))
          .min(1)
          .max(TOP),
      })
    )
    .min(1),
});

function readJson(file: string): unknown {
  const text = readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON input');
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help') {
    process.stdout.write(`${usage}\n`);
    return;
  }
  if (!['prepare', 'import', 'query', 'mutations'].includes(command))
    throw new Error('Unknown benchmark command');
  const { values } = parseArgs({
    args,
    options: {
      snapshot: { type: 'string' },
      panel: { type: 'string' },
      'model-dir': { type: 'string' },
      prepared: { type: 'string' },
      'qdrant-url': { type: 'string' },
      'api-key-file': { type: 'string' },
      collection: { type: 'string' },
      output: { type: 'string' },
      mode: { type: 'string' },
      verify: { type: 'boolean' },
    },
  });
  function required(name: keyof typeof values) {
    const value = values[name];
    if (typeof value !== 'string' || !value) throw new Error(`Missing --${name}`);
    return value;
  }
  const output = required('output');
  createOutput(output);
  const events = openSync(join(output, 'events.jsonl'), 'wx', 0o600);
  const record = (event: Record<string, unknown>) =>
    writeSync(events, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
  const save = (name: string, data: unknown) =>
    writeFileSync(join(output, `${name}.json`), `${JSON.stringify(data)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
  const started = performance.now();
  try {
    record({ event: 'start', command });
    if (command === 'prepare') {
      const panel = queryPanel.safeParse(readJson(required('panel')));
      if (!panel.success)
        throw new Error('Expected a nonempty query panel with string IDs and text');
      const { queries } = panel.data;
      if (new Set(queries.map(({ id }) => id)).size !== queries.length)
        throw new Error('Query panel IDs must be unique');
      const snapshot = required('snapshot');
      configureMemoryEncoderDirectory(required('model-dir'));
      const encodeStarted = performance.now();
      const vectors = await localMemoryEncoder.encode(
        queries.map(({ text }) => text),
        'query'
      );
      if (vectors.length !== queries.length)
        throw new Error('Encoder returned a mismatched number of query vectors');
      record({
        event: 'queries-encoded',
        queries: queries.length,
        elapsedMs: performance.now() - encodeStarted,
      });
      const mapping = openSync(join(output, 'point-mapping.jsonl'), 'wx', 0o600);
      try {
        const prepared = prepareSnapshot(
          snapshot,
          localMemoryEncoder.generation,
          queries.map(({ id }, index) => ({ id, vector: vectors[index] })),
          (points) =>
            writeSync(mapping, `${points.map((point) => JSON.stringify(point)).join('\n')}\n`)
        );
        save('prepared', prepared);
        record({ event: 'prepared', dataset: prepared.dataset, queries: queries.length });
      } finally {
        closeSync(mapping);
      }
    } else {
      const saved = preparedFile.safeParse(readJson(join(required('prepared'), 'prepared.json')));
      if (!saved.success) throw new Error('Invalid prepared benchmark artifact');
      const prepared = saved.data;
      for (const query of prepared.queries) validateVector(query.vector);
      if (prepared.dataset.generation !== localMemoryEncoder.generation)
        throw new Error('Prepared encoder generation differs from the current encoder');
      const key =
        values['api-key-file'] === undefined
          ? undefined
          : readFileSync(required('api-key-file'), 'utf8').trim();
      if (key !== undefined && !/^[\x21-\x7e]+$/.test(key)) throw new Error('Invalid API key file');
      const collection = qdrantCollection(required('qdrant-url'), required('collection'), key);
      record({ event: 'target', collection: collection.name });
      switch (command) {
        case 'import':
          save(
            'import',
            await importSnapshot(collection, required('snapshot'), prepared.dataset, record)
          );
          break;
        case 'query': {
          const mode = values.mode ?? 'both';
          if (mode !== 'exact' && mode !== 'hnsw' && mode !== 'both')
            throw new Error('Expected --mode exact, hnsw, or both');
          save(
            'query',
            await querySnapshot(
              collection,
              required('snapshot'),
              prepared,
              mode === 'both' ? ['exact', 'hnsw'] : [mode],
              record
            )
          );
          break;
        }
        case 'mutations':
          save(
            'mutations',
            await exerciseMutations(collection, prepared.dataset, values.verify ?? false, record)
          );
      }
    }
    record({ event: 'complete', elapsedMs: performance.now() - started });
    process.stdout.write(`Memory search benchmark ${command} completed.\n`);
  } catch (error) {
    record({
      event: 'failed',
      error: error instanceof Error ? error.message : 'Unknown failure',
      elapsedMs: performance.now() - started,
    });
    throw new Error('Benchmark failed. See the private events.jsonl in the output directory.');
  } finally {
    closeSync(events);
  }
}

try {
  await main();
} catch (error) {
  // Avoid printing error details that could contain input paths or private query material.
  const message =
    error instanceof Error && error.message.startsWith('Benchmark failed.')
      ? error.message
      : 'Benchmark could not start. Run with --help for arguments and use a fresh output directory.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
