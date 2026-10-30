import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database, { type Database as Db } from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HostMemoryBinding, MemoryRoles } from '@lace/ent-protocol';
import {
  assertMemoryAccess,
  assertMemoryCollectionAccess,
  claimMemoryOwner,
  configureMemoryRoles,
  MemoryAccessDenied,
  memoryOwnerGeneration,
  openMemoryDatabase,
  resolveMemoryBinding,
} from '../authority';

const roles: MemoryRoles = {
  root: {
    producerId: 'persona:root',
    canRead: true,
    canMutate: true,
    collections: ['private'],
    writableCollections: ['private'],
  },
  librarian: {
    producerId: 'persona:librarian',
    canRead: true,
    canMutate: false,
    collections: ['knowledge'],
    writableCollections: ['knowledge'],
  },
  reader: {
    producerId: 'persona:reader',
    canRead: true,
    canMutate: false,
    collections: ['knowledge'],
    writableCollections: [],
  },
};

describe('memory authority', () => {
  let directory: string;
  let path: string;
  const connections: Db[] = [];

  function open(instanceId = 'instance', create = true): Db {
    const db = openMemoryDatabase(path, instanceId, create);
    connections.push(db);
    return db;
  }

  function owned(): { db: Db; root: HostMemoryBinding } {
    const generation = claimMemoryOwner('instance', path, 'root');
    const db = open();
    const root: HostMemoryBinding = {
      ...roles.root!,
      instanceId: 'instance',
      ownerGeneration: generation,
      role: 'root',
      actorId: 'host',
      isRoot: true,
    };
    configureMemoryRoles(db, root, roles);
    return { db, root };
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'lace-memory-authority-'));
    path = join(directory, 'memory', 'authority.sqlite');
  });

  afterEach(() => {
    for (const db of connections.splice(0)) if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('creates only authority state and reopens the same identity without claiming an owner', () => {
    const db = open();
    expect(memoryOwnerGeneration(db)).toBeNull();
    expect(db.prepare('SELECT instance_id FROM memory_authority').get()).toEqual({
      instance_id: 'instance',
    });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([
      { name: 'memory_authority' },
    ]);
    db.close();
    expect(memoryOwnerGeneration(open('instance', false))).toBeNull();
  });

  it('uses private files, durable WAL, foreign keys and a finite wait', () => {
    const db = open();
    expect(statSync(join(directory, 'memory')).mode & 0o777).toBe(0o700);
    for (const suffix of ['', '-wal', '-shm'])
      expect(statSync(path + suffix).mode & 0o777).toBe(0o600);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('synchronous', { simple: true })).toBe(2);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('does not create a missing authority or its directory in existing-only mode', () => {
    expect(() => open('instance', false)).toThrow();
    expect(existsSync(join(directory, 'memory'))).toBe(false);
  });

  it('rejects an empty instance identity before creating files', () => {
    expect(() => open('')).toThrow(MemoryAccessDenied);
    expect(existsSync(join(directory, 'memory'))).toBe(false);
  });

  for (const create of [false, true]) {
    for (const kind of ['wrong-instance', 'unrelated', 'empty'] as const) {
      it(`rejects an existing ${kind} database without changing it (create=${create})`, () => {
        path = join(directory, 'existing.sqlite');
        const foreign = new Database(path);
        if (kind === 'wrong-instance') {
          foreign.exec(`CREATE TABLE memory_authority(singleton INTEGER PRIMARY KEY, instance_id TEXT);
            INSERT INTO memory_authority VALUES(1, 'foreign');`);
        }
        if (kind !== 'empty') {
          foreign.exec(
            "CREATE TABLE retained(value TEXT); INSERT INTO retained VALUES('untouched');"
          );
          foreign.pragma('user_version = 37');
        }
        foreign.close();
        const bytes = readFileSync(path);
        const mode = statSync(path).mode;
        expect(() => open('instance', create)).toThrow();
        expect(readFileSync(path)).toEqual(bytes);
        expect(statSync(path).mode).toBe(mode);
        expect(existsSync(path + '-wal')).toBe(false);
        expect(existsSync(path + '-shm')).toBe(false);
        const retained = new Database(path, { readonly: true });
        expect(retained.pragma('journal_mode', { simple: true })).toBe('delete');
        if (kind !== 'empty') {
          expect(retained.pragma('user_version', { simple: true })).toBe(37);
          expect(retained.prepare('SELECT * FROM retained').all()).toEqual([
            { value: 'untouched' },
          ]);
        }
        retained.close();
      });
    }
  }

  it('rotates ownership and fences both retained root and child bindings on open connections', () => {
    const { db, root } = owned();
    const child = resolveMemoryBinding(db, root, 'reader', 'child');
    const generation = claimMemoryOwner('instance', path, 'root');
    expect(generation).not.toBe(root.ownerGeneration);
    expect(memoryOwnerGeneration(db)).toBe(generation);
    expect(() => assertMemoryAccess(db, root)).toThrow(MemoryAccessDenied);
    expect(() => assertMemoryAccess(db, child)).toThrow(MemoryAccessDenied);
    expect(() =>
      assertMemoryAccess(db, { ...root, ownerGeneration: generation }, true)
    ).not.toThrow();
  });

  it('pins the root role across claims and rejects an empty root role', () => {
    const { db, root } = owned();
    expect(() => claimMemoryOwner('instance', path, 'other')).toThrow('Memory root role mismatch');
    expect(() => claimMemoryOwner('instance', path, ' ')).toThrow('Memory root role is required');
    expect(memoryOwnerGeneration(db)).toBe(root.ownerGeneration);
    expect(() => assertMemoryAccess(db, root)).not.toThrow();
  });

  it('allows only the current root role and producer to publish host permissions', () => {
    const { db, root } = owned();
    const child = resolveMemoryBinding(db, root, 'librarian', 'child');
    expect(() => configureMemoryRoles(db, child, roles)).toThrow('Memory root access denied');
    expect(() => configureMemoryRoles(db, { ...root, role: 'librarian' }, roles)).toThrow(
      'Memory root access denied'
    );
    expect(() => configureMemoryRoles(db, { ...root, producerId: 'forged' }, roles)).toThrow(
      'Memory root producer mismatch'
    );
    expect(() => assertMemoryAccess(db, root, true)).not.toThrow();
  });

  it('rolls back policy replacement when its final access check rejects the root', () => {
    const { db, root } = owned();
    const previous = db.prepare('SELECT * FROM memory_authority').get();
    expect(() =>
      configureMemoryRoles(db, root, { ...roles, root: { ...roles.root!, canRead: false } })
    ).toThrow(MemoryAccessDenied);
    expect(db.prepare('SELECT * FROM memory_authority').get()).toEqual(previous);
    expect(() => assertMemoryAccess(db, root, true)).not.toThrow();
  });

  it('rejects malformed policy without replacing current permissions', () => {
    const { db, root } = owned();
    expect(() =>
      configureMemoryRoles(db, root, { ...roles, root: { ...roles.root!, producerId: '' } })
    ).toThrow();
    expect(() => assertMemoryAccess(db, root, true)).not.toThrow();
  });

  it('resolves configured collection authorship independently of parent and note mutation', () => {
    const { db, root } = owned();
    const parent = resolveMemoryBinding(db, root, 'reader', 'parent');
    const librarian = resolveMemoryBinding(db, parent, 'librarian', 'child');
    expect(librarian.isRoot).toBe(false);
    expect(librarian.actorId).toBe('child');
    expect(() => assertMemoryAccess(db, librarian, true)).toThrow(MemoryAccessDenied);
    expect(() => assertMemoryCollectionAccess(db, librarian, 'knowledge', true)).not.toThrow();
    expect(() => assertMemoryCollectionAccess(db, librarian, 'private')).toThrow(
      MemoryAccessDenied
    );
    expect(() => assertMemoryCollectionAccess(db, parent, 'knowledge')).not.toThrow();
    expect(() => assertMemoryCollectionAccess(db, parent, 'knowledge', true)).toThrow(
      MemoryAccessDenied
    );
  });

  it('strips note and collection writes from children selecting the root persona', () => {
    const { db, root } = owned();
    const child = resolveMemoryBinding(db, root, 'root', 'child');
    expect(child.canMutate).toBe(false);
    expect(child.writableCollections).toEqual([]);
    expect(() => assertMemoryAccess(db, child)).not.toThrow();
    expect(() => assertMemoryAccess(db, child, true)).toThrow(MemoryAccessDenied);
    expect(() => assertMemoryCollectionAccess(db, child, 'private', true)).toThrow(
      MemoryAccessDenied
    );
    expect(() => assertMemoryAccess(db, { ...child, canMutate: true })).toThrow(MemoryAccessDenied);
    expect(() => assertMemoryAccess(db, { ...child, writableCollections: ['private'] })).toThrow(
      MemoryAccessDenied
    );
  });

  it('gives unknown roles baseline reads without note or collection writes', () => {
    const { db, root } = owned();
    const child = resolveMemoryBinding(db, root, 'unknown', 'child');
    expect(child.producerId).toBe('persona:unknown');
    expect(child.canRead).toBe(true);
    expect(child.canMutate).toBe(false);
    expect(child.collections).toEqual([]);
    expect(child.writableCollections).toEqual([]);
    expect(() => assertMemoryAccess(db, child)).not.toThrow();
    expect(() => assertMemoryAccess(db, child, true)).toThrow(MemoryAccessDenied);
    expect(() => assertMemoryCollectionAccess(db, child, 'knowledge')).toThrow(MemoryAccessDenied);
  });

  it('revokes stale grants while keeping compatible baseline reads after role removal', () => {
    const { db, root } = owned();
    const child = resolveMemoryBinding(db, root, 'librarian', 'child');
    const baseline = { ...child, collections: [], writableCollections: [] };
    configureMemoryRoles(db, root, { root: roles.root! });
    expect(() => assertMemoryAccess(db, child)).toThrow(MemoryAccessDenied);
    expect(() => assertMemoryAccess(db, baseline)).not.toThrow();
  });

  it('rejects identity, producer, role, read and collection escalation', () => {
    const { db, root } = owned();
    const reader = resolveMemoryBinding(db, root, 'reader', 'child');
    const invalid = [
      { ...reader, instanceId: 'other' },
      { ...reader, producerId: 'persona:root' },
      { ...reader, role: 'librarian' },
      { ...reader, canRead: false },
      { ...reader, actorId: '' },
      { ...reader, isRoot: true },
      { ...reader, canMutate: true },
      { ...reader, collections: ['private'] },
      { ...reader, writableCollections: ['knowledge'] },
      { ...root, collections: [], writableCollections: ['private'] },
    ];
    for (const binding of invalid)
      expect(() => assertMemoryAccess(db, binding)).toThrow(MemoryAccessDenied);
  });

  it('observes policy changes inside the caller transaction and rolls back denied work', () => {
    const { db, root } = owned();
    const child = resolveMemoryBinding(db, root, 'librarian', 'child');
    db.exec('CREATE TABLE accepted(value TEXT)');
    expect(() =>
      db
        .transaction(() => {
          db.prepare("INSERT INTO accepted VALUES('uncommitted')").run();
          configureMemoryRoles(db, root, {
            ...roles,
            librarian: { ...roles.librarian!, canRead: false },
          });
          assertMemoryCollectionAccess(db, child, 'knowledge', true);
        })
        .immediate()
    ).toThrow(MemoryAccessDenied);
    expect(db.prepare('SELECT * FROM accepted').all()).toEqual([]);
    expect(() => assertMemoryCollectionAccess(db, child, 'knowledge', true)).not.toThrow();
  });
});
