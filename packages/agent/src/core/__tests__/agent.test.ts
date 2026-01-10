// ABOUTME: Tests for the core Agent class - library entry point
// ABOUTME: Verifies Agent instantiation and initialization

import { describe, it, expect } from 'vitest';
import { Agent } from '../agent';
import { useTempLaceDir } from '@lace/agent/test-utils';

describe('Agent', () => {
  const laceDir = useTempLaceDir();

  it('creates an Agent instance with laceDir', () => {
    const agent = new Agent({ laceDir: laceDir.tempDir });
    expect(agent).toBeDefined();
    expect(agent.laceDir).toBe(laceDir.tempDir);
  });

  it('initializes provider catalog on demand', async () => {
    const agent = new Agent({ laceDir: laceDir.tempDir });
    await agent.initialize();
    expect(agent.isInitialized).toBe(true);
  });
});
