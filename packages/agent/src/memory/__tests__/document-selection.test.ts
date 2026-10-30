import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HostMemoryBinding } from '@lace/ent-protocol';
import { claimMemoryOwner, configureMemoryRoles, openMemoryDatabase } from '../authority';
import { createMemoryRuntime } from '../runtime';
import type { MemoryQuery } from '../extraction';

const roots = ['user/knowledge', 'user/journal'];
const first = 'user/journal/2026-10-29/12-00-00.md';
const cache = 'user/journal/2026-10-29/12-00-00.embedding';
const knowledge = 'user/knowledge/preferences.md';
const later = 'user/journal/2026-10-30/09-00-00.md';
const grant = {
  producerId: 'persona:root',
  canRead: true,
  canMutate: true,
  collections: [],
  writableCollections: [],
};

describe('committed document source selection', () => {
  let directory: string;
  let gitRoot: string;
  let databasePath: string;
  let binding: HostMemoryBinding;
  let runtime: ReturnType<typeof createMemoryRuntime> | undefined;
  function git(...args: string[]) {
    return execFileSync('git', ['-C', gitRoot, ...args], { encoding: 'utf8' });
  }
  function write(path: string, text: string) {
    const file = join(gitRoot, path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
  }
  function commit(paths: string[]) {
    git('add', '--', ...paths);
    git(
      '-c',
      'user.name=Memory Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-m',
      'document fixture'
    );
  }
  function open(extensions?: string[]) {
    const offered: string[][] = [];
    const query: MemoryQuery = async (options) => {
      const block = options.messages[0].content[0];
      if (typeof block !== 'object' || block.type !== 'text')
        throw new Error('Expected extraction text');
      const body = JSON.parse(block.text) as { sources: Array<{ reference: { path: string } }> };
      offered.push(body.sources.map((source) => source.reference.path).sort());
      return { text: '{"changes":[]}', stopReason: 'end_turn', toolCalls: [] };
    };
    runtime = createMemoryRuntime(
      {
        databasePath,
        binding,
        extraction: { connectionId: 'fake', modelId: 'fake' },
        documentSources: { gitRoot, paths: roots, ...(extensions ? { extensions } : {}) },
      },
      { query, supportsImages: async () => false }
    );
    return { worker: runtime, offered };
  }
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'lace-source-selection-'));
    gitRoot = join(directory, 'tree');
    mkdirSync(gitRoot);
    git('init');
    vi.stubEnv('LACE_DIR', join(directory, 'state'));
    vi.stubEnv('LACE_SESSION_DIR', join(directory, 'sessions'));
    write(first, 'An original journal entry.');
    write(cache, JSON.stringify({ text: 'An original journal entry.', embedding: [0.1, 0.2] }));
    write(knowledge, 'A Markdown knowledge page.');
    write('outside.md', 'This Markdown file is outside configured roots.');
    commit([first, cache, knowledge, 'outside.md']);
    databasePath = join(directory, 'memory.sqlite');
    binding = {
      ...grant,
      instanceId: 'instance',
      role: 'root',
      actorId: 'host',
      isRoot: true,
      ownerGeneration: claimMemoryOwner('instance', databasePath, 'root'),
    };
    const db = openMemoryDatabase(databasePath, 'instance', false);
    configureMemoryRoles(db, binding, { root: grant });
    db.close();
  });
  afterEach(async () => {
    await runtime?.close();
    runtime = undefined;
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it('admits Markdown originals, excludes sibling caches and discovers later Markdown commits', async () => {
    const { worker, offered } = open(['.md']);
    await worker.wake();
    expect(offered).toEqual([[first, knowledge].sort()]);
    write(later, 'A newly committed journal entry.');
    write(
      later.replace('.md', '.embedding'),
      '{"text":"A newly committed journal entry.","embedding":[0.3]}'
    );
    commit(['user/journal']);
    await worker.wake();
    expect(offered).toEqual([[first, knowledge].sort(), [later]]);
    const db = openMemoryDatabase(databasePath, 'instance', false);
    const sources = db.prepare('SELECT reference FROM memory_sources').all() as Array<{
      reference: string;
    }>;
    expect(sources.map((source) => JSON.parse(source.reference).path).sort()).toEqual(
      [first, knowledge, later].sort()
    );
    expect(db.prepare('SELECT path FROM memory_documents ORDER BY path').all()).toEqual(
      [first, knowledge, later].sort().map((path) => ({ path }))
    );
    db.close();
  });

  it('keeps unfiltered literal-root admission unchanged when extensions are omitted', async () => {
    const { worker, offered } = open();
    await worker.wake();
    expect(offered).toEqual([[first, cache, knowledge].sort()]);
  });
});
