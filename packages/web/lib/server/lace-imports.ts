// ABOUTME: Deprecated legacy server import surface for older docs/examples
// ABOUTME: Must not reach into the agent package; web owns its own storage and uses ENT for agent features

export { Project } from './projects/project';
export { ensureLaceWebDir, getLaceWebDir, getLaceWebFilePath } from './web-data-dir';
export { UserSettingsManager } from './user-settings';
export { McpConfigStore } from './mcp-config-store';
