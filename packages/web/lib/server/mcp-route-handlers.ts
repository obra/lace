// ABOUTME: Shared MCP route handler functions for global and project-scoped MCP routes
// ABOUTME: Abstracts storage layer differences to reduce duplication across route files

import { z } from 'zod';
import { McpConfigStore } from '@lace/web/lib/server/mcp-config-store';
import { Project } from '@lace/web/lib/server/projects/project';
import { RouteValidationError, throwNotFound } from './route-helpers';

/**
 * Context for MCP route operations.
 * When projectId is undefined, operations target global MCP configuration.
 * When projectId is defined, operations target project-specific MCP configuration.
 */
export interface McpRouteContext {
  projectId?: string;
}

/**
 * Server info returned from handler operations.
 * Includes the server ID along with its configuration.
 * Note: Some fields are optional in storage but required in MCPServerConfig.
 * We define our own interface to match what's actually stored.
 */
export interface McpServerInfo {
  id: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  tools?: Record<string, 'allow' | 'ask' | 'deny' | 'disable'>;
}

/**
 * Input config for creating/updating MCP servers.
 * Matches the storage schema where some fields are optional.
 */
export type McpServerConfigInput = Omit<McpServerInfo, 'id'>;

// ============================================================================
// Shared Zod Schemas for MCP Server Operations
// ============================================================================

/**
 * Schema for creating a new MCP server.
 * Used when creating a server via POST to the collection endpoint.
 */
export const CreateServerSchema = z.object({
  id: z.string().min(1, 'Server ID is required'),
  command: z.string().min(1, 'Command is required'),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().default(true),
  tools: z.record(z.string(), z.enum(['allow', 'ask', 'deny', 'disable'])).default({}),
});

/**
 * Schema for creating a server when the ID is already in the URL.
 * Used when creating via POST to the individual server endpoint.
 */
export const CreateServerConfigSchema = z.object({
  command: z.string().min(1, 'Command is required'),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().default(true),
  tools: z.record(z.string(), z.enum(['allow', 'ask', 'deny', 'disable'])).default({}),
});

/**
 * Schema for updating an existing MCP server.
 * All fields are optional since it's a partial update.
 */
export const UpdateServerSchema = z.object({
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
  tools: z.record(z.string(), z.enum(['allow', 'ask', 'deny', 'disable'])).optional(),
});

// ============================================================================
// Handler Functions
// ============================================================================

/**
 * Gets the project instance, throwing RouteValidationError if not found.
 */
function requireProject(projectId: string): Project {
  const project = Project.getById(projectId);
  if (!project) {
    throwNotFound('Project');
  }
  return project;
}

/**
 * Lists all MCP servers for the given context.
 * For global context: returns servers from McpConfigStore
 * For project context: returns servers from the project
 */
export async function listMcpServers(ctx: McpRouteContext): Promise<McpServerInfo[]> {
  if (ctx.projectId !== undefined) {
    const project = requireProject(ctx.projectId);
    const servers = project.getMCPServers();
    return Object.entries(servers).map(([id, config]) => ({ id, ...config }));
  }

  const globalConfig = McpConfigStore.loadGlobalConfig();
  if (!globalConfig) {
    return [];
  }
  return Object.entries(globalConfig.servers).map(([id, config]) => ({ id, ...config }));
}

/**
 * Gets a specific MCP server by ID.
 * Throws RouteValidationError if server not found.
 */
export async function getMcpServer(ctx: McpRouteContext, serverId: string): Promise<McpServerInfo> {
  if (ctx.projectId !== undefined) {
    const project = requireProject(ctx.projectId);
    const serverConfig = project.getMCPServer(serverId);
    if (!serverConfig) {
      throw new RouteValidationError(`MCP server '${serverId}' not found`, 404, 'RESOURCE_NOT_FOUND');
    }
    return { id: serverId, ...serverConfig };
  }

  const globalConfig = McpConfigStore.loadGlobalConfig();
  const serverConfig = globalConfig?.servers[serverId];
  if (!serverConfig) {
    throw new RouteValidationError(`MCP server '${serverId}' not found`, 404, 'RESOURCE_NOT_FOUND');
  }
  return { id: serverId, ...serverConfig };
}

