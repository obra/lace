// ABOUTME: Server-side imports for Lace core modules
// ABOUTME: Uses module path aliases that must be configured in build tools

// Import from built Lace dist directory
// These paths assume the web app is run from packages/web
export { Agent } from '../../../../dist/agents/agent.js';
export { ThreadManager } from '../../../../dist/threads/thread-manager.js';
export { ProviderRegistry } from '../../../../dist/providers/registry.js';
export { ToolExecutor } from '../../../../dist/tools/executor.js';
export { getLaceDbPath } from '../../../../dist/config/lace-dir.js';
export { getEnvVar } from '../../../../dist/config/env-loader.js';
export { DelegateTool } from '../../../../dist/tools/implementations/delegate.js';

// Types can use source paths since they're compile-time only
export type { ThreadId } from '../../../../src/types/threads';
export type { ThreadEvent, EventType } from '../../../../src/threads/types';
export type { ApprovalDecision } from '../../../../src/tools/approval-types';
export type { ToolAnnotations } from '../../../../src/tools/types';
export type { AgentState } from '../../../../src/agents/agent';

// Constants can be imported from built code 
export { EVENT_TYPES } from '../../../../dist/threads/types.js';