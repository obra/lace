// ABOUTME: Initialize RPC handler for client connection setup and capability negotiation

import type { JsonRpcPeer, ToolInfo } from '@lace/ent-protocol';
import { EntErrorCodes } from '@lace/ent-protocol';
import { getUserSlashCommands } from '../../user-commands';
import { protocolToolInfoForCoreTool } from '../utils';
import type {
  AgentServerState,
  ContainerExecutionIdentityConfig,
  CreateToolExecutorFn,
  MountRegistryEntry,
} from '../../server-types';
import { PersonaRegistry } from '../../config/persona-registry';
import { warnMountConflicts } from '../../config/persona-mount-conflict';
import { resolveResourcePath } from '../../utils/resource-resolver';
import { logger } from '../../utils/logger';

const MOUNT_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

function invalidParams(): never {
  throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };
}

function parseContainerMounts(raw: unknown): Record<string, MountRegistryEntry> {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    invalidParams();
  }
  const result: Record<string, MountRegistryEntry> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!MOUNT_NAME_PATTERN.test(name)) {
      invalidParams();
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      invalidParams();
    }
    const entry = value as Record<string, unknown>;
    if (typeof entry.hostPath !== 'string' || entry.hostPath.length === 0) {
      invalidParams();
    }
    if (typeof entry.readonly !== 'boolean') {
      invalidParams();
    }
    result[name] = { hostPath: entry.hostPath, readonly: entry.readonly };
  }
  return result;
}

function parseContainerExecutionIdentity(
  raw: unknown
): ContainerExecutionIdentityConfig | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    invalidParams();
  }
  const identity = raw as Record<string, unknown>;
  if (Object.keys(identity).some((key) => key !== 'tokenEnvName')) {
    invalidParams();
  }
  if (
    typeof identity.tokenEnvName !== 'string' ||
    !ENV_VAR_NAME_PATTERN.test(identity.tokenEnvName)
  ) {
    invalidParams();
  }
  return { tokenEnvName: identity.tokenEnvName };
}

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
    state.containerExecutionIdentity = parseContainerExecutionIdentity(
      parsed.containerExecutionIdentity
    );

    // Embedder-controlled persona search paths; ordered, earlier paths win.
    if (Array.isArray(parsed.userPersonasPaths)) {
      const userPaths: string[] = [];
      for (const p of parsed.userPersonasPaths) {
        if (typeof p !== 'string' || p.length === 0) {
          throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };
        }
        userPaths.push(p);
      }
      state.personaRegistry = new PersonaRegistry({
        bundledPersonasPath: resolveResourcePath(import.meta.url, 'agent-personas'),
        userPersonasPaths: userPaths,
      });
    }

    // Embedder-supplied named-mount registry. Persona containers resolve their
    // `runtime.mounts[name]` against this map at materialization time. Always
    // stored on state (defaults to {}). Parse before the R6 boot scan so the
    // readonly flags are available for conflict filtering.
    state.containerMounts = parseContainerMounts(parsed.containerMounts);

    // R6 boot-time invariant: log a WARN for any per_invocation persona that
    // declares a read-write mount-registry name also claimed by a persistent
    // persona. Readonly mounts are not a threat and are excluded. Never throws —
    // a bad persona config is surfaced here but doesn't prevent the embedder
    // from finishing initialization. The spawn-time assertNoMountConflict in
    // delegate.ts provides the hard reject (PRI-1796).
    try {
      warnMountConflicts(state.personaRegistry, state.containerMounts);
    } catch (err) {
      logger.warn('persona_mount_conflict.boot_scan_error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Embedder-controlled skill directories; ordered, earlier paths win.
    if (Array.isArray(parsed.skillDirs)) {
      const skillDirs: string[] = [];
      for (const p of parsed.skillDirs) {
        if (typeof p !== 'string' || p.length === 0) {
          throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };
        }
        skillDirs.push(p);
      }
      state.skillDirs = skillDirs;
    }

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

    const { toolsForProvider } = await createToolExecutorForMode(
      'execute',
      state.mcpServerManager,
      undefined, // jobManager
      undefined, // skillRegistry
      undefined, // toolScope
      state.personaRegistry
    );
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
        session: { fork: {}, resume: {}, close: {} },
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
