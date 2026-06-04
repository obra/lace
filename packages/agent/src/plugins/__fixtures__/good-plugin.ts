// ABOUTME: Fixture — well-formed plugin with meta + manifest, registers a tool and a persona dir
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Tool } from '@lace/agent/tools/tool';
import type { ToolResult, ToolContext } from '@lace/agent/tools/types';
import type { PluginApi } from '../api';

export const meta = { name: 'good', namespace: 'good', version: '1.2.3' };
export const manifest = { capabilities: [] as const };

class FixtureTool extends Tool {
  name = 'good:fixture-tool';
  description = 'Fixture tool for loader tests';
  schema = z.object({});
  protected async executeValidated(
    _args: Record<string, never>,
    _ctx: ToolContext
  ): Promise<ToolResult> {
    return this.createResult('ok');
  }
}

export function register(api: PluginApi): void {
  api.assertVersion(1);
  api.tools.register('good:fixture-tool', new FixtureTool());
  api.personas.addDir(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'good-plugin-personas')
  );
}
