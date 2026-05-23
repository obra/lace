// ABOUTME: Regression test for PRI-1804 #4 — loop reminder must not appear
// twice in the message stream within one run().

import { describe, it, expect } from 'vitest';

// We test the property directly by reading the runner source and asserting
// the structural invariant: the reminder is pushed in-memory ONCE per
// LOOP_CHECK_INTERVAL boundary and is not also persisted via writeAndAdvance.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('PRI-1804 #4 regression — loop reminder must not double-inject', () => {
  it('runner.ts does not call writeAndAdvance for the loop reminder', () => {
    const src = readFileSync(join(__dirname, '..', 'runner.ts'), 'utf8');
    // Find the reminder block (anchor on the LOOP_CHECK_INTERVAL guard).
    const blockMatch = src.match(
      /completedTurns % ConversationRunner\.LOOP_CHECK_INTERVAL[\s\S]{0,1200}/
    );
    expect(blockMatch).not.toBeNull();
    const block = blockMatch![0];
    // The reminder block must NOT persist via writeAndAdvance.
    // (Persisting causes the next iteration's re-read to duplicate it.)
    expect(block).not.toContain('writeAndAdvance');
  });

  it('runner.ts still pushes the reminder into providerMessages in-memory', () => {
    const src = readFileSync(join(__dirname, '..', 'runner.ts'), 'utf8');
    const blockMatch = src.match(
      /completedTurns % ConversationRunner\.LOOP_CHECK_INTERVAL[\s\S]{0,1200}/
    );
    expect(blockMatch).not.toBeNull();
    const block = blockMatch![0];
    expect(block).toContain('providerMessages');
    expect(block).toContain('system-reminder');
  });
});
