// ABOUTME: Initialize RPC handler for client connection setup and capability negotiation

import type { JsonRpcPeer, ToolInfo } from '@lace/ent-protocol';
import { EntErrorCodes } from '@lace/ent-protocol';
import { getUserSlashCommands } from '../../user-commands';
import { protocolToolInfoForCoreTool } from '../utils';
import type { AgentServerState, CreateToolExecutorFn } from '../../server-types';

/**
 * Register the initialize RPC handler with the peer.
 * Validates client capabilities and sets up the initial server state.
 */
export function registerInitializeHandler(
  peer: JsonRpcPeer,
  state: AgentServerState,
  createToolExecutorForMode: CreateToolExecutorFn
): void {
  peer.onRequest('initialize', async (params: unknown) => {
    if (state.initialized)
      throw {
        code: EntErrorCodes.AlreadyInitialized,
        message: 'AlreadyInitialized',
        data: { category: 'agent_internal' },
      };

    const parsed = params as Record<string, unknown> | undefined;
    if (!parsed || typeof parsed !== 'object')
      throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };

    if (parsed.protocolVersion !== '1.0')
      throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };

    const clientInfo = parsed.clientInfo as Record<string, unknown> | undefined;
    if (!clientInfo || typeof clientInfo !== 'object')
      throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };
    if (typeof clientInfo.name !== 'string' || clientInfo.name.length === 0)
      throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };
    if (typeof clientInfo.version !== 'string' || clientInfo.version.length === 0)
      throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };

    const capabilities = parsed.capabilities as Record<string, unknown> | undefined;
    if (!capabilities || typeof capabilities !== 'object')
      throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };

    const config = (parsed.config as Record<string, unknown> | undefined) ?? undefined;

    state.initialized = true;
    if (config?.executionMode === 'plan') state.config.executionMode = 'plan';
    if (config?.executionMode === 'execute') state.config.executionMode = 'execute';

    const approvalMode = config?.approvalMode;
    if (
      approvalMode === 'ask' ||
      approvalMode === 'approveReads' ||
      approvalMode === 'approveEdits' ||
      approvalMode === 'approve' ||
      approvalMode === 'deny' ||
      approvalMode === 'dangerouslySkipPermissions'
    ) {
      state.config.approvalMode = approvalMode;
    }

    if (typeof config?.connectionId === 'string') state.config.connectionId = config.connectionId;
    if (typeof config?.modelId === 'string') state.config.modelId = config.modelId;
    if (typeof config?.maxBudgetUsd === 'number') state.config.maxBudgetUsd = config.maxBudgetUsd;
    if (typeof config?.maxThinkingTokens === 'number')
      state.config.maxThinkingTokens = config.maxThinkingTokens;
    if (config?.environment && typeof config.environment === 'object') {
      const envObj: Record<string, string> = {};
      for (const [k, v] of Object.entries(config.environment)) {
        if (typeof v === 'string') envObj[k] = v;
      }
      state.config.environment = Object.keys(envObj).length > 0 ? envObj : undefined;
    }

    const jobStreaming = capabilities['ent/jobStreaming'];
    if (jobStreaming === 'full' || jobStreaming === 'coalesced' || jobStreaming === 'none') {
      state.jobManager.setStreamingMode(jobStreaming);
    }

    const { toolsForProvider } = await createToolExecutorForMode('execute', state.mcpServerManager);
    const toolInfos: ToolInfo[] = [];
    const seenToolNames = new Set<string>();
    for (const tool of toolsForProvider) {
      const info = protocolToolInfoForCoreTool(tool);
      if (seenToolNames.has(info.name)) continue;
      seenToolNames.add(info.name);
      toolInfos.push(info);
    }

    return {
      protocolVersion: '1.0',
      agentInfo: { name: 'lace-agent', version: '0.1.0' },
      capabilities: {
        streaming: true,
        multiTurn: true,
        session: { fork: {}, resume: {} },
        tools: toolInfos,
        operations: { checkpoint: true, rewind: true, configure: true, compact: true },
        'ent/contextInjection': true,
        'ent/backgroundJobs': true,
        'ent/fileCheckpointing': true,
        'ent/structuredOutput': false,
        'ent/providers': {
          list: true,
          connections: true,
          models: true,
          catalogRefresh: true,
          modelGating: true,
        },
        slashCommands: [
          { name: 'compact', description: 'Summarize and compress context', source: 'builtin' },
          { name: 'clear', description: 'Clear conversation, start fresh', source: 'builtin' },
          {
            name: 'mode',
            description: 'Switch approval mode (ask|approveReads|approveEdits|approve|deny)',
            source: 'builtin',
          },
          { name: 'abort', description: 'Abort current operation', source: 'builtin' },
          { name: 'help', description: 'Show available commands', source: 'builtin' },
          // Include user commands from ~/.lace/commands/ (global only at init time)
          ...getUserSlashCommands(),
        ],
      },
    };
  });
}
