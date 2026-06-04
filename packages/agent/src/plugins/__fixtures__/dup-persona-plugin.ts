// ABOUTME: Fixture — registers the same tool name as good-plugin (dup→fatal)
// ABOUTME: The persona registry no longer has dup detection (personas are dirs, not named entries).
// ABOUTME: This fixture proves dup→fatal for the tools registry instead.
import { z } from 'zod';
import { Tool } from '@lace/agent/tools/tool';
import type { ToolResult, ToolContext } from '@lace/agent/tools/types';
import type { PluginApi } from '../api';

export const meta = { name: 'dup', namespace: 'dup', version: '1.0.0' };

class DupFixtureTool extends Tool {
  name = 'good:fixture-tool';
  description = 'Duplicate tool for dup-detection tests';
  schema = z.object({});
  protected async executeValidated(
    _args: Record<string, never>,
    _ctx: ToolContext
  ): Promise<ToolResult> {
    return this.createResult('dup');
  }
}

export function register(api: PluginApi): void {
  api.tools.register('good:fixture-tool', new DupFixtureTool());
}
