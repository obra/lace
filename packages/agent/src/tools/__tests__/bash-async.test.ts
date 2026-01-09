// ABOUTME: Tests for bash tool's run_async schema parameter
// ABOUTME: Verifies that the schema accepts run_async boolean with default false

import { describe, expect, it } from 'vitest';
import { BashTool } from '../implementations/bash';

describe('BashTool schema', () => {
  it('accepts run_async parameter', () => {
    const tool = new BashTool();
    const schema = tool.schema;

    // Should parse successfully with run_async
    const result = schema.safeParse({
      command: 'echo hi',
      run_async: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.run_async).toBe(true);
    }
  });

  it('defaults run_async to false', () => {
    const tool = new BashTool();
    const schema = tool.schema;

    const result = schema.safeParse({
      command: 'echo hi',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.run_async).toBe(false);
    }
  });
});
