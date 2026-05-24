// ABOUTME: Asserts that countTokens ships the SAME cache_control shape as the
// live request path (_createRequestPayload). PRI-1806 #2 introduced this
// parity; this test guards against regression. Also guards against empty tools
// being sent on the wire when no tools are provided (Fix #13).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider';
import { Tool } from '@lace/agent/tools/tool';
import { z } from 'zod';
import type { ToolContext, ToolResult } from '@lace/agent/tools/types';

const mockCreate = vi.fn();
const mockCountTokens = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate, stream: vi.fn() };
    beta = { messages: { countTokens: mockCountTokens } };
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../utils/provider-logging.js', () => ({
  logProviderRequest: vi.fn(),
  logProviderResponse: vi.fn(),
}));

class TestTool extends Tool {
  name = 'tool';
  description = 'A tool';
  schema = z.object({ x: z.string() });
  protected async executeValidated(args: { x: string }, _c: ToolContext): Promise<ToolResult> {
    return Promise.resolve(this.createResult(args.x));
  }
}

describe('countTokens shape parity with _createRequestPayload (PRI-1806 #2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCountTokens.mockResolvedValue({ input_tokens: 100 });
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  });

  it('countTokens and create receive the same cache_control structure', async () => {
    const provider = new AnthropicProvider({ apiKey: 'k' });
    provider.setSystemPrompt('Sys prompt');

    const messages = [{ role: 'user' as const, content: 'hi' }];
    const tools = [new TestTool()];
    const model = 'claude-sonnet-4-20250514';

    await provider.countTokens(messages, tools, model);
    await provider.createResponse(messages, tools, model);

    expect(mockCountTokens).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const countArgs = mockCountTokens.mock.calls[0][0] as {
      system: unknown;
      tools: unknown;
      messages: unknown;
    };
    const createArgs = mockCreate.mock.calls[0][0] as {
      system: unknown;
      tools: unknown;
      messages: unknown;
    };

    // Both must wrap the system prompt in a TextBlockParam array with cache_control.
    expect(countArgs.system).toEqual(createArgs.system);

    // Both must stamp the last (only) tool with cache_control.
    expect(countArgs.tools).toEqual(createArgs.tools);

    // Both must have identical messages.
    expect(countArgs.messages).toEqual(createArgs.messages);
  });

  it('omits tools field when no tools are provided (Fix #13 — empty tools guard)', async () => {
    // When tools is empty, countTokensExplicit must NOT send tools:[] on the wire
    // since sending an empty (or marked-empty) tools array may trigger API validation
    // errors. The field must be entirely absent.
    const provider = new AnthropicProvider({ apiKey: 'k' });
    provider.setSystemPrompt('A real system prompt');

    await provider.countTokens([{ role: 'user', content: 'hi' }], [], 'claude-sonnet-4-20250514');

    expect(mockCountTokens).toHaveBeenCalledTimes(1);
    const args = mockCountTokens.mock.calls[0][0] as Record<string, unknown>;

    // tools must be absent — not an empty array
    expect(args.tools).toBeUndefined();

    // system MUST be present (non-empty prompt was set)
    expect(args.system).toBeDefined();
  });
});
