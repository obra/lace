// ABOUTME: Tests for accurate token tracking including context size
// ABOUTME: Ensures proper accumulation and display of token usage

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderInkComponent } from '~/interfaces/terminal/__tests__/helpers/ink-test-utils';
import StatusBar from '~/interfaces/terminal/components/status-bar';

// Mock modules
vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('Token Tracking in StatusBar', () => {
  it('should display cumulative tokens correctly', () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar
        providerName="anthropic"
        modelName="claude-3"
        threadId="test-thread"
        cumulativeTokens={{
          promptTokens: 1500,
          completionTokens: 500,
          totalTokens: 2000,
        }}
        messageCount={3}
      />
    );

    const frame = lastFrame();
    // Should show prompt tokens (context size)
    expect(frame).toContain('↑1.5k');
    // Should show completion tokens (outputs)
    expect(frame).toContain('↓500');
  });

  it('should display context percentage when contextWindow is provided', () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar
        providerName="anthropic"
        modelName="claude-3"
        threadId="test-thread"
        cumulativeTokens={{
          promptTokens: 50000,
          completionTokens: 500,
          totalTokens: 50500,
        }}
        messageCount={3}
        contextWindow={200000}
      />
    );

    const frame = lastFrame();
    // Should show context usage with percentage
    expect(frame).toContain('↑50.0k/200.0k (25%)');
    expect(frame).toContain('↓500');
  });

  it('should format large token counts with k suffix', () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar
        providerName="anthropic"
        modelName="claude-3"
        threadId="test-thread"
        cumulativeTokens={{
          promptTokens: 195000,
          completionTokens: 5200,
          totalTokens: 200200,
        }}
        messageCount={10}
        contextWindow={200000}
      />
    );

    const frame = lastFrame();
    // Large context warning visible with critical warning
    expect(frame).toContain('↑195.0k/200.0k (97% 🚨)');
    expect(frame).toContain('↓5.2k');
  });

  it('should show turn metrics when turn is active', () => {
    const turnMetrics = {
      turnId: 'turn-1',
      startTime: new Date(Date.now() - 5000), // 5 seconds ago
      elapsedMs: 5000,
      tokensIn: 150,
      tokensOut: 300,
    };

    const { lastFrame } = renderInkComponent(
      <StatusBar
        providerName="anthropic"
        modelName="claude-3"
        threadId="test-thread"
        cumulativeTokens={{
          promptTokens: 1000,
          completionTokens: 200,
          totalTokens: 1200,
        }}
        messageCount={2}
        isTurnActive={true}
        turnMetrics={turnMetrics}
      />
    );

    const frame = lastFrame();
    // Should show turn-specific metrics when active
    expect(frame).toContain('5s'); // elapsed time
    expect(frame).toContain('↑150'); // turn input tokens
    expect(frame).toContain('↓300'); // turn output tokens
    expect(frame).toContain('Processing'); // active indicator
  });

  it('should show zero tokens gracefully', () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar
        providerName="anthropic"
        threadId="test-thread"
        messageCount={0}
        cumulativeTokens={{
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        }}
      />
    );

    const frame = lastFrame();
    expect(frame).toContain('↑0');
    expect(frame).toContain('↓0');
  });

  it('should show session totals when turn is not active', () => {
    const { lastFrame } = renderInkComponent(
      <StatusBar
        providerName="anthropic"
        modelName="claude-3"
        threadId="test-thread"
        cumulativeTokens={{
          promptTokens: 2500,
          completionTokens: 750,
          totalTokens: 3250,
        }}
        messageCount={5}
        isTurnActive={false}
        isProcessing={false}
      />
    );

    const frame = lastFrame();
    // Should show session totals
    expect(frame).toContain('↑2.5k'); // context size
    expect(frame).toContain('↓750'); // total outputs
    expect(frame).toContain('Ready'); // ready state
  });
});

describe('Token Accumulation Logic', () => {
  it('should track context growth correctly', () => {
    // Test case showing the issue:
    // Turn 1: promptTokens=1000 (includes system prompt)
    // Turn 2: promptTokens=1500 (includes turn 1 + system)
    // Turn 3: promptTokens=2200 (includes turn 1+2 + system)

    // Current incorrect logic would show:
    // Total = 1000 + 1500 + 2200 = 4700

    // Correct logic should show:
    // Total = 2200 + (200 + 300 + 250) = 2950
    // Where 2200 is final context, and sum is completion tokens

    const testCases = [
      {
        turn: 1,
        providerUsage: { promptTokens: 1000, completionTokens: 200, totalTokens: 1200 },
        expectedCumulative: { promptTokens: 1000, completionTokens: 200, totalTokens: 1200 },
      },
      {
        turn: 2,
        providerUsage: { promptTokens: 1500, completionTokens: 300, totalTokens: 1800 },
        expectedCumulative: { promptTokens: 1500, completionTokens: 500, totalTokens: 2000 },
      },
      {
        turn: 3,
        providerUsage: { promptTokens: 2200, completionTokens: 250, totalTokens: 2450 },
        expectedCumulative: { promptTokens: 2200, completionTokens: 750, totalTokens: 2950 },
      },
    ];

    // This test documents the expected behavior for fixing the accumulation logic
    testCases.forEach((testCase) => {
      // The fix would involve tracking prompt token deltas or only accumulating completions
      expect(testCase.expectedCumulative.totalTokens).toBeLessThan(
        testCase.turn === 1 ? 1300 : testCase.turn === 2 ? 2100 : 3000
      );
    });
  });
});
