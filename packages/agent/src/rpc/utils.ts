// ABOUTME: Pure utility functions for RPC parameter validation and data transformation
// This module contains helper functions for validating RPC parameters, converting between
// core tool formats and protocol formats, and comparing configuration objects.

import { EntErrorCodes, type ToolInfo, type ToolResult } from '@lace/ent-protocol';
import type { CatalogModel, ProviderInstance } from '../providers/catalog/types';
import { ProviderInstanceSchema } from '../providers/catalog/types';
import type { ToolResult as CoreToolResult } from '../tools/types';
import type { Tool as CoreTool } from '../tools/tool';
import type { MCPServerConfig } from '../config/mcp-types';
import type { AgentServerState } from '../server-types';

export function throwInvalidParams(reason?: string): never {
  throw {
    code: -32602,
    message: 'InvalidParams',
    data: { category: 'protocol', ...(reason ? { reason } : {}) },
  };
}

export function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const truncated = Math.trunc(value);
  return truncated > 0 ? truncated : null;
}

export function getEndpointFromConfig(config: Record<string, unknown>): string | undefined {
  const endpoint =
    toNonEmptyString(config.endpoint) ??
    toNonEmptyString(config.baseUrl) ??
    toNonEmptyString(config.baseURL);

  if (!endpoint) return undefined;

  try {
    // Require absolute URL, consistent with core ProviderInstanceSchema
    new URL(endpoint);
  } catch {
    throwInvalidParams('endpoint must be a valid absolute URL');
  }

  return endpoint;
}

export function assertConfigHasNoCredentials(config: Record<string, unknown>): void {
  const forbiddenKeys = ['apiKey', 'api_key', 'token', 'accessToken', 'authorization'];
  for (const key of forbiddenKeys) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      throwInvalidParams(`Connection config MUST NOT include credentials (${key})`);
    }
  }
}

