import { describe, expect, it } from 'vitest';
import { MemoryBindingSchema, MemoryRoleGrantSchema, MemoryRolesSchema } from '../shared';

const grant = {
  producerId: 'persona:librarian',
  canRead: true,
  canMutate: false,
  collections: ['knowledge'],
  writableCollections: ['knowledge'],
};
const binding = {
  ...grant,
  instanceId: 'instance',
  actorId: 'actor',
  role: 'librarian',
  ownerGeneration: 'generation',
  isRoot: false,
};

describe('memory permission schemas', () => {
  it('keeps note and collection write permissions independent', () => {
    expect(MemoryRoleGrantSchema.parse(grant)).toEqual(grant);
    expect(MemoryRolesSchema.parse({ librarian: grant })).toEqual({ librarian: grant });
    expect(MemoryBindingSchema.parse(binding)).toEqual(binding);
    expect(MemoryRolesSchema.parse({})).toEqual({});
  });

  it('requires nonempty role, producer, identity and collection identifiers', () => {
    for (const key of ['instanceId', 'actorId', 'role', 'ownerGeneration', 'producerId'])
      expect(MemoryBindingSchema.safeParse({ ...binding, [key]: '' }).success).toBe(false);
    expect(MemoryRolesSchema.safeParse({ '': grant }).success).toBe(false);
    expect(MemoryRoleGrantSchema.safeParse({ ...grant, collections: [''] }).success).toBe(false);
    expect(MemoryRoleGrantSchema.safeParse({ ...grant, writableCollections: [''] }).success).toBe(
      false
    );
  });

  it('requires every explicit permission and rejects unknown fields', () => {
    for (const key of Object.keys(binding)) {
      const missing: Record<string, unknown> = { ...binding };
      delete missing[key];
      expect(MemoryBindingSchema.safeParse(missing).success).toBe(false);
    }
    expect(MemoryRoleGrantSchema.safeParse({ ...grant, canRead: 'true' }).success).toBe(false);
    expect(MemoryRoleGrantSchema.safeParse({ ...grant, extra: true }).success).toBe(false);
    expect(MemoryBindingSchema.safeParse({ ...binding, extra: true }).success).toBe(false);
  });
});
