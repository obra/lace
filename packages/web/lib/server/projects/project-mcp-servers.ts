import type { McpServerConfig } from '@lace/ent-protocol';
import type { Project } from './project';

export function mcpServersForProject(project: Project): McpServerConfig[] {
  return Object.entries(project.getMCPServers()).map(([name, config]) => ({
    name,
    command: config.command,
    ...(config.args ? { args: config.args } : {}),
    ...(config.env ? { env: config.env } : {}),
    enabled: config.enabled,
    tools: config.tools,
  }));
}
