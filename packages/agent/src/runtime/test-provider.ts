import {
  AIProvider,
  type ProviderMessage,
  type ProviderResponse,
} from '@lace/core/providers/base-provider';
import type { Tool } from '@lace/core/tools/tool';
import type { ToolCall, ToolResult } from '@lace/core/tools/types';

type TestProviderState = {
  phase: 'needs_tool' | 'final';
  nextToolCallId: number;
};

export class TestAgentProvider extends AIProvider {
  private state: TestProviderState = { phase: 'needs_tool', nextToolCallId: 1 };

  get providerName(): string {
    return 'test';
  }

  getProviderInfo() {
    return {
      name: 'test',
      displayName: 'Test Provider',
      requiresApiKey: false,
      configurationHint: 'Internal test provider for lace-agent E2E tests.',
    };
  }

  isConfigured(): boolean {
    return true;
  }

  get supportsStreaming(): boolean {
    return true;
  }

  async createResponse(
    messages: ProviderMessage[],
    _tools: Tool[],
    _model: string,
    _signal?: AbortSignal
  ): Promise<ProviderResponse> {
    const response = await this.createStreamingResponse(messages, _tools, _model, _signal);
    return response;
  }

  async createStreamingResponse(
    messages: ProviderMessage[],
    _tools: Tool[],
    _model: string,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    if (signal?.aborted) {
      return { content: '', toolCalls: [], stopReason: 'error' };
    }

    const lastUserText = [...messages]
      .reverse()
      .find((m) => m.role === 'user' && typeof m.content === 'string')?.content;

    const requested = this.extractRequestedTool(lastUserText ?? '');

    if (this.state.phase === 'needs_tool' && requested) {
      const toolCallId = `test_tool_${this.state.nextToolCallId++}`;
      const toolCalls: ToolCall[] = [
        { id: toolCallId, name: requested.name, arguments: requested.args },
      ];
      const content =
        requested.name === 'file_read'
          ? `Reading ${(requested.args as any).path}...`
          : `Writing ${(requested.args as any).path}...`;
      this.emit('token', { token: content });
      this.emit('complete', { response: { content, toolCalls, stopReason: 'tool_use' } });
      this.state.phase = 'final';
      return { content, toolCalls, stopReason: 'tool_use' };
    }

    const toolResultText = this.extractLatestToolResultText(messages);
    const content = toolResultText ? `Result:\n${toolResultText}` : 'No tool result found.';
    this.emit('token', { token: content });
    this.emit('complete', { response: { content, toolCalls: [], stopReason: 'stop' } });
    return { content, toolCalls: [], stopReason: 'stop' };
  }

  private extractRequestedPath(text: string): string | null {
    const match = text.match(/read\s+file\s+(.+)\s*$/i);
    const raw = match?.[1]?.trim();
    return raw && raw.length > 0 ? raw : null;
  }

  private extractRequestedTool(
    text: string
  ): null | { name: 'file_read' | 'file_write'; args: Record<string, unknown> } {
    const readPath = this.extractRequestedPath(text);
    if (readPath) return { name: 'file_read', args: { path: readPath } };

    const writeMatch = text.match(/write\s+file\s+(.+)\s*$/i);
    const writePath = writeMatch?.[1]?.trim();
    if (writePath && writePath.length > 0) {
      return {
        name: 'file_write',
        args: { path: writePath, content: 'written by test provider\n' },
      };
    }

    return null;
  }

  private extractLatestToolResultText(messages: ProviderMessage[]): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== 'user') continue;
      const results = msg.toolResults;
      if (!results || results.length === 0) continue;
      const last = results[results.length - 1] as ToolResult;
      const content = (last.content ?? [])
        .map((c) => (c.type === 'text' ? (c.text ?? '') : ''))
        .filter((t) => t.length > 0)
        .join('\n');
      return content.length > 0 ? content : null;
    }
    return null;
  }
}
