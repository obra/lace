import { describe, it, expect } from 'vitest';
import type { MCPServerConfig, ApprovalLevel } from './types';

describe('MCP Types', () => {
  it('should define valid approval levels', () => {
    const levels: ApprovalLevel[] = [
      'disable',
      'deny',
      'require-approval',
      'allow-once',
      'allow-session',
      'allow-project',
      'allow-always',
    ];

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
        read_file: 'allow-session',
        write_file: 'require-approval',
      },
    };

    expect(config.command).toBe('node');
    expect(config.tools.read_file).toBe('allow-session');
  });
});