export function parseProviderInstanceOverridesFromConnectionConfig(options: {
  displayName: string;
  catalogProviderId: string;
  config: Record<string, unknown>;
}): Partial<Pick<ProviderInstance, 'endpoint' | 'timeout' | 'retryPolicy' | 'modelConfig'>> {
  const endpoint = getEndpointFromConfig(options.config);

  const timeoutInput = (options.config as any).timeout;
  const timeout = timeoutInput === undefined ? undefined : toPositiveInt(timeoutInput);
  if (timeoutInput !== undefined && timeout === null) {
    throwInvalidParams('timeout must be a positive integer');
  }

  const retryPolicy = toNonEmptyString((options.config as any).retryPolicy) ?? undefined;
  const modelConfigInput = (options.config as any).modelConfig;

  const parsed = ProviderInstanceSchema.safeParse({
    displayName: options.displayName,
    catalogProviderId: options.catalogProviderId,
    ...(endpoint ? { endpoint } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
    ...(retryPolicy ? { retryPolicy } : {}),
    ...(modelConfigInput !== undefined ? { modelConfig: modelConfigInput } : {}),
  });

  if (!parsed.success) {
    throwInvalidParams(parsed.error.issues[0]?.message ?? 'Invalid connection config');
  }

  return {
    ...(parsed.data.endpoint ? { endpoint: parsed.data.endpoint } : {}),
    ...(parsed.data.timeout !== undefined ? { timeout: parsed.data.timeout } : {}),
    ...(parsed.data.retryPolicy ? { retryPolicy: parsed.data.retryPolicy } : {}),
    ...(parsed.data.modelConfig ? { modelConfig: parsed.data.modelConfig } : {}),
  };
}

export function mapCatalogModelToModelInfo(model: CatalogModel, providerId: string) {
  return {
    modelId: model.id,
    name: model.name,
    providerId,
    contextWindow: model.context_window,
    maxOutput: model.default_max_tokens,
    supportsThinking: !!model.can_reason || !!model.has_reasoning_effort,
    supportsImages: !!model.supports_attachments,
  };
}

export function toolKindFromName(name: string): ToolInfo['kind'] {
  if (name === 'file_read') return 'read';
  if (name === 'file_find') return 'search';
  if (name === 'ripgrep_search') return 'search';
  if (name === 'url_fetch') return 'fetch';
  if (name === 'bash') return 'execute';
  if (name === 'delegate') return 'execute';
  if (name === 'file_write') return 'edit';
  if (name === 'file_edit') return 'edit';
  return 'other';
}

export function protocolToolInfoForCoreTool(tool: CoreTool): ToolInfo {
  const kind = toolKindFromName(tool.name);
  return {
    name: tool.name,
    description: tool.description,
    kind,
    inputSchema: tool.inputSchema as Record<string, unknown>,
    requiresPermission: kind !== 'read' && kind !== 'search',
  };
}

export function protocolToolResultFromCore(result: CoreToolResult): ToolResult {
  const outcome: ToolResult['outcome'] =
    result.status === 'completed'
      ? 'completed'
      : result.status === 'denied'
        ? 'denied'
        : result.status === 'aborted'
          ? 'cancelled'
          : 'failed';

  const content: ToolResult['content'] = (result.content || []).map((c) => {
    if (c.type === 'text') return { type: 'text', text: c.text ?? '' };
    if (c.type === 'image')
      return { type: 'image', data: c.data ?? '', mediaType: 'application/octet-stream' };
    if (c.type === 'resource') return { type: 'text', text: c.uri ?? '' };
    return { type: 'text', text: '' };
  });

  return { outcome, content, ...(result.metadata ? { meta: result.metadata as any } : {}) };
}

export function coreToolResultFromProtocol(result: ToolResult, toolCallId: string): CoreToolResult {
  const status: CoreToolResult['status'] =
    result.outcome === 'completed'
      ? 'completed'
      : result.outcome === 'denied'
        ? 'denied'
        : result.outcome === 'cancelled'
          ? 'aborted'
          : 'failed';

  const content: CoreToolResult['content'] = result.content.map((c) => {
    if (c.type === 'text') return { type: 'text', text: c.text };
    if (c.type === 'json') return { type: 'text', text: JSON.stringify(c.data, null, 2) };
    if (c.type === 'image') return { type: 'image', data: c.data };
    if (c.type === 'error') return { type: 'text', text: c.message };
    return { type: 'text', text: '' };
  });

  return {
    id: toolCallId,
    content,
    status,
    ...(result.meta ? { metadata: result.meta } : {}),
  };
}

export function shouldAskPermission(
  approvalMode: AgentServerState['config']['approvalMode'],
  toolKind: ReturnType<typeof toolKindFromName>
): boolean {
  if (approvalMode === 'dangerouslySkipPermissions' || approvalMode === 'approve') return false;
  if (approvalMode === 'deny') return false;

  if (approvalMode === 'approveReads') {
    return toolKind !== 'read' && toolKind !== 'search';
  }

  if (approvalMode === 'approveEdits') {
    return toolKind !== 'read' && toolKind !== 'search' && toolKind !== 'edit';
  }

  // ask
  return toolKind !== 'read' && toolKind !== 'search';
}

export function isTestProviderEnabled(): boolean {
  return process.env.LACE_AGENT_TEST_PROVIDER === '1';
}

export function assertInitialized(state: AgentServerState): void {
  if (!state.initialized)
    throw {
      code: EntErrorCodes.NotInitialized,
      message: 'NotInitialized',
      data: { category: 'agent_internal' },
    };
}

export function arraysShallowEqual(a?: string[], b?: string[]): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function recordsShallowEqual(
  a?: Record<string, string>,
  b?: Record<string, string>
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export function mcpServerConfigEquivalent(a: MCPServerConfig, b: MCPServerConfig): boolean {
  return (
    a.command === b.command &&
    arraysShallowEqual(a.args, b.args) &&
    recordsShallowEqual(a.env, b.env) &&
    a.enabled === b.enabled &&
    recordsShallowEqual(a.tools as Record<string, string>, b.tools as Record<string, string>)
  );
}
