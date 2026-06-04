// ABOUTME: Tests for discoverExecToolsSync — scans a dir, builds ExecToolAdapters
// ABOUTME: bad binaries are skipped (not fatal); missing dir returns []
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { discoverExecToolsSync } from './discover';
import { ExecToolAdapter } from './exec-tool-adapter';

const FIX = path.join(__dirname, '__fixtures__');
const DISCOVER_FIX = path.join(__dirname, '__fixtures__/discover');

describe('discoverExecToolsSync', () => {
  it('returns [] for a missing directory', () => {
    const result = discoverExecToolsSync('/nonexistent/path/that/does/not/exist');
    expect(result).toEqual([]);
  });

  it('builds an ExecToolAdapter for echo-tool.sh in the main fixtures dir', () => {
    const result = discoverExecToolsSync(FIX);
    const echoAdapter = result.find((t) => t.name === 'echo');
    expect(echoAdapter).toBeInstanceOf(ExecToolAdapter);
    expect(echoAdapter?.name).toBe('echo');
    expect(echoAdapter?.description).toBe('echoes input.msg');
  });

  it('skips a schema-invalid binary without throwing, still returns valid ones', () => {
    // DISCOVER_FIX has bad-schema-tool.sh (invalid schema) and valid-tool.sh
    const result = discoverExecToolsSync(DISCOVER_FIX);
    // valid-tool.sh should appear
    const validAdapter = result.find((t) => t.name === 'valid');
    expect(validAdapter).toBeInstanceOf(ExecToolAdapter);
    // bad-schema-tool.sh should be silently skipped (not in results)
    const badAdapter = result.find((t) => t.name === 'not_a_valid_schema');
    expect(badAdapter).toBeUndefined();
    // No adapter should have "bad" in its name
    expect(result.every((t) => t.name !== 'not_a_valid_schema')).toBe(true);
  });
});
