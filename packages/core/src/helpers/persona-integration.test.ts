// ABOUTME: Test to verify persona integration with SessionHelper
// ABOUTME: Ensures session summary agent uses session-summary persona correctly

import { describe, it, expect } from 'vitest';
import { SessionHelper } from '~/helpers/session-helper';
import { Agent } from '~/agents/agent';

// Simple test to verify persona integration works
describe('SessionHelper Persona Integration', () => {
  it('should use session-summary persona for agent summaries', async () => {
    // This test just verifies the personas system is connected
    // The actual summary generation will be tested in the web layer

    const mockAgent = {
      getFullSession: () =>
        Promise.resolve({
          getWorkingDirectory: () => '/test',
          getTools: () => [],
        }),
      getAvailableTools: () => [],
      toolExecutor: {
        registerTool: () => {},
      },
    } as unknown as Agent;

    const helper = new SessionHelper({
      model: 'fast',
      parentAgent: mockAgent,
      persona: 'session-summary',
    });

    // Verify persona is set correctly
    expect(helper['getPersona']()).toBe('session-summary');
  });

  it('should work without persona (backward compatibility)', async () => {
    const mockAgent = {
      getFullSession: () =>
        Promise.resolve({
          getWorkingDirectory: () => '/test',
          getTools: () => [],
        }),
      getAvailableTools: () => [],
      toolExecutor: {
        registerTool: () => {},
      },
    } as unknown as Agent;

    const helper = new SessionHelper({
      model: 'fast',
      parentAgent: mockAgent,
      // No persona specified
    });

    // Should return undefined (no system prompt)
    expect(helper['getPersona']()).toBeUndefined();
  });
});
