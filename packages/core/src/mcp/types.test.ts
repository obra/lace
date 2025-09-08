import { describe, it, expect } from 'vitest';
import type { MCPServerConfig } from './types';
import type { ToolPolicy } from '~/tools/types';

describe('MCP Types', () => {
  it('should define valid approval levels', () => {
    const levels: ToolPolicy[] = ['disable', 'deny', 'ask', 'ask', 'allow', 'allow', 'allow'];

    // Type check - if types are wrong, TS will error
    expect(levels).toHaveLength(7);
  });

  it('should support server configuration structure', () => {
    const config: MCPServerConfig = {
      command: 'node',
      args: ['server.js'],
      env: { NODE_ENV: 'development' },
      cwd: '/path/to/server',
      enabled: true,
      tools: {
        read_file: 'allow',
        write_file: 'ask',
      },
    };

    expect(config.command).toBe('node');
    expect(config.tools.read_file).toBe('allow');
  });
});
