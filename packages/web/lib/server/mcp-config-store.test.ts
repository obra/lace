// ABOUTME: Tests web-owned global MCP configuration persistence
// ABOUTME: Verifies Task 14 MCP metadata survives schema validation and defaults

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { McpConfigStore } from './mcp-config-store';
import { getLaceWebFilePath } from './web-data-dir';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';

describe('McpConfigStore', () => {
  setupWebTest();

  it('defaults global MCP placement to host and preserves transport metadata', () => {
    McpConfigStore.saveGlobalConfig({
      servers: {
        missingTransport: { command: 'default', enabled: true, tools: {} },
        stdio: { command: 'stdio', transport: 'stdio', enabled: true, tools: {} },
        http: {
          command: 'http',
          transport: 'http',
          secretEnv: { API_KEY: { namespace: 'host-service', name: 'api-key' } },
          enabled: true,
          tools: {},
        },
        explicit: {
          command: 'explicit',
          transport: 'stdio',
          placement: 'toolRuntime',
          enabled: true,
          tools: {},
        },
      },
    });

    const loaded = McpConfigStore.loadGlobalConfig();

    expect(loaded?.servers).toMatchObject({
      missingTransport: { placement: 'host' },
      stdio: { transport: 'stdio', placement: 'host' },
      http: {
        transport: 'http',
        placement: 'host',
        secretEnv: { API_KEY: { namespace: 'host-service', name: 'api-key' } },
      },
      explicit: { transport: 'stdio', placement: 'toolRuntime' },
    });

    const persisted = JSON.parse(readFileSync(getLaceWebFilePath('mcp.json'), 'utf8'));
    expect(persisted.servers.missingTransport.placement).toBe('host');
  });
});
