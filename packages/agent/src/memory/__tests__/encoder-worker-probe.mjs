// ABOUTME: Exercises encoder worker lifetime in a fresh process, without native model weights.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setImmediate } from 'node:timers/promises';
import { URL } from 'node:url';
import threads, {
  isMainThread,
  MessageChannel,
  parentPort,
  Worker,
  workerData,
} from 'node:worker_threads';

async function loadEncoder(mode) {
  if (mode === 'compiled') return import('../../../dist/memory/encoder.js');
  if (mode === 'tsImport') {
    const { tsImport } = await import('tsx/esm/api');
    return tsImport('../encoder.ts', import.meta.url);
  }
  return import('../encoder.ts');
}

if (isMainThread) {
  const [mode, scenario] = process.argv.slice(2);
  let workers = 0;
  threads.Worker = class extends Worker {
    constructor(entry, options) {
      if (scenario === 'missing') {
        super(entry, options);
      } else {
        const { port1, port2 } = new MessageChannel();
        super(new URL(import.meta.url), { workerData: port2, transferList: [port2] });
        // This control channel must not keep the probe alive while inference is pending.
        port1.on('message', async () => {
          await setImmediate();
          port1.postMessage('release');
        });
        port1.unref();
      }
      workers++;
    }
  };
  syncBuiltinESMExports();

  const { configureMemoryEncoderDirectory, localMemoryEncoder } = await loadEncoder(mode);
  const directory = await mkdtemp(join(tmpdir(), 'lace-encoder-test-'));
  try {
    assert.deepEqual(await localMemoryEncoder.encode([], 'query'), []);
    assert.equal(workers, 0, 'empty batches must not start a worker');
    configureMemoryEncoderDirectory(directory);

    if (scenario === 'missing') {
      const missing = (error) =>
        error.message.includes('ENOENT') && error.message.includes(directory);
      await assert.rejects(localMemoryEncoder.encode(['hello'], 'query'), missing);
      assert.equal(workers, 1, 'the local encoder must verify assets inside its worker');
      const extension = mode === 'compiled' ? 'js' : 'ts';
      await assert.rejects(localMemoryEncoder.encode(['hello'], 'query'), (error) => {
        return missing(error) && error.stack.includes(`/encoder-worker.${extension}:`);
      });
      await writeFile(join(directory, 'README.md'), 'invalid model asset');
      await assert.rejects(localMemoryEncoder.encode(['hello'], 'query'), missing);
    } else if (scenario === 'request-error') {
      await assert.rejects(localMemoryEncoder.encode(['request-error'], 'query'), /batch failed/);
      assert.deepEqual(await localMemoryEncoder.encode(['abc', 'd'], 'query'), [
        [3, 1],
        [1, 1],
      ]);
      assert.deepEqual(await localMemoryEncoder.encode(['abc'], 'document'), [[3, 0]]);
    } else {
      const failure = scenario === 'zero-exit' ? /worker.*exited.*0/i : /worker fixture crashed/;
      if (scenario === 'uncaught-error') {
        assert.deepEqual(await localMemoryEncoder.encode(['abc'], 'document'), [[3, 0]]);
      }
      const active = localMemoryEncoder.encode([scenario], 'document');
      const queued = localMemoryEncoder.encode(['queued'], 'query');
      await Promise.all([assert.rejects(active, failure), assert.rejects(queued, failure)]);
      await assert.rejects(localMemoryEncoder.encode(['later'], 'document'), failure);
    }

    assert.equal(workers, 1, 'all nonempty batches must use the same worker');
    process.stdout.write('completed\n');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
} else {
  parentPort.on('message', async ({ texts, kind }) => {
    await new Promise((resolve) => {
      workerData.once('message', resolve);
      workerData.postMessage('waiting');
    });
    if (texts[0] === 'zero-exit') process.exit(0);
    if (texts[0] === 'uncaught-error') throw new Error('worker fixture crashed');
    parentPort.postMessage(
      texts[0] === 'request-error'
        ? { error: { name: 'Error', message: 'batch failed' } }
        : { vectors: texts.map((text) => [text.length, kind === 'query' ? 1 : 0]) }
    );
  });
}
