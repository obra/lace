import type { McpServerConfig } from '@lace/ent-protocol';
import type { Project } from './project';

export function mcpServersForProject(project: Project): McpServerConfig[] {
  return Object.entries(project.getMCPServers()).map(([name, config]) => ({
    name,
    command: config.command,
    ...(config.args ? { args: config.args } : {}),
    ...(config.env ? { env: config.env } : {}),
    ...(config.transport ? { transport: config.transport } : {}),
    ...(config.placement ? { placement: config.placement } : {}),
    ...(config.secretEnv ? { secretEnv: config.secretEnv } : {}),
    enabled: config.enabled,
    tools: config.tools,
  }));
}
