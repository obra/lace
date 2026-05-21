// ABOUTME: Shared session configuration helpers used by lifecycle and configure handlers.

import {
  McpServerConfigSchema,
  type McpServerConfig,
  type SessionConfigOption,
} from '@lace/ent-protocol';
import type { AgentServerState } from '../server-types';
import type { SessionState } from '../storage/session-store';
import { throwInvalidParams } from './utils';

type ApprovalMode = AgentServerState['config']['approvalMode'];

const APPROVAL_MODE_OPTIONS: Array<{ value: ApprovalMode; name: string; description: string }> = [
  { value: 'ask', name: 'Ask', description: 'Ask before tools that need approval' },
  { value: 'approveReads', name: 'Read Only', description: 'Allow read-only tools automatically' },
  {
    value: 'approveEdits',
    name: 'Auto Edit',
    description: 'Allow read and edit tools automatically',
  },
  { value: 'approve', name: 'Auto', description: 'Allow all tools automatically' },
  { value: 'deny', name: 'Deny', description: 'Deny tools that need approval' },
  {
    value: 'dangerouslySkipPermissions',
    name: 'Full Access',
    description: 'Run without permission prompts',
  },
];

function withDefaultMcpPlacement(server: McpServerConfig): McpServerConfig {
  if (server.placement) return server;

  return {
    ...server,
    placement: server.transport === 'http' || server.transport === 'sse' ? 'host' : 'toolRuntime',
  };
}

export function mergeMcpServers(existing: unknown, incoming: unknown): McpServerConfig[] {
  const parsedIncoming = McpServerConfigSchema.array().safeParse(incoming);
  if (!parsedIncoming.success) {
    throwInvalidParams('mcpServers is invalid');
  }

  const parsedExisting = Array.isArray(existing)
    ? McpServerConfigSchema.array().safeParse(existing)
    : { success: true as const, data: [] as McpServerConfig[] };
  const existingServers = parsedExisting.success
    ? parsedExisting.data.map(withDefaultMcpPlacement)
    : [];
  const incomingServers = parsedIncoming.data.map(withDefaultMcpPlacement);

  const incomingByName = new Map(incomingServers.map((server) => [server.name, server]));
  const merged: McpServerConfig[] = [];
  const seen = new Set<string>();

  for (const oldServer of existingServers) {
    const incomingServer = incomingByName.get(oldServer.name);
    if (incomingServer) {
      merged.push(incomingServer);
    } else {
      merged.push(oldServer);
    }
    seen.add(oldServer.name);
  }

  for (const server of incomingServers) {
    if (seen.has(server.name)) continue;
    merged.push(server);
  }

  return merged;
}

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return (
    typeof value === 'string' && APPROVAL_MODE_OPTIONS.some((option) => option.value === value)
  );
}

export function buildSessionConfigOptions(
  serverConfig: AgentServerState['config'],
  sessionConfig?: SessionState['config']
): SessionConfigOption[] {
  const effective = { ...serverConfig, ...(sessionConfig ?? {}) };
  const configOptions: SessionConfigOption[] = [
    {
      id: 'approvalMode',
      name: 'Permission Mode',
      category: '_permission_mode',
      type: 'select',
      currentValue: effective.approvalMode,
      options: APPROVAL_MODE_OPTIONS,
    },
  ];

  if (effective.modelId) {
    configOptions.push({
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: effective.modelId,
      options: [{ value: effective.modelId, name: effective.modelId }],
    });
  }

  return configOptions;
}
