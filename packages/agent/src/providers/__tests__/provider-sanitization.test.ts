// ABOUTME: End-to-end check that AIProvider's createResponse template-method correctly
// ABOUTME: sanitizes tool names on the wire and un-sanitizes them in the response — that
// ABOUTME: subclasses never see raw original names AND callers never see sanitized ones.

import { describe, expect, it } from 'vitest';
import {
  AIProvider,
  type ProviderMessage,
  type ProviderResponse,
  type WireTool,
} from '@lace/agent/providers/base-provider';
import { Tool } from '@lace/agent/tools/tool';
import { z } from 'zod';
import type { ToolResult, ToolContext } from '@lace/agent/tools/types';

class FakeTool extends Tool {
  constructor(public readonly name: string) {
    super();
  }
  description = 'fake';
  schema = z.object({});
  protected executeValidated(_args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    return Promise.resolve({ content: [{ type: 'text', text: '' }], status: 'completed' });
  }
}

class CapturingProvider extends AIProvider {
  public lastSeenToolNames: string[] = [];
  public lastSeenMessageToolNames: string[] = [];
  public toolCallsToReturn: Array<{ id: string; name: string; arguments: object }> = [];

  isConfigured(): boolean {
    return true;
  }
  get providerName(): string {
    return 'capturing';
  }
  getProviderInfo() {
    return { name: 'capturing', displayName: 'Capturing', requiresApiKey: false };
  }

  protected _createResponseImpl(
    messages: ProviderMessage[],
    tools: WireTool[],
  ): Promise<ProviderResponse> {
    this.lastSeenToolNames = tools.map((t) => t.name);
    this.lastSeenMessageToolNames = messages.flatMap((m) =>
      (m.toolCalls ?? []).map((tc) => tc.name),
    );
    return Promise.resolve({
      content: '',
      toolCalls: this.toolCallsToReturn.map((tc) => ({ ...tc })),
    });
  }
}

describe('AIProvider sanitization contract', () => {
  it('sanitizes tool names before _createResponseImpl sees them', async () => {
    const provider = new CapturingProvider();
    await provider.createResponse(
      [{ role: 'user', content: 'hi' }],
      [new FakeTool('private-journal/process_thoughts'), new FakeTool('send_slack_message')],
      'test-model',
    );
    expect(provider.lastSeenToolNames).toEqual([
      'private-journal_process_thoughts',
      'send_slack_message',
    ]);
  });

  it('un-sanitizes tool names in the response before returning', async () => {
    const provider = new CapturingProvider();
    // Subclass returns sanitized name (as a model would on the wire).
    provider.toolCallsToReturn = [
      { id: 'call_1', name: 'private-journal_process_thoughts', arguments: { reflections: 'x' } },
    ];
    const response = await provider.createResponse(
      [{ role: 'user', content: 'hi' }],
      [new FakeTool('private-journal/process_thoughts')],
      'test-model',
    );
    expect(response.toolCalls).toEqual([
      { id: 'call_1', name: 'private-journal/process_thoughts', arguments: { reflections: 'x' } },
    ]);
  });

  it('sanitizes message-attached toolCall names too', async () => {
    const provider = new CapturingProvider();
    await provider.createResponse(
      [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'call_0', name: 'private-journal/process_thoughts', arguments: {} },
          ],
        },
      ],
      [new FakeTool('private-journal/process_thoughts')],
      'test-model',
    );
    expect(provider.lastSeenMessageToolNames).toEqual(['private-journal_process_thoughts']);
  });

  it('leaves names without disallowed chars unchanged', async () => {
    const provider = new CapturingProvider();
    provider.toolCallsToReturn = [{ id: 'c', name: 'send_slack_message', arguments: {} }];
    const response = await provider.createResponse(
      [{ role: 'user', content: 'hi' }],
      [new FakeTool('send_slack_message')],
      'test-model',
    );
    expect(provider.lastSeenToolNames).toEqual(['send_slack_message']);
    expect(response.toolCalls[0]?.name).toBe('send_slack_message');
  });
});
