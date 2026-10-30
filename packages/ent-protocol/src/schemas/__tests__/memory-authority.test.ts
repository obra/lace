import { InitializeRequestSchema } from '../methods';
import { describe, expect, it } from 'vitest';
import {
  MemoryBindingSchema,
  MemoryConfigurationSchema,
  MemoryRoleGrantSchema,
  MemoryRolesSchema,
} from '../shared';

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

describe('memory document extension selection', () => {
  const memory = {
    databasePath: '/instance/memory.sqlite',
    binding,
    documentSources: { gitRoot: '/instance', paths: ['user/knowledge', 'user/journal'] },
  };
  it('retains the optional positive suffix allowlist in canonical initialize configuration', () => {
    const request = InitializeRequestSchema.parse({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '1.0',
        clientInfo: { name: 'host', version: '1' },
        capabilities: {},
        memory: { ...memory, documentSources: { ...memory.documentSources, extensions: ['.md'] } },
      },
    });
    expect(request.params.memory?.documentSources?.extensions).toEqual(['.md']);
    expect(MemoryConfigurationSchema.parse(memory)).toEqual(memory);
  });
  it.each([
    { extensions: [] },
    { extensions: ['md'] },
    { extensions: ['*.md'] },
    { extensions: ['../md'] },
    { extensions: ['.'] },
  ])('rejects a malformed extension selection $extensions', ({ extensions }) => {
    expect(
      MemoryConfigurationSchema.safeParse({
        ...memory,
        documentSources: { ...memory.documentSources, extensions },
      }).success
    ).toBe(false);
  });
});
