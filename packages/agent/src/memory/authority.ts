// ABOUTME: Internal SQLite identity, ownership and memory permission checks.
import {
  MemoryBindingSchema,
  MemoryRolesSchema,
  type HostMemoryBinding as MemoryBinding,
  type MemoryRoles,
} from '@lace/ent-protocol';
import Database, { type Database as Db } from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class MemoryAccessDenied extends Error {}

function assertMemoryInstance(db: Db, instanceId: string): void {
  const authority = db
    .prepare('SELECT instance_id FROM memory_authority WHERE singleton = 1')
    .get() as { instance_id: string } | undefined;
  if (authority?.instance_id !== instanceId) throw new MemoryAccessDenied('Memory access denied');
}

/** Readers must pass create=false so a missing authority stays unavailable. */
export function openMemoryDatabase(path: string, instanceId: string, create = true): Db {
  if (!instanceId) throw new MemoryAccessDenied('Memory access denied');
  const existing = existsSync(path);
  if (create && !existing) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { fileMustExist: existing || !create, timeout: 5000 });
  try {
    // Existing files must prove identity before journal, schema or permission changes.
    if (existing) assertMemoryInstance(db, instanceId);
    db.pragma('busy_timeout = 5000');
    if (db.pragma('journal_mode', { simple: true }) !== 'wal') db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.pragma('foreign_keys = ON');
    if (
      db.pragma('journal_mode', { simple: true }) !== 'wal' ||
      db.pragma('synchronous', { simple: true }) !== 2
    )
      throw new Error('Memory durability unavailable');
    if (!existing) {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE memory_authority (
            singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
            instance_id TEXT NOT NULL,
            owner_generation TEXT,
            root_role TEXT,
            role_grants TEXT
          );
        `);
        db.prepare('INSERT INTO memory_authority(singleton, instance_id) VALUES(1, ?)').run(
          instanceId
        );
      }).immediate();
    }
    for (const suffix of ['', '-wal', '-shm'])
      if (existsSync(path + suffix)) chmodSync(path + suffix, 0o600);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

type MemoryAuthority = {
  instance_id: string;
  owner_generation: string | null;
  root_role: string | null;
  role_grants: string | null;
};
function memoryAuthority(db: Db): MemoryAuthority {
  const row = db.prepare('SELECT * FROM memory_authority WHERE singleton = 1').get() as
    | MemoryAuthority
    | undefined;
  if (!row) throw new MemoryAccessDenied('Memory authority unavailable');
  return row;
}
export function memoryOwnerGeneration(db: Db): string | null {
  return memoryAuthority(db).owner_generation;
}
/** Called by the host only after acquiring its existing instance runtime lock. */
export function claimMemoryOwner(
  instanceId: string,
  path: string,
  expectedRootRole: string,
  options?: { create?: boolean }
): string {
  if (typeof expectedRootRole !== 'string' || expectedRootRole.trim().length === 0)
    throw new Error('Memory root role is required');
  const create = options?.create !== false && !existsSync(path);
  const db = openMemoryDatabase(path, instanceId, create);
  try {
    return db
      .transaction(() => {
        const authority = memoryAuthority(db);
        if (authority.root_role !== null && authority.root_role !== expectedRootRole)
          throw new Error('Memory root role mismatch');
        const generation = randomUUID();
        db.prepare(
          'UPDATE memory_authority SET owner_generation = ?, root_role = ? WHERE singleton = 1'
        ).run(generation, expectedRootRole);
        return generation;
      })
      .immediate();
  } finally {
    db.close();
  }
}
function assertMemoryOwner(db: Db, binding: MemoryBinding): MemoryAuthority {
  if (!MemoryBindingSchema.safeParse(binding).success)
    throw new MemoryAccessDenied('Memory access denied');
  const row = memoryAuthority(db);
  if (row.instance_id !== binding.instanceId) throw new MemoryAccessDenied('Memory access denied');
  if (row.owner_generation !== binding.ownerGeneration)
    throw new MemoryAccessDenied('Memory owner unavailable');
  return row;
}
/** Current host configuration replaces grants; a delegate cannot publish host policy. */
export function configureMemoryRoles(db: Db, binding: MemoryBinding, input: MemoryRoles): void {
  db.transaction(() => {
    const row = assertMemoryOwner(db, binding);
    if (!binding.isRoot || (row.root_role !== null && row.root_role !== binding.role))
      throw new Error('Memory root access denied');
    const roles = MemoryRolesSchema.parse(input);
    const grant = roles[binding.role];
    if (!grant || grant.producerId !== binding.producerId)
      throw new Error('Memory root producer mismatch');
    db.prepare(
      'UPDATE memory_authority SET root_role = ?, role_grants = ? WHERE singleton = 1'
    ).run(binding.role, JSON.stringify(roles));
    assertMemoryAccess(db, binding);
  }).immediate();
}
function grantForRole(row: MemoryAuthority, role: string, isRoot: boolean) {
  const roles = MemoryRolesSchema.parse(JSON.parse(row.role_grants ?? '{}'));
  const known = roles[role];
  const grant = known ?? {
    producerId: `persona:${role}`,
    canRead: true,
    canMutate: false,
    collections: [],
    writableCollections: [],
  };
  // The primary grant belongs to the root; choosing its persona for a delegate does not transfer it.
  return !isRoot && role === row.root_role
    ? { ...grant, canMutate: false, writableCollections: [] }
    : grant;
}
export function assertMemoryAccess(db: Db, binding: MemoryBinding, mutate = false): void {
  const row = assertMemoryOwner(db, binding);
  const grant = grantForRole(row, binding.role, binding.isRoot);
  if (
    !binding.canRead ||
    !grant.canRead ||
    binding.producerId !== grant.producerId ||
    (binding.isRoot && binding.role !== row.root_role) ||
    (binding.canMutate && !grant.canMutate) ||
    (mutate && !binding.canMutate) ||
    binding.collections.some((id) => !grant.collections.includes(id)) ||
    binding.writableCollections.some(
      (id) => !grant.writableCollections.includes(id) || !binding.collections.includes(id)
    )
  )
    throw new MemoryAccessDenied('Memory access denied');
}
export function assertMemoryCollectionAccess(
  db: Db,
  binding: MemoryBinding,
  collectionId: string,
  write = false
): void {
  assertMemoryAccess(db, binding);
  if (
    !binding.collections.includes(collectionId) ||
    (write && !binding.writableCollections.includes(collectionId))
  )
    throw new MemoryAccessDenied('Memory collection access denied');
}
export function resolveMemoryBinding(
  db: Db,
  parent: MemoryBinding,
  role: string,
  actorId: string
): MemoryBinding {
  assertMemoryAccess(db, parent);
  const grant = grantForRole(memoryAuthority(db), role, false);
  const binding = {
    ...grant,
    instanceId: parent.instanceId,
    ownerGeneration: parent.ownerGeneration,
    role,
    actorId,
    isRoot: false,
  };
  assertMemoryAccess(db, binding);
  return binding;
}

/** Host preflight reads identity without claiming ownership or mutating the file. */
export function readMemoryInstanceId(path: string): string {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare('SELECT singleton, instance_id FROM memory_authority').all() as Array<{
      singleton: number;
      instance_id: unknown;
    }>;
    if (
      rows.length !== 1 ||
      rows[0].singleton !== 1 ||
      typeof rows[0].instance_id !== 'string' ||
      !rows[0].instance_id.trim()
    )
      throw new MemoryAccessDenied('Memory identity unavailable');
    return rows[0].instance_id;
  } finally {
    db.close();
  }
}
