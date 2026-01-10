// ABOUTME: Tool and persona management RPC handlers

import type { JsonRpcPeer, ToolInfo, PersonaInfo } from '@lace/ent-protocol';
import type { AgentServerState } from '../../server-types';
import { protocolToolInfoForCoreTool } from '../utils';
import { assertInitialized } from '../utils';
import { personaRegistry } from '../../config/persona-registry';

export type CreateToolExecutorForMode = (
  executionMode: 'plan' | 'execute',
  mcpServerManager?: any
) => {
  toolsForProvider: any[];
};

/**
 * Register tool management handlers with the peer.
 * - list: Returns available tools for the current execution mode and MCP configuration
 */
export function registerToolHandlers(
  peer: JsonRpcPeer,
  state: AgentServerState,
  createToolExecutorForMode: CreateToolExecutorForMode
): void {
  peer.onRequest('ent/tools/list', async (_params: unknown) => {
    assertInitialized(state);

    const { toolsForProvider } = createToolExecutorForMode(
      state.config.executionMode,
      state.mcpServerManager
    );

    const seenToolNames = new Set<string>();
    const tools: ToolInfo[] = [];
    for (const tool of toolsForProvider) {
      const info = protocolToolInfoForCoreTool(tool);
      if (seenToolNames.has(info.name)) continue;
      seenToolNames.add(info.name);
      tools.push(info);
    }

    return { tools };
  });

  // Persona listing handler
  peer.onRequest('ent/personas/list', async (_params: unknown) => {
    const personas: PersonaInfo[] = personaRegistry.listAvailablePersonas();
    return { personas };
  });
}
