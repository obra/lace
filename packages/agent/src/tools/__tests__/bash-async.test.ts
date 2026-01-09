// ABOUTME: Tests for bash tool's background schema parameter
// ABOUTME: Verifies that the schema accepts background boolean with default false

import { describe, expect, it } from 'vitest';
import { BashTool } from '../implementations/bash';

describe('BashTool schema', () => {
  it('accepts background parameter', () => {
    const tool = new BashTool();
    const schema = tool.schema;

    // Should parse successfully with background
    const result = schema.safeParse({
      command: 'echo hi',
      background: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.background).toBe(true);
    }
  });

  it('defaults background to false', () => {
    const tool = new BashTool();
    const schema = tool.schema;

    const result = schema.safeParse({
      command: 'echo hi',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.background).toBe(false);
    }
  });
});
