// ABOUTME: Tests for getAllTools() deterministic byte-stable ordering.
// Ensures sort order is independent of host locale (follow-up
// after adversarial review of the original cache-control hardening).

import { describe, it, expect } from 'vitest';
import { ToolExecutor } from './executor';
import { Tool } from './tool';
import { z } from 'zod';
import type { ToolContext, ToolResult } from './types';

class MockTool extends Tool {
  name: string;
  description: string;
  schema = z.object({});

  constructor(name: string) {
    super();
    this.name = name;
    this.description = `Tool ${name}`;
  }

  protected async executeValidated(_args: object, _context: ToolContext): Promise<ToolResult> {
    return Promise.resolve(this.createResult('ok'));
  }
}

describe('ToolExecutor.getAllTools — byte-stable ordering', () => {
  it('sorts native tools using byte-stable comparison, not localeCompare', () => {
    const executor = new ToolExecutor();
    // Names chosen to expose locale-dependent collation differences.
    // In Turkish locale 'I' sorts after 'i'. In default ICU, 'I' sorts
    // before 'i' case-insensitively (so 'Ipsum' interleaves with 'i' names).
    // Byte comparison: uppercase ASCII < lowercase ASCII, so:
    //   'Beta' (B=66) < 'Ipsum' (I=73) < 'alpha' (a=97) < 'charlie' (c=99)
    executor.registerTool('Ipsum', new MockTool('Ipsum'));
    executor.registerTool('alpha', new MockTool('alpha'));
    executor.registerTool('Beta', new MockTool('Beta'));
    executor.registerTool('charlie', new MockTool('charlie'));

    const sorted = executor.getAllTools().map((t) => t.name);
    expect(sorted).toEqual(['Beta', 'Ipsum', 'alpha', 'charlie']);
  });

  it('sorts MCP tools using byte-stable comparison after native tools', () => {
    const executor = new ToolExecutor();
    // MCP tools contain '/' in their name (server/toolname pattern)
    executor.registerTool('server/Zeta', new MockTool('server/Zeta'));
    executor.registerTool('server/alpha', new MockTool('server/alpha'));
    executor.registerTool('server/Beta', new MockTool('server/Beta'));
    // One native tool to confirm grouping (native before MCP)
    executor.registerTool('native', new MockTool('native'));

    const sorted = executor.getAllTools().map((t) => t.name);
    // native tools first, then MCP tools in byte order
    expect(sorted).toEqual(['native', 'server/Beta', 'server/Zeta', 'server/alpha']);
  });
});