/**
 * Creates a new MCP server.
 * Throws RouteValidationError if server already exists.
 */
export async function createMcpServer(
  ctx: McpRouteContext,
  serverId: string,
  config: McpServerConfigInput
): Promise<McpServerInfo> {
  if (ctx.projectId !== undefined) {
    const project = requireProject(ctx.projectId);
    const existingServer = project.getMCPServer(serverId);
    if (existingServer) {
      throw new RouteValidationError(
        `MCP server '${serverId}' already exists`,
        409,
        'DUPLICATE_SERVER'
      );
    }
    // Cast to MCPServerConfig as the Zod schema has already validated the config
    project.addMCPServer(serverId, config as import('@lace/web/types/core').MCPServerConfig);
    return { id: serverId, ...config };
  }

  const globalConfig = McpConfigStore.loadGlobalConfig() || { servers: {} };
  if (globalConfig.servers[serverId]) {
    throw new RouteValidationError(
      `MCP server '${serverId}' already exists`,
      409,
      'DUPLICATE_SERVER'
    );
  }
  const updatedConfig = {
    ...globalConfig,
    servers: {
      ...globalConfig.servers,
      [serverId]: config,
    },
  };
  McpConfigStore.saveGlobalConfig(updatedConfig);
  return { id: serverId, ...config };
}

/**
 * Updates an existing MCP server.
 * Throws RouteValidationError if server not found.
 */
export async function updateMcpServer(
  ctx: McpRouteContext,
  serverId: string,
  updates: Partial<McpServerConfigInput>
): Promise<McpServerInfo> {
  if (ctx.projectId !== undefined) {
    const project = requireProject(ctx.projectId);
    const existingConfig = project.getMCPServer(serverId);
    if (!existingConfig) {
      throw new RouteValidationError(`MCP server '${serverId}' not found`, 404, 'RESOURCE_NOT_FOUND');
    }
    const mergedConfig = { ...existingConfig, ...updates };
    // Cast to MCPServerConfig as the merged config is validated
    project.updateMCPServer(serverId, mergedConfig as import('@lace/web/types/core').MCPServerConfig);
    return { id: serverId, ...mergedConfig };
  }

  const globalConfig = McpConfigStore.loadGlobalConfig();
  const existingConfig = globalConfig?.servers[serverId];
  if (!existingConfig) {
    throw new RouteValidationError(`MCP server '${serverId}' not found`, 404, 'RESOURCE_NOT_FOUND');
  }
  const mergedConfig = { ...existingConfig, ...updates };
  const updatedGlobalConfig = {
    ...globalConfig,
    servers: {
      ...globalConfig.servers,
      [serverId]: mergedConfig,
    },
  };
  McpConfigStore.saveGlobalConfig(updatedGlobalConfig);
  return { id: serverId, ...mergedConfig };
}

/**
 * Deletes an MCP server.
 * Throws RouteValidationError if server not found.
 */
export async function deleteMcpServer(ctx: McpRouteContext, serverId: string): Promise<void> {
  if (ctx.projectId !== undefined) {
    const project = requireProject(ctx.projectId);
    const existingConfig = project.getMCPServer(serverId);
    if (!existingConfig) {
      throw new RouteValidationError(`MCP server '${serverId}' not found`, 404, 'RESOURCE_NOT_FOUND');
    }
    project.deleteMCPServer(serverId);
    return;
  }

  const globalConfig = McpConfigStore.loadGlobalConfig();
  if (!globalConfig?.servers[serverId]) {
    throw new RouteValidationError(`MCP server '${serverId}' not found`, 404, 'RESOURCE_NOT_FOUND');
  }
  const updatedConfig = { ...globalConfig };
  delete updatedConfig.servers[serverId];
  McpConfigStore.saveGlobalConfig(updatedConfig);
}
