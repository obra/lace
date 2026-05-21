// ABOUTME: Tests web-owned project persistence
// ABOUTME: Verifies project MCP configs keep Task 14 metadata and placement defaults

import { describe, expect, it } from 'vitest';
import { ProjectStore, type ProjectRecord } from './project-store';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';

describe('ProjectStore', () => {
  setupWebTest();

  it('defaults project MCP placement by transport and preserves secret refs', () => {
    const record: ProjectRecord = {
      id: 'project-1',
      name: 'Project',
      description: '',
      workingDirectory: '/tmp/project',
      configuration: {},
      environmentVariables: {},
      environmentEncryptedKeys: [],
      mcpServers: {
        missingTransport: { command: 'default', enabled: true, tools: {} },
        stdio: { command: 'stdio', transport: 'stdio', enabled: true, tools: {} },
        http: {
          command: 'http',
          transport: 'http',
          secretEnv: { API_KEY: { namespace: 'project', name: 'api-key' } },
          enabled: true,
          tools: {},
        },
        sse: { command: 'sse', transport: 'sse', enabled: true, tools: {} },
        explicit: {
          command: 'explicit',
          transport: 'stdio',
          placement: 'host',
          enabled: true,
          tools: {},
        },
      },
      isArchived: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      lastUsedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    };

    const store = new ProjectStore();
    store.upsert(record);

    expect(store.load('project-1')?.mcpServers).toMatchObject({
      missingTransport: { placement: 'toolRuntime' },
      stdio: { transport: 'stdio', placement: 'toolRuntime' },
      http: {
        transport: 'http',
        placement: 'host',
        secretEnv: { API_KEY: { namespace: 'project', name: 'api-key' } },
      },
      sse: { transport: 'sse', placement: 'host' },
      explicit: { transport: 'stdio', placement: 'host' },
    });
  });
});
