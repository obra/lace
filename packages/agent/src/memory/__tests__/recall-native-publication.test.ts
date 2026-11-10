// ABOUTME: Exercises the native evaluation's readiness barrier against durable SQLite changes.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  observeRootIndexFailure,
  waitForSearchPublication,
} from '../../../tests/scenarios/recall-native-evaluation';

const generation = 'evaluation-generation';
const incarnation = 'evaluation-incarnation';
const marker = { path: 'marker.md', version: 'current-version' };

describe('native recall publication barrier', () => {
  let directory: string;
  let path: string;
  let db: Database.Database;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'lace-native-publication-'));
    path = join(directory, 'memory.sqlite');
    db = new Database(path);
    db.exec(`
      CREATE TABLE memory_search_state(singleton INTEGER PRIMARY KEY, generation, incarnation, seed_done);
      CREATE TABLE memory_search_pending(sequence INTEGER PRIMARY KEY, identity);
      CREATE TABLE memory_sources(id, version);
      CREATE TABLE memory_passages(id, version, generation, vector);
    `);
    db.prepare('INSERT INTO memory_search_state VALUES (1, ?, ?, 1)').run(generation, incarnation);
    db.prepare('INSERT INTO memory_sources VALUES (?, ?)').run(
      `document:${marker.path}`,
      marker.version
    );
    db.prepare('INSERT INTO memory_passages VALUES (?, ?, ?, ?)').run(
      `document:${marker.path}`,
      marker.version,
      generation,
      Buffer.from([1])
    );
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('accepts a seeded collection with the same incarnation and a published current marker', async () => {
    const remote = vi.fn(async () => incarnation);
    const signal = new AbortController().signal;
    await expect(waitForSearchPublication(path, generation, remote, signal)).resolves.toBe(
      incarnation
    );
    await expect(waitForSearchPublication(path, generation, remote, signal, marker)).resolves.toBe(
      incarnation
    );
    expect(remote).toHaveBeenCalledWith(signal);
  });

  it('unblocks after the seed completes and the durable queue is acknowledged', async () => {
    db.exec(`
      UPDATE memory_search_state SET seed_done=0;
      INSERT INTO memory_search_pending VALUES (1, 'marker');
    `);
    const remote = vi.fn(async () => incarnation);
    const signal = new AbortController().signal;
    const wait = waitForSearchPublication(path, generation, remote, signal, marker);
    expect(remote).not.toHaveBeenCalled();
    db.transaction(() => {
      db.exec('UPDATE memory_search_state SET seed_done=1; DELETE FROM memory_search_pending');
    })();
    await expect(wait).resolves.toBe(incarnation);
    expect(remote).toHaveBeenCalledOnce();
  });

  it.each([
    ['search schema not initialized', 'DROP TABLE memory_search_pending'],
    ['wrong generation', "UPDATE memory_search_state SET generation='other'"],
    ['no incarnation', 'UPDATE memory_search_state SET incarnation=NULL'],
    ['incomplete seed', 'UPDATE memory_search_state SET seed_done=0'],
    ['unpublished writes', "INSERT INTO memory_search_pending VALUES (1, 'marker')"],
    ['superseded marker', "UPDATE memory_sources SET version='new-version'"],
    ['unembedded marker', 'UPDATE memory_passages SET vector=NULL'],
  ])('keeps waiting while %s and propagates cancellation', async (_condition, change) => {
    db.exec(change);
    const remote = vi.fn(async () => incarnation);
    const abort = new AbortController();
    const reason = new Error('evaluation cancelled');
    const wait = waitForSearchPublication(path, generation, remote, abort.signal, marker).catch(
      (error: unknown) => error
    );
    abort.abort(reason);
    expect(await wait).toBe(reason);
    expect(remote).not.toHaveBeenCalled();
  });

  it.each(['foreign incarnation', 'new pending work'] as const)(
    'does not accept %s across the remote check',
    async (change) => {
      const abort = new AbortController();
      const reason = new Error('root stopped');
      const remote = vi.fn(async () => {
        if (change === 'foreign incarnation') return 'other-incarnation';
        db.exec("INSERT INTO memory_search_pending VALUES (1, 'late-write')");
        return incarnation;
      });
      const wait = waitForSearchPublication(path, generation, remote, abort.signal, marker).catch(
        (error: unknown) => error
      );
      await setImmediate();
      abort.abort(reason);
      expect(await wait).toBe(reason);
      expect(remote).toHaveBeenCalledOnce();
    }
  );

  it('propagates a remote verification failure', async () => {
    const failure = new Error('publication verification failed');
    const signal = new AbortController().signal;
    await expect(
      waitForSearchPublication(
        path,
        generation,
        async () => {
          throw failure;
        },
        signal
      )
    ).rejects.toBe(failure);
  });

  it('surfaces a root publication failure while waiting for its pending write', async () => {
    db.exec("INSERT INTO memory_search_pending VALUES (1, 'marker')");
    const stderr = new PassThrough();
    const abort = new AbortController();
    const stop = observeRootIndexFailure(stderr, (error) => abort.abort(error));
    try {
      const wait = waitForSearchPublication(
        path,
        generation,
        async () => incarnation,
        abort.signal
      ).catch((error: unknown) => error);
      stderr.end('2026-11-10T00:00:00.000Z [WARN] memory.search.publication.failed\n');
      expect(await wait).toMatchObject({
        message: expect.stringContaining('memory.search.publication.failed'),
      });
    } finally {
      stop();
    }
  });
});
