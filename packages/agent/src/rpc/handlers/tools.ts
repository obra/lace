// ABOUTME: Tool and persona management RPC handlers

import type { JsonRpcPeer, ToolInfo, PersonaInfo } from '@lace/ent-protocol';
import type { AgentServerState, CreateToolExecutorFn } from '../../server-types';
import { protocolToolInfoForCoreTool } from '../utils';
import { assertInitialized } from '../utils';
import { SkillRegistry, getSkillDirectories } from '../../skills';
import { composeSkillDirs } from '../../skills/compose-skill-dirs';
import { getAgentSkillsDir } from '../../skills/agent-skills-dir';

/**
 * Register tool management handlers with the peer.
 * - list: Returns available tools for the current execution mode and MCP configuration
 */
export function registerToolHandlers(
  peer: JsonRpcPeer,
  state: AgentServerState,
  createToolExecutorForMode: CreateToolExecutorFn
): void {
  peer.onRequest('ent/tools/list', async (_params: unknown) => {
    assertInitialized(state);

    // Create skill registry if there's an active session. Persona skills layer
    // first, then plugin dirs, then core, then embedder/workDir (first-wins).
    let skillRegistry: SkillRegistry | undefined;
    if (state.activeSession) {
      const skillDirs = composeSkillDirs(
        { skillDirs: state.skillDirs ?? getSkillDirectories(state.activeSession.meta.workDir) },
        state.personaRegistry.personaSkillsDir(state.activeSession.meta.persona ?? 'lace'),
        { coreDir: getAgentSkillsDir() }
      );
      skillRegistry = new SkillRegistry({ skillDirs });
    }

    const { toolsForProvider } = await createToolExecutorForMode(
      state.config.executionMode,
      state.mcpServerManager,
      undefined, // jobManager
      skillRegistry,
      undefined, // toolScope
      state.personaRegistry,
      state.activeSession?.meta.persona ?? 'lace'
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
    const personas: PersonaInfo[] = state.personaRegistry.listAvailablePersonas();
    return { personas };
  });
}
