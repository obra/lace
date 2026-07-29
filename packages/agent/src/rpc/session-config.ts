// ABOUTME: Shared session configuration helpers used by lifecycle and configure handlers.

import {
  McpServerConfigSchema,
  type McpServerConfig,
  type SessionConfigOption,
} from '@lace/ent-protocol';
import type { AgentServerState } from '../server-types';
import type { SessionState, StoredMcpServer } from '../storage/session-store';
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

export function defaultMcpServerPlacements(servers: McpServerConfig[]): McpServerConfig[] {
  return servers.map(withDefaultMcpPlacement);
}

function validateIncomingMcpServers(incoming: unknown): McpServerConfig[] {
  const parsed = McpServerConfigSchema.array().safeParse(incoming);
  if (!parsed.success) {
    throwInvalidParams('mcpServers is invalid');
  }
  return parsed.data;
}

/**
 * Additive merge used by session/new only: persona-defaults form the existing
 * baseline, request-level mcpServers augment / override by name. Both inputs
 * come from the embedder, so the result is tagged 'embedder' wholesale.
 */
export function mergeMcpServers(existing: unknown, incoming: unknown): McpServerConfig[] {
  const incomingServers = defaultMcpServerPlacements(validateIncomingMcpServers(incoming));
  const parsedExisting = Array.isArray(existing)
    ? McpServerConfigSchema.array().safeParse(existing)
    : { success: true as const, data: [] as McpServerConfig[] };
  const existingServers = parsedExisting.success
    ? defaultMcpServerPlacements(parsedExisting.data)
    : [];

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

/**
 * Tag a list of protocol-shape mcp server entries with a storage `source`.
 * The protocol carries no source field; lace assigns one when storing.
 */
export function tagMcpServers(
  servers: McpServerConfig[],
  source: StoredMcpServer['source']
): StoredMcpServer[] {
  return servers.map((s) => ({ ...s, source }));
}

/**
 * Apply an embedder-supplied mcpServers list to the stored entries for a
 * session. The embedder owns its declared set authoritatively: every existing
 * stored entry with `source === 'embedder'` (or missing source, treated as
 * embedder for migration) is replaced wholesale by `incoming`. Stored entries
 * with `source === 'user'` (added through ent/mcp/servers/upsert) survive,
 * with user entries winning on name collision so operator intent isn't
 * silently overwritten by an embedder restart.
 *
 * This is the merge used by session/load and session/resume — the bug it fixed:
 * a since-deleted embedder MCP server stuck around in state.json and lace tried
 * to spawn its missing command.
 *
 * Entries with `source === 'persona'` also survive, because the embedder never
 * declared them and so cannot re-declare them on resume. `subagent-job.ts`
 * resumes with `mcpServers: []`, which previously wiped a persona's servers:
 * a resumed browser-user lost `superpowers-chrome`, its tool count dropped
 * 10 -> 9, and the model kept calling a tool that was no longer registered.
 * An incoming entry of the same name still wins, so an embedder can override
 * a persona default deliberately.
 */
export function applyEmbedderMcpServers(existing: unknown, incoming: unknown): StoredMcpServer[] {
  const incomingServers = defaultMcpServerPlacements(validateIncomingMcpServers(incoming));
  const existingList: StoredMcpServer[] = Array.isArray(existing)
    ? (existing as StoredMcpServer[])
    : [];
  const incomingNames = new Set(incomingServers.map((s) => s.name));

  const userOwned = existingList.filter((s) => s?.source === 'user');
  const userOwnedNames = new Set(userOwned.map((s) => s.name));
  // A persona default is superseded by an explicit incoming server of the same
  // name; otherwise it is carried through untouched.
  const personaOwned = existingList.filter(
    (s) => s?.source === 'persona' && !incomingNames.has(s.name) && !userOwnedNames.has(s.name)
  );

  const merged: StoredMcpServer[] = [];
  for (const server of incomingServers) {
    if (userOwnedNames.has(server.name)) continue;
    merged.push({ ...server, source: 'embedder' });
  }
  for (const server of personaOwned) {
    merged.push({ ...server, source: 'persona' });
  }
  for (const server of userOwned) {
    merged.push({ ...server, source: 'user' });
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
