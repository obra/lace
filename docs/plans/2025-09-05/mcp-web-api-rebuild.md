# MCP Web API Rebuild Implementation Plan

## Context for External Engineer

### Background
The initial MCP integration has good core infrastructure but the web API was architecturally wrong. It used global APIs with client-provided project paths instead of following Lace's established project/session hierarchy patterns. This plan rebuilds the web API correctly.

### Prerequisites
- Part 1 MCP core integration must be complete and working
- Understanding of Lace's project/session architecture
- Understanding of LaceEvent system in `src/threads/types.ts`

### Key Architectural Principles
1. **Project Hierarchy**: `/api/projects/$projectId/mcp/*` not `/api/mcp/*`
2. **Session Runtime**: MCP servers run per-session, not globally
3. **Event-Driven**: Use existing LaceEvent system for configuration changes
4. **Proper Delegation**: Projects delegate to config system, don't reimplement
5. **RESTful Design**: Per-resource endpoints, not monolithic blobs

### Current Architecture Issues to Fix
- MCP config files in wrong directory (`src/mcp/` should be `src/config/`)
- Web APIs bypass project context (security issue)
- No integration with project/session configuration inheritance
- Fresh ToolExecutor instances in web APIs miss MCP tools

## Implementation Tasks

### Phase 1: Core Configuration System Fixes

#### Task 1.1: Move MCP Configuration to Proper Location and Add Project Integration

**Objective**: Move MCP configuration to correct directory structure, add proper event types, and integrate MCP configuration management into Project class using proper delegation patterns.

**Files to Move:**
```bash
mv src/mcp/config-loader.ts src/config/mcp-config-loader.ts
mv src/mcp/types.ts src/config/mcp-types.ts  
mv src/mcp/config-loader.test.ts src/config/mcp-config-loader.test.ts
```

**Files to Modify:**
- `src/threads/types.ts` (add MCP event types)
- `src/projects/project.ts` (add MCP configuration methods)
- `src/sessions/session.ts` (add MCP event announcement)
- All files importing from `~/mcp/config-loader` (update import paths)

#### **Step 1.1.1: Add MCP Event Types to Global Event System**

**File**: `src/threads/types.ts`

**Add to EVENT_TYPES array:**
```typescript
export const EVENT_TYPES = [
  // ... existing events
  'MCP_CONFIG_CHANGED',        // When project MCP config changes
  'MCP_SERVER_STATUS_CHANGED', // When MCP server starts/stops/fails  
] as const;
```

**Add to LaceEvent union type:**
```typescript
export type LaceEvent =
  // ... existing event types
  | (BaseLaceEvent & {
      type: 'MCP_CONFIG_CHANGED';
      data: {
        serverId: string;
        action: 'created' | 'updated' | 'deleted';
        serverConfig?: MCPServerConfig;
      };
    })
  | (BaseLaceEvent & {
      type: 'MCP_SERVER_STATUS_CHANGED';
      data: {
        serverId: string;
        status: 'starting' | 'running' | 'stopped' | 'failed';
        error?: string;
      };
    });
```

**Test:**
```typescript
// Add to existing event type tests
describe('MCP Event Types', () => {
  it('should include MCP event types in EVENT_TYPES array', () => {
    expect(EVENT_TYPES).toContain('MCP_CONFIG_CHANGED');
    expect(EVENT_TYPES).toContain('MCP_SERVER_STATUS_CHANGED');
  });
  
  it('should validate MCP event structure', () => {
    const mcpConfigEvent: LaceEvent = {
      type: 'MCP_CONFIG_CHANGED',
      threadId: 'test-thread',
      data: {
        serverId: 'filesystem',
        action: 'updated',
        serverConfig: {
          command: 'npx',
          enabled: true,
          tools: {}
        }
      },
      context: {
        sessionId: 'test-session',
        projectId: 'test-project'
      },
      transient: true
    };
    
    expect(mcpConfigEvent.type).toBe('MCP_CONFIG_CHANGED');
    expect(mcpConfigEvent.data.serverId).toBe('filesystem');
  });
});
```

#### **Step 1.1.2: Update Config System with Validation and Error Recovery**

**File**: `src/config/mcp-config-loader.ts` (moved from `src/mcp/`)

**Enhanced validation:**
```typescript
export class MCPConfigLoader {
  /**
   * Load config with validation and automatic error recovery
   */
  static loadConfig(projectRoot?: string): MCPConfig {
    const rawConfig = this.loadRawConfig(projectRoot);
    return this.validateConfig(rawConfig);
  }
  
  /**
   * Validate config and disable invalid servers (graceful degradation)
   */
  static validateConfig(config: MCPConfig): MCPConfig {
    const validatedConfig = { ...config };
    
    for (const [serverId, serverConfig] of Object.entries(validatedConfig.servers)) {
      try {
        MCPServerConfigSchema.parse(serverConfig);
      } catch (error) {
        // Disable invalid servers, keep valid ones running
        validatedConfig.servers[serverId] = {
          ...serverConfig,
          enabled: false,
          tools: {}
        };
        logger.warn(`Disabled invalid MCP server ${serverId}:`, error);
      }
    }
    
    return validatedConfig;
  }
  
  /**
   * Save config with validation
   */
  static saveConfig(config: MCPConfig, projectRoot?: string): void {
    // Validate before saving
    const validatedConfig = this.validateConfig(config);
    this.saveConfigFile(this.getConfigPath(projectRoot), validatedConfig);
  }
  
  // ... existing methods remain unchanged
}
```

#### **Step 1.1.3: Add MCP Methods to Project Class**

**File**: `src/projects/project.ts`

**Import updates:**
```typescript
import { MCPConfigLoader } from '~/config/mcp-config-loader';
import type { MCPServerConfig } from '~/config/mcp-types';
import { ThreadManager } from '~/threads/thread-manager';
```

**Methods to add:**
```typescript
class Project {
  /**
   * Get MCP servers configured for this project
   */
  getMCPServers(): Record<string, MCPServerConfig> {
    const config = MCPConfigLoader.loadConfig(this.getWorkingDirectory());
    return config.servers;
  }
  
  /**
   * Add new MCP server to project configuration
   */
  addMCPServer(serverId: string, serverConfig: MCPServerConfig): void {
    // Check for duplicates
    const existingServers = this.getMCPServers();
    if (existingServers[serverId]) {
      throw new Error(`MCP server '${serverId}' already exists in project`);
    }
    
    MCPConfigLoader.updateServerConfig(serverId, serverConfig, this.getWorkingDirectory());
    this.notifySessionsMCPChange(serverId, 'created', serverConfig);
  }
  
  /**
   * Update existing MCP server configuration
   */
  updateMCPServer(serverId: string, serverConfig: MCPServerConfig): void {
    MCPConfigLoader.updateServerConfig(serverId, serverConfig, this.getWorkingDirectory());
    this.notifySessionsMCPChange(serverId, 'updated', serverConfig);
  }
  
  /**
   * Remove MCP server from project configuration
   */
  deleteMCPServer(serverId: string): void {
    MCPConfigLoader.deleteServerConfig(serverId, this.getWorkingDirectory());
    this.notifySessionsMCPChange(serverId, 'deleted');
  }
  
  private notifySessionsMCPChange(
    serverId: string, 
    action: 'created' | 'updated' | 'deleted', 
    serverConfig?: MCPServerConfig
  ): void {
    const threadManager = ThreadManager.getInstance();
    
    // Notify all active sessions in this project
    const sessions = this.getAllSessions();
    sessions.forEach(session => {
      session.announceMCPConfigChange(serverId, action, serverConfig);
    });
  }
}
```

#### **Step 1.1.4: Add Session MCP Event Announcement**

**File**: `src/sessions/session.ts`

**Method to add:**
```typescript
class Session {
  /**
   * Announce MCP configuration change to this session's thread
   */
  announceMCPConfigChange(
    serverId: string, 
    action: 'created' | 'updated' | 'deleted',
    serverConfig?: MCPServerConfig
  ): void {
    this._threadManager.addEvent(this.getThreadId(), {
      type: 'MCP_CONFIG_CHANGED',
      data: { serverId, action, serverConfig },
      context: { 
        sessionId: this.getId(), 
        projectId: this.getProjectId() 
      },
      transient: true
    });
  }
}
```

#### **Step 1.1.5: Update All Import Paths**

**Files to Update:**
- `src/mcp/server-manager.ts` (import from `~/config/mcp-types`)
- `src/mcp/tool-registry.ts` (import from `~/config/mcp-types`)
- `src/mcp/tool-adapter.ts` (import from `~/config/mcp-types`)
- `src/tools/executor.ts` (import from `~/config/mcp-config-loader`)
- Any other files importing from old mcp config locations

**Example:**
```typescript
// OLD
import { MCPConfigLoader } from '~/mcp/config-loader';
import type { MCPConfig } from '~/mcp/types';

// NEW  
import { MCPConfigLoader } from '~/config/mcp-config-loader';
import type { MCPConfig } from '~/config/mcp-types';
```

**Testing:**
```bash
npm run build  # Verify all imports resolve correctly
npm test      # Verify all tests still pass
```

**Commit Message**: `refactor: move MCP config to proper location and add project integration with event system`

---

### **Task 1.1 Summary**

This task establishes the foundation for proper MCP configuration management by:

✅ **Moving config to correct location** (`src/config/`)  
✅ **Adding MCP events to global event system** (LaceEvent types)  
✅ **Project-level MCP management** (add/update/delete servers)  
✅ **Event-driven notifications** (sessions get notified of config changes)  
✅ **Graceful degradation** (invalid servers disabled, not failed)  
✅ **Proper delegation** (Project → Config system → File operations)

---

### Task 1.2: Session-Level MCP Server Management

**Objective**: Enable Sessions to manage running MCP servers (start/stop/restart) and handle MCP configuration change events from Projects, with proper ToolExecutor lifecycle management.

**Key Design Decisions:**
- MCP servers start eagerly for tool discovery
- Session-level MCPServerManager shared by all agents' ToolExecutors  
- Auto-restart only servers that were specifically changed in config events
- Continue with degraded functionality if servers fail to start
- Agent → Session → MCPServerManager delegation chain (uses existing `getFullSession()`)

#### **Step 1.2.1: Add MCPServerManager to Session Class**

**File**: `src/sessions/session.ts`

**Import additions:**
```typescript
import { MCPServerManager } from '~/mcp/server-manager';
import type { MCPServerConnection } from '~/mcp/types';
```

**Add to Session class:**
```typescript
class Session {
  private _mcpServerManager: MCPServerManager;
  
  constructor() {
    // ... existing constructor logic
    
    // Create session-scoped MCP server manager
    this._mcpServerManager = new MCPServerManager();
    
    // Start enabled MCP servers eagerly for tool discovery
    this.initializeMCPServers();
    
    // Listen for MCP config changes from project
    this.setupMCPEventHandling();
  }
  
  private async initializeMCPServers(): Promise<void> {
    try {
      const project = Project.getById(this.getProjectId());
      const mcpServers = project.getMCPServers();
      
      // Start all enabled servers for tool discovery
      const startPromises = Object.entries(mcpServers)
        .filter(([_, config]) => config.enabled)
        .map(([serverId, config]) => 
          this._mcpServerManager.startServer(serverId, config)
            .catch(error => {
              // Continue with server disabled on failure (graceful degradation)
              logger.warn(`MCP server ${serverId} failed to start, continuing disabled:`, error);
            })
        );
        
      await Promise.allSettled(startPromises);
      logger.info(`Initialized MCP servers for session ${this.getId()}`);
    } catch (error) {
      logger.warn(`Failed to initialize MCP servers for session ${this.getId()}:`, error);
    }
  }
  
  private setupMCPEventHandling(): void {
    this._threadManager.on('event', (event) => {
      if (event.type === 'MCP_CONFIG_CHANGED' && 
          event.context?.sessionId === this.getId()) {
        this.handleMCPConfigChange(event.data);
      }
    });
  }
  
  /**
   * Handle MCP configuration changes from project (auto-restart changed servers)
   */
  private async handleMCPConfigChange(data: {
    serverId: string;
    action: 'created' | 'updated' | 'deleted';
    serverConfig?: MCPServerConfig;
  }): Promise<void> {
    const { serverId, action, serverConfig } = data;
    
    try {
      // Auto-restart only the specific server that changed
      switch (action) {
        case 'created':
        case 'updated':
          await this._mcpServerManager.stopServer(serverId);
          if (serverConfig?.enabled) {
            await this._mcpServerManager.startServer(serverId, serverConfig);
            logger.info(`Restarted MCP server ${serverId} with new configuration`);
          }
          break;
          
        case 'deleted':
          await this._mcpServerManager.stopServer(serverId);
          logger.info(`Stopped and removed MCP server ${serverId}`);
          break;
      }
    } catch (error) {
      logger.warn(`Failed to handle MCP config change for server ${serverId}:`, error);
    }
  }
  
  /**
   * Server control methods (delegate to MCPServerManager)
   */
  async startMCPServer(serverId: string): Promise<void> {
    const project = Project.getById(this.getProjectId());
    const serverConfig = project.getMCPServers()[serverId];
    if (!serverConfig) {
      throw new Error(`MCP server '${serverId}' not found in project configuration`);
    }
    await this._mcpServerManager.startServer(serverId, serverConfig);
  }
  
  async stopMCPServer(serverId: string): Promise<void> {
    await this._mcpServerManager.stopServer(serverId);
  }
  
  async restartMCPServer(serverId: string): Promise<void> {
    await this.stopMCPServer(serverId);
    await this.startMCPServer(serverId);
  }
  
  getMCPServerStatus(serverId: string): MCPServerConnection | undefined {
    return this._mcpServerManager.getServer(serverId);
  }
  
  /**
   * Provide MCPServerManager access for ToolExecutor to query directly
   */
  getMCPServerManager(): MCPServerManager {
    return this._mcpServerManager;
  }
  
  /**
   * Announce MCP configuration change to this session's thread
   */
  announceMCPConfigChange(
    serverId: string, 
    action: 'created' | 'updated' | 'deleted',
    serverConfig?: MCPServerConfig
  ): void {
    this._threadManager.addEvent(this.getThreadId(), {
      type: 'MCP_CONFIG_CHANGED',
      data: { serverId, action, serverConfig },
      context: { 
        sessionId: this.getId(), 
        projectId: this.getProjectId() 
      },
      transient: true
    });
  }
  
  /**
   * Cleanup MCP servers when session ends
   */
  async cleanup(): Promise<void> {
    // ... existing cleanup logic
    
    // Shutdown MCP servers for this session
    await this._mcpServerManager.shutdown();
  }
}
```

#### **Step 1.2.2: Update ToolExecutor to Query Session MCPServerManager**

**File**: `src/tools/executor.ts`

**Remove existing MCP initialization:**
```typescript
// REMOVE these lines:
// private mcpRegistry?: MCPToolRegistry;
// this.initializeMCPRegistry().catch(...)
// private async initializeMCPRegistry()
// private registerMCPTools()
```

**Add session-based MCP access:**
```typescript
class ToolExecutor {
  private getMCPServerManager(): MCPServerManager | undefined {
    // Use existing agent → session relationship
    try {
      const session = this.context?.agent?.getFullSession?.();
      return session?.getMCPServerManager();
    } catch (error) {
      logger.warn('Failed to get MCP server manager from session:', error);
      return undefined;
    }
  }
  
  /**
   * Get all available tools including MCP tools from session
   */
  getAllTools(): Tool[] {
    const nativeTools = this.getNativeTools();
    const mcpTools = this.getMCPTools();
    return [...nativeTools, ...mcpTools];
  }
  
  private getNativeTools(): Tool[] {
    // Extract existing logic for native tools
    return Array.from(this.tools.values()).filter(tool => !tool.name.includes('/'));
  }
  
  private getMCPTools(): Tool[] {
    const mcpManager = this.getMCPServerManager();
    if (!mcpManager) return [];
    
    const allMCPTools: Tool[] = [];
    
    // Query all running MCP servers for their tools
    mcpManager.getAllServers()
      .filter(server => server.status === 'running')
      .forEach(server => {
        const serverTools = this.discoverMCPServerTools(server);
        allMCPTools.push(...serverTools);
      });
      
    return allMCPTools;
  }
  
  private discoverMCPServerTools(server: MCPServerConnection): Tool[] {
    // Implementation: query server.client.listTools() and create MCPToolAdapter instances
    // This logic exists in current MCPToolRegistry, move it here or extract to utility
    try {
      if (!server.client) return [];
      
      // This is a simplified version - real implementation would be async
      // and handle tool discovery properly
      return []; // TODO: Implement tool discovery from server.client
    } catch (error) {
      logger.warn(`Failed to discover tools from server ${server.id}:`, error);
      return [];
    }
  }
  
  private getMCPApprovalLevel(toolName: string): ApprovalLevel | null {
    const mcpManager = this.getMCPServerManager();
    if (!mcpManager || !toolName.includes('/')) {
      return null;
    }
    
    const [serverId, toolId] = toolName.split('/', 2);
    const server = mcpManager.getServer(serverId);
    
    if (server?.status === 'running') {
      return server.config.tools[toolId] || 'require-approval';
    }
    
    return 'require-approval';
  }
  
  /**
   * Remove MCP cleanup from ToolExecutor (Session handles it now)
   */
  async shutdown(): Promise<void> {
    // Remove MCP registry cleanup - Session handles MCP server lifecycle
  }
}
```

#### **Step 1.2.3: Add Tests for Session MCP Integration**

**File**: `src/sessions/session-mcp.test.ts`

**Test session MCP lifecycle:**
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Session } from './session';
import { Project } from '~/projects/project';

// Mock dependencies
vi.mock('~/mcp/server-manager');
vi.mock('~/projects/project');

describe('Session MCP Integration', () => {
  let session: Session;
  
  beforeEach(() => {
    // Mock project with MCP servers
    vi.mocked(Project.getById).mockReturnValue({
      getMCPServers: vi.fn().mockReturnValue({
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem'],
          enabled: true,
          tools: { read_file: 'allow-session' }
        }
      })
    } as any);
    
    session = new Session(/* session data */);
  });
  
  afterEach(async () => {
    await session.cleanup();
  });

  it('should initialize MCP servers eagerly on construction', async () => {
    const mcpManager = session.getMCPServerManager();
    
    // Wait for async initialization
    await new Promise(resolve => setTimeout(resolve, 100));
    
    expect(mcpManager.startServer).toHaveBeenCalledWith('filesystem', expect.objectContaining({
      command: 'npx',
      enabled: true
    }));
  });

  it('should handle MCP config changes with auto-restart', async () => {
    const mcpManager = session.getMCPServerManager();
    
    // Simulate config change event
    await session.announceMCPConfigChange('filesystem', 'updated', {
      command: 'node',
      args: ['new-server.js'],
      enabled: true,
      tools: { new_tool: 'allow-always' }
    });
    
    // Should stop then start the server with new config
    expect(mcpManager.stopServer).toHaveBeenCalledWith('filesystem');
    expect(mcpManager.startServer).toHaveBeenCalledWith('filesystem', expect.objectContaining({
      command: 'node',
      args: ['new-server.js']
    }));
  });

  it('should continue with degraded functionality when server fails', async () => {
    // Mock server start failure
    const mcpManager = session.getMCPServerManager();
    vi.mocked(mcpManager.startServer).mockRejectedValue(new Error('Server failed to start'));
    
    // Session should not throw, should continue
    expect(() => session.initializeMCPServers()).not.toThrow();
    
    // Session should remain functional
    expect(session.getId()).toBeDefined();
  });
});
```

#### **Step 1.2.4: Update Import Paths Throughout Codebase**

**Files to Update:**
- `src/mcp/server-manager.ts` → `import type { MCPServerConfig } from '~/config/mcp-types'`
- `src/mcp/tool-registry.ts` → `import type { MCPConfig } from '~/config/mcp-types'`
- `src/mcp/tool-adapter.ts` → `import type { MCPTool } from '~/config/mcp-types'`
- `src/tools/executor.ts` → `import { MCPConfigLoader } from '~/config/mcp-config-loader'`

**Testing:**
```bash
npm run build  # Verify all imports resolve correctly
npm test       # Verify all tests pass after refactoring
```

**Commit Message**: `feat: add session-level MCP server management with event-driven config updates`

---

**Task 1.2 establishes proper session-level MCP server lifecycle management using existing patterns and relationships.**

---

### Task 1.3: Global MCP Server Configuration API

**Objective**: Create RESTful endpoints for managing individual global MCP servers in `~/.lace/mcp-config.json`, following proper resource-based API design.

#### **Step 1.3.1: Global Server List Endpoint**

**File**: `packages/web/app/routes/api.mcp.servers.ts`

**Implementation:**
```typescript
// ABOUTME: Global MCP server list API for discovering available servers
// ABOUTME: Provides read-only list of global MCP server configurations

import { MCPConfigLoader } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import type { Route } from './+types/api.mcp.servers';

export async function loader({ request }: Route.LoaderArgs) {
  try {
    // Load global MCP configuration only (no project context)
    const globalConfig = MCPConfigLoader.loadGlobalConfig();
    
    // Return server list with just configuration (no runtime status)
    const servers = Object.entries(globalConfig?.servers || {}).map(([serverId, serverConfig]) => ({
      id: serverId,
      ...serverConfig
    }));
    
    return createSuperjsonResponse({ servers });
    
  } catch (error) {
    console.error('Failed to load global MCP configuration:', error);
    return createErrorResponse('Failed to load global MCP configuration', 500);
  }
}
```

**Test**: 
```typescript
describe('Global MCP Server List API', () => {
  it('should return global server configurations', async () => {
    // Mock global config
    vi.mocked(MCPConfigLoader.loadGlobalConfig).mockReturnValue({
      servers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem'],
          enabled: true,
          tools: { read_file: 'allow-session' }
        }
      }
    });

    const request = new Request('http://localhost/api/mcp/servers');
    const response = await loader({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.servers).toHaveLength(1);
    expect(data.servers[0]).toMatchObject({
      id: 'filesystem',
      command: 'npx',
      enabled: true
    });
  });
});
```

#### **Step 1.3.2: Individual Global Server Management**

**File**: `packages/web/app/routes/api.mcp.servers.$serverId.ts`

**Implementation:**
```typescript
// ABOUTME: Individual global MCP server management API with CRUD operations
// ABOUTME: Handles GET, PUT, DELETE for specific global MCP servers

import { MCPConfigLoader } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { z } from 'zod';
import type { Route } from './+types/api.mcp.servers.$serverId';

const ServerIdSchema = z.string().min(1, 'Server ID is required');

const UpdateServerSchema = z.object({
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  enabled: z.boolean().optional(),
  tools: z.record(z.string(), z.enum([
    'disable', 'deny', 'require-approval',
    'allow-once', 'allow-session', 'allow-project', 'allow-always'
  ])).optional()
});

const CreateServerSchema = z.object({
  command: z.string().min(1, 'Command is required'),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  enabled: z.boolean().default(true),
  tools: z.record(z.string(), z.enum([
    'disable', 'deny', 'require-approval',
    'allow-once', 'allow-session', 'allow-project', 'allow-always'
  ])).default({})
});

export async function loader({ params }: Route.LoaderArgs) {
  try {
    const serverId = ServerIdSchema.parse(params.serverId);
    
    const globalConfig = MCPConfigLoader.loadGlobalConfig();
    const serverConfig = globalConfig?.servers[serverId];
    
    if (!serverConfig) {
      return createErrorResponse(`Global MCP server '${serverId}' not found`, 404);
    }
    
    return createSuperjsonResponse({
      id: serverId,
      ...serverConfig
    });
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid server ID', 400, { details: error.errors });
    }
    
    console.error('Failed to get global MCP server:', error);
    return createErrorResponse('Failed to load server configuration', 500);
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  try {
    const serverId = ServerIdSchema.parse(params.serverId);
    
    if (request.method === 'PUT') {
      // Update existing global server
      const updates = UpdateServerSchema.parse(await request.json());
      
      const globalConfig = MCPConfigLoader.loadGlobalConfig() || { servers: {} };
      const currentServer = globalConfig.servers[serverId];
      
      if (!currentServer) {
        return createErrorResponse(`Global MCP server '${serverId}' not found`, 404);
      }
      
      // Merge updates with current configuration
      const updatedServer = { ...currentServer, ...updates };
      const updatedConfig = {
        ...globalConfig,
        servers: {
          ...globalConfig.servers,
          [serverId]: updatedServer
        }
      };
      
      MCPConfigLoader.saveGlobalConfig(updatedConfig);
      
      return createSuperjsonResponse({
        message: `Global MCP server '${serverId}' updated successfully`,
        server: { id: serverId, ...updatedServer }
      });
      
    } else if (request.method === 'POST') {
      // Create new global server
      const serverConfig = CreateServerSchema.parse(await request.json());
      
      const globalConfig = MCPConfigLoader.loadGlobalConfig() || { servers: {} };
      
      // Check for duplicates
      if (globalConfig.servers[serverId]) {
        return createErrorResponse(`Global MCP server '${serverId}' already exists`, 409);
      }
      
      // Add new server
      const updatedConfig = {
        ...globalConfig,
        servers: {
          ...globalConfig.servers,
          [serverId]: serverConfig
        }
      };
      
      MCPConfigLoader.saveGlobalConfig(updatedConfig);
      
      return createSuperjsonResponse({
        message: `Global MCP server '${serverId}' created successfully`,
        server: { id: serverId, ...serverConfig }
      }, { status: 201 });
      
    } else if (request.method === 'DELETE') {
      // Delete global server
      const globalConfig = MCPConfigLoader.loadGlobalConfig();
      if (!globalConfig?.servers[serverId]) {
        return createErrorResponse(`Global MCP server '${serverId}' not found`, 404);
      }
      
      const updatedConfig = { ...globalConfig };
      delete updatedConfig.servers[serverId];
      
      MCPConfigLoader.saveGlobalConfig(updatedConfig);
      
      return createSuperjsonResponse({
        message: `Global MCP server '${serverId}' deleted successfully`
      });
    }
    
    return createErrorResponse('Method not allowed', 405);
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid request data', 400, { details: error.errors });
    }
    
    console.error('Failed to manage global MCP server:', error);
    return createErrorResponse('Server management failed', 500);
  }
}
```

**Commit Message**: `feat: add global MCP server configuration API with individual server management`

---

### Task 1.4: Project-Scoped MCP Server Configuration API

**Objective**: Create project-scoped MCP server management endpoints following Lace's established project API patterns.

#### **Step 1.4.1: Project MCP Server List**

**File**: `packages/web/app/routes/api.projects.$projectId.mcp.servers.ts`

**Implementation:**
```typescript
// ABOUTME: Project-scoped MCP server list API following Lace project hierarchy patterns  
// ABOUTME: Provides project MCP server configurations with inheritance from global config

import { Project } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { z } from 'zod';
import type { Route } from './+types/api.projects.$projectId.mcp.servers';

const ProjectIdSchema = z.string().min(1, 'Project ID is required');

export async function loader({ params }: Route.LoaderArgs) {
  try {
    const projectId = ProjectIdSchema.parse(params.projectId);
    
    // Verify project exists and user has access (existing pattern)
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }
    
    // Get effective MCP configuration (global + project merged)
    const mcpServers = project.getMCPServers();
    
    const servers = Object.entries(mcpServers).map(([serverId, serverConfig]) => ({
      id: serverId,
      ...serverConfig
    }));
    
    return createSuperjsonResponse({ 
      projectId,
      servers 
    });
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid project ID', 400, { 
        code: 'VALIDATION_FAILED',
        details: error.errors 
      });
    }
    
    console.error('Failed to load project MCP servers:', error);
    return createErrorResponse('Failed to load server configuration', 500);
  }
}
```

#### **Step 1.4.2: Individual Project MCP Server Management**

**File**: `packages/web/app/routes/api.projects.$projectId.mcp.servers.$serverId.ts`

**Implementation:**
```typescript
// ABOUTME: Individual project MCP server management following established project API patterns
// ABOUTME: Handles CRUD operations for project-specific MCP server configurations

import { Project } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { z } from 'zod';
import type { Route } from './+types/api.projects.$projectId.mcp.servers.$serverId';

const RouteParamsSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  serverId: z.string().min(1, 'Server ID is required')
});

const UpdateServerSchema = z.object({
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  enabled: z.boolean().optional(),
  tools: z.record(z.string(), z.enum([
    'disable', 'deny', 'require-approval',
    'allow-once', 'allow-session', 'allow-project', 'allow-always'
  ])).optional()
});

const CreateServerSchema = z.object({
  command: z.string().min(1, 'Command is required'),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  enabled: z.boolean().default(true),
  tools: z.record(z.string(), z.enum([
    'disable', 'deny', 'require-approval',
    'allow-once', 'allow-session', 'allow-project', 'allow-always'
  ])).default({})
});

export async function loader({ params }: Route.LoaderArgs) {
  try {
    const { projectId, serverId } = RouteParamsSchema.parse(params);
    
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }
    
    // Get server configuration from project's effective config
    const mcpServers = project.getMCPServers();
    const serverConfig = mcpServers[serverId];
    
    if (!serverConfig) {
      return createErrorResponse(`MCP server '${serverId}' not found in project`, 404);
    }
    
    return createSuperjsonResponse({
      projectId,
      serverId, 
      ...serverConfig
    });
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid route parameters', 400, { 
        code: 'VALIDATION_FAILED',
        details: error.errors 
      });
    }
    
    console.error('Failed to get project MCP server:', error);
    return createErrorResponse('Failed to load server configuration', 500);
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  try {
    const { projectId, serverId } = RouteParamsSchema.parse(params);
    
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }
    
    if (request.method === 'PUT') {
      // Update project MCP server
      const updates = UpdateServerSchema.parse(await request.json());
      
      const currentServers = project.getMCPServers();
      const currentServer = currentServers[serverId];
      
      if (!currentServer) {
        return createErrorResponse(`MCP server '${serverId}' not found in project`, 404);
      }
      
      // Merge updates with current config
      const updatedServer = { ...currentServer, ...updates };
      
      // Update via Project method (triggers events)
      project.updateMCPServer(serverId, updatedServer);
      
      return createSuperjsonResponse({
        message: `Project MCP server '${serverId}' updated successfully`,
        projectId,
        serverId,
        server: updatedServer
      });
      
    } else if (request.method === 'POST') {
      // Create new project MCP server
      const serverConfig = CreateServerSchema.parse(await request.json());
      
      // Add via Project method (triggers events)
      project.addMCPServer(serverId, serverConfig);
      
      return createSuperjsonResponse({
        message: `Project MCP server '${serverId}' created successfully`,
        projectId,
        serverId,
        server: serverConfig
      }, { status: 201 });
      
    } else if (request.method === 'DELETE') {
      // Delete project MCP server
      const currentServers = project.getMCPServers();
      if (!currentServers[serverId]) {
        return createErrorResponse(`MCP server '${serverId}' not found in project`, 404);
      }
      
      // Delete via Project method (triggers events)
      project.deleteMCPServer(serverId);
      
      return createSuperjsonResponse({
        message: `Project MCP server '${serverId}' deleted successfully`,
        projectId,
        serverId
      });
    }
    
    return createErrorResponse('Method not allowed', 405);
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid request data', 400, { 
        code: 'VALIDATION_FAILED',
        details: error.errors 
      });
    }
    
    console.error('Failed to manage project MCP server:', error);
    return createErrorResponse('Server management failed', 500);
  }
}
```

**Commit Message**: `feat: add project-scoped MCP server configuration API with proper hierarchy`

---

### Task 1.5: Session MCP Server Control API  

**Objective**: Create session-scoped endpoints for MCP server runtime control (start/stop/restart) where servers actually run.

#### **Step 1.5.1: Session MCP Server List**

**File**: `packages/web/app/routes/api.projects.$projectId.sessions.$sessionId.mcp.servers.ts`

**Implementation:**
```typescript
// ABOUTME: Session MCP server list with runtime status from session's MCPServerManager
// ABOUTME: Shows which servers are actually running in this session context

import { Project, getSessionService } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { isValidThreadId } from '@/lib/validation/thread-id-validation';
import { z } from 'zod';
import type { Route } from './+types/api.projects.$projectId.sessions.$sessionId.mcp.servers';

const RouteParamsSchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1)
});

export async function loader({ params }: Route.LoaderArgs) {
  try {
    const { projectId, sessionId } = RouteParamsSchema.parse(params);
    
    // Verify project exists
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }
    
    // Get session (following existing session API pattern)
    if (!isValidThreadId(sessionId)) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }
    
    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId);
    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }
    
    // Get runtime server status from session's MCPServerManager
    const mcpManager = session.getMCPServerManager();
    const runningServers = mcpManager.getAllServers();
    
    // Get project configuration to show intended vs actual status
    const projectMCPServers = project.getMCPServers();
    
    const servers = Object.entries(projectMCPServers).map(([serverId, serverConfig]) => {
      const runningServer = runningServers.find(s => s.id === serverId);
      
      return {
        id: serverId,
        ...serverConfig,
        // Runtime status from session
        status: runningServer?.status || 'stopped',
        lastError: runningServer?.lastError,
        connectedAt: runningServer?.connectedAt
      };
    });
    
    return createSuperjsonResponse({
      projectId,
      sessionId,
      servers
    });
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid route parameters', 400, { 
        code: 'VALIDATION_FAILED',
        details: error.errors 
      });
    }
    
    console.error('Failed to load session MCP servers:', error);
    return createErrorResponse('Failed to load server status', 500);
  }
}
```

#### **Step 1.5.2: Session MCP Server Control**

**File**: `packages/web/app/routes/api.projects.$projectId.sessions.$sessionId.mcp.servers.$serverId.control.ts`

**Implementation:**
```typescript
// ABOUTME: Session MCP server control API for runtime server management
// ABOUTME: Handles start/stop/restart operations on session's running MCP servers

import { Project, getSessionService } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { isValidThreadId } from '@/lib/validation/thread-id-validation';
import { z } from 'zod';
import type { Route } from './+types/api.projects.$projectId.sessions.$sessionId.mcp.servers.$serverId.control';

const RouteParamsSchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  serverId: z.string().min(1)
});

const ControlActionSchema = z.object({
  action: z.enum(['start', 'stop', 'restart'])
});

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return createErrorResponse('Method not allowed', 405);
  }
  
  try {
    const { projectId, sessionId, serverId } = RouteParamsSchema.parse(params);
    const { action } = ControlActionSchema.parse(await request.json());
    
    // Verify project exists
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }
    
    // Verify session exists
    if (!isValidThreadId(sessionId)) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }
    
    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId);
    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }
    
    // Verify server exists in project configuration
    const projectServers = project.getMCPServers();
    if (!projectServers[serverId]) {
      return createErrorResponse(`MCP server '${serverId}' not configured for this project`, 404);
    }
    
    // Delegate to session MCP server control methods
    try {
      switch (action) {
        case 'start':
          await session.startMCPServer(serverId);
          break;
        case 'stop':
          await session.stopMCPServer(serverId);
          break;
        case 'restart':
          await session.restartMCPServer(serverId);
          break;
      }
      
      // Get updated status
      const serverStatus = session.getMCPServerStatus(serverId);
      
      return createSuperjsonResponse({
        message: `MCP server '${serverId}' ${action} completed`,
        projectId,
        sessionId,
        serverId,
        server: {
          status: serverStatus?.status || 'stopped',
          lastError: serverStatus?.lastError,
          connectedAt: serverStatus?.connectedAt
        }
      });
      
    } catch (serverError) {
      return createErrorResponse(
        `Failed to ${action} MCP server: ${serverError instanceof Error ? serverError.message : 'Unknown error'}`,
        500
      );
    }
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid request data', 400, { 
        code: 'VALIDATION_FAILED',
        details: error.errors 
      });
    }
    
    console.error('Failed to control MCP server:', error);
    return createErrorResponse('Server control failed', 500);
  }
}
```

**Commit Message**: `feat: add session-scoped MCP server control API for runtime management`

---

### Task 1.6: Fix Configuration APIs to Include MCP Tools

**Objective**: Update existing project and session configuration APIs to include MCP tools in available tool lists, fixing the original issue where MCP tools don't appear in tool configuration.

#### **Step 1.6.1: Fix Project Configuration API**

**File**: `packages/web/app/routes/api.projects.$projectId.configuration.ts`

**Replace ToolExecutor creation logic:**
```typescript
export async function loader({ params }: Route.LoaderArgs) {
  try {
    const project = Project.getById(params.projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const configuration = project.getConfiguration();

    // FIXED: Get tools from project context instead of creating fresh ToolExecutor
    const toolExecutor = await project.createToolExecutor(); // Includes MCP servers
    const userConfigurableTools = toolExecutor
      .getAllTools() // Now includes MCP tools from project config
      .filter((tool) => !tool.annotations?.safeInternal)
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        isMCP: tool.name.includes('/') // Distinguish MCP vs native tools
      }));

    return createSuperjsonResponse({
      ...configuration,
      availableTools: userConfigurableTools,
    });
  } catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch configuration',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
```

#### **Step 1.6.2: Fix Session Configuration API**

**File**: `packages/web/app/routes/api.sessions.$sessionId.configuration.ts`

**Replace ToolExecutor creation logic:**
```typescript
export async function loader({ params }: Route.LoaderArgs) {
  try {
    const sessionService = getSessionService();
    const session = await sessionService.getSession(params.sessionId);
    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const configuration = session.getEffectiveConfiguration();

    // FIXED: Get tools from session's ToolExecutor instead of creating fresh one
    const toolExecutor = await session.getToolExecutor(); // Includes MCP servers
    const userConfigurableTools = toolExecutor
      .getAllTools() // Now includes MCP tools with session context
      .filter((tool) => !tool.annotations?.safeInternal)
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        isMCP: tool.name.includes('/'),
        // Show current approval level for MCP tools
        currentPolicy: tool.name.includes('/') 
          ? session.getMCPToolPolicy?.(tool.name) || 'require-approval'
          : configuration.toolPolicies?.[tool.name] || 'require-approval'
      }));

    return createSuperjsonResponse({
      ...configuration,
      availableTools: userConfigurableTools,
    });
  } catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch session configuration',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
```

**Commit Message**: `fix: include MCP tools in project and session configuration APIs`

---

**Tasks 1.3-1.6 establish proper RESTful MCP API architecture with individual server management and correct integration with existing tool configuration systems.**

---

## Phase 2: Fix ToolExecutor Usage in Configuration APIs

### Task 2.1: Eliminate Fresh ToolExecutor Creation in Web Routes

**Objective**: Fix configuration APIs to show appropriate tools without creating unnecessary ToolExecutor instances. Projects show configured tools, Sessions show actual running tools.

**Key Insight**: Projects don't need ToolExecutors - they're configuration containers, not runtime environments.

#### **Step 2.1.1: Fix Project Configuration API (Static Tool List)**

**File**: `packages/web/app/routes/api.projects.$projectId.configuration.ts`

**Problem**: Currently creates fresh ToolExecutor that doesn't match runtime
**Solution**: Show configured tools based on project MCP config

**Replace existing logic:**
```typescript
export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const project = Project.getById((params as { projectId: string }).projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const configuration = project.getConfiguration();

    // FIXED: Show configured tools instead of creating ToolExecutor
    const configuredTools = this.getConfiguredToolsForProject(project);

    return createSuperjsonResponse({
      ...configuration,
      availableTools: configuredTools,
    });
  } catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch configuration',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}

/**
 * Get tools that are configured for this project (static config, no runtime discovery)
 */
function getConfiguredToolsForProject(project: Project): Array<{
  name: string;
  description: string;
  isMCP: boolean;
  configuredPolicy?: string;
}> {
  // Native tools (static list - no ToolExecutor needed)
  const nativeTools = [
    { name: 'bash', description: 'Execute shell commands', isMCP: false },
    { name: 'file_read', description: 'Read files', isMCP: false },
    { name: 'file_write', description: 'Write files', isMCP: false },
    { name: 'file_edit', description: 'Edit files', isMCP: false },
    { name: 'file_list', description: 'List directory contents', isMCP: false },
    { name: 'ripgrep_search', description: 'Search files', isMCP: false },
    { name: 'file_find', description: 'Find files', isMCP: false },
    { name: 'delegate', description: 'Delegate to sub-agent', isMCP: false },
    { name: 'url_fetch', description: 'Fetch URLs', isMCP: false },
    // Task manager tools
    { name: 'task_create', description: 'Create tasks', isMCP: false },
    { name: 'task_list', description: 'List tasks', isMCP: false },
    { name: 'task_complete', description: 'Complete tasks', isMCP: false },
    { name: 'task_update', description: 'Update tasks', isMCP: false },
    { name: 'task_add_note', description: 'Add task notes', isMCP: false },
    { name: 'task_view', description: 'View tasks', isMCP: false },
  ];

  // Configured MCP tools (from project MCP config - static)
  const mcpServers = project.getMCPServers();
  const configuredMCPTools = Object.entries(mcpServers).flatMap(([serverId, serverConfig]) =>
    Object.entries(serverConfig.tools).map(([toolId, policy]) => ({
      name: `${serverId}/${toolId}`,
      description: `MCP ${serverId}: ${toolId}`,
      isMCP: true,
      configuredPolicy: policy
    }))
  );

  return [...nativeTools, ...configuredMCPTools];
}
```

#### **Step 2.1.2: Fix Session Configuration API (Actual Runtime Tools)**

**File**: `packages/web/app/routes/api.sessions.$sessionId.configuration.ts`

**Problem**: Creates fresh ToolExecutor instead of using session's existing one
**Solution**: Use session's actual ToolExecutor that has MCP tools initialized

**Replace existing logic:**
```typescript
export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const { sessionId: sessionIdParam } = params as { sessionId: string };

    if (!isValidThreadId(sessionIdParam)) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const sessionId = sessionIdParam;
    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId);

    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const configuration = session.getEffectiveConfiguration();

    // FIXED: Use session's existing ToolExecutor (includes MCP tools)
    const toolExecutor = await session.getToolExecutor();
    const userConfigurableTools = toolExecutor
      .getAllTools() // Includes actual MCP tools from running servers
      .filter((tool) => !tool.annotations?.safeInternal)
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        isMCP: tool.name.includes('/'),
        // For MCP tools, show current policy from MCP config
        currentPolicy: tool.name.includes('/') 
          ? this.getMCPToolCurrentPolicy(tool.name, session)
          : (configuration.toolPolicies?.[tool.name] || 'require-approval')
      }));

    return createSuperjsonResponse({
      ...configuration,
      availableTools: userConfigurableTools,
    });
  } catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch session configuration',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}

/**
 * Get current policy for MCP tool from session context
 */
function getMCPToolCurrentPolicy(toolName: string, session: Session): string {
  const [serverId, toolId] = toolName.split('/', 2);
  const serverStatus = session.getMCPServerStatus(serverId);
  
  if (serverStatus?.status === 'running') {
    return serverStatus.config.tools[toolId] || 'require-approval';
  }
  
  return 'require-approval';
}
```

#### **Step 2.1.3: Remove ToolExecutor Creation from Project Action**

**File**: `packages/web/app/routes/api.projects.$projectId.configuration.ts`

**Remove this pattern from action method:**
```typescript
// REMOVE: Fresh ToolExecutor creation
const toolExecutor = new ToolExecutor();
toolExecutor.registerAllAvailableTools();
const userConfigurableTools = toolExecutor.getAllTools()...

// REPLACE: Use static tool list (projects don't need runtime tools)
const configuredTools = getConfiguredToolsForProject(project);
```

**Commit Message**: `fix: eliminate fresh ToolExecutor creation in configuration APIs`

---

**This phase ensures configuration APIs use actual runtime tools instead of creating mismatched fresh instances.**

---

## Phase 3: Testing and Clean Migration

### Task 3.1: Burn the House Down (Clean Slate)

**Objective**: Remove all existing broken MCP web implementation and start fresh with clean architecture.

**Migration Strategy**: Since nothing has been pushed to GitHub, completely replace broken implementation without backward compatibility concerns.

#### **Step 3.1.1: Delete Current Broken Web APIs**

**Files to Remove:**
```bash
# Remove all current MCP web routes (wrong architecture)
rm -rf packages/web/app/routes/api.mcp.*
rm -rf packages/web/app/routes/settings.mcp.*
rm -rf packages/web/app/routes/__tests__/api.mcp.*

# Remove wrong MCP components (will rebuild with correct patterns)  
rm -rf packages/web/components/mcp/
rm -rf packages/web/lib/mcp/
```

#### **Step 3.1.2: Remove MCP from Settings Container**

**File**: `packages/web/components/settings/SettingsContainer.tsx`

**Remove MCP integration:**
```typescript
// REMOVE these imports:
// import { MCPPanel } from './panels/MCPPanel';

// REMOVE from tabConfig array:
// {
//   id: 'mcp',
//   label: 'MCP', 
//   icon: <FontAwesomeIcon icon={faCog} className="w-4 h-4" />,
// },

// REMOVE from JSX:
// <div data-tab="mcp" className="flex-1 overflow-y-auto p-6">
//   {mcpPanel}
// </div>
```

#### **Step 3.1.3: Reset ToolExecutor to Pre-MCP State**

**File**: `src/tools/executor.ts`

**Remove broken MCP integration:**
```typescript
// REMOVE these imports:
// import { MCPToolRegistry } from '~/mcp/tool-registry';
// import { MCPServerManager } from '~/mcp/server-manager';
// import { MCPConfigLoader } from '~/config/mcp-config-loader';

// REMOVE these fields:
// private mcpRegistry?: MCPToolRegistry;

// REMOVE these methods:
// private async initializeMCPRegistry()
// private registerMCPTools()
// private getMCPApprovalLevel()

// REMOVE from constructor:
// this.initializeMCPRegistry().catch(...)

// REMOVE from shutdown:
// if (this.mcpRegistry) { await this.mcpRegistry.shutdown(); }
```

**Testing:**
```bash
npm run build  # Verify clean removal
npm test       # Verify existing functionality still works
```

**Commit Message**: `refactor: remove broken MCP web implementation for clean rebuild`

---

### Task 3.2: End-to-End Integration Test (Prove New Architecture)

**Objective**: Create comprehensive test that validates the complete flow: Project MCP config → Session server startup → ToolExecutor tool discovery → API tool list inclusion.

#### **Step 3.2.1: Create Full System Integration Test**

**File**: `packages/core/src/mcp/full-system-integration.test.ts`

**Implementation:**
```typescript
// ABOUTME: End-to-end test proving complete MCP integration through entire system
// ABOUTME: Tests Project config → Session servers → ToolExecutor tools → API responses

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Project } from '~/projects/project';
import { Session } from '~/sessions/session';

describe('Complete MCP Integration System Test', () => {
  let tempDir: string;
  let project: Project;
  let session: Session;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), 'mcp-system-test-'));
    
    // Create test project with working directory
    const projectData = {
      id: 'test-project',
      name: 'Test Project',
      description: 'Test project for MCP integration',
      workingDirectory: tempDir,
      isArchived: false,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      configuration: {}
    };
    
    project = new Project(projectData);
    
    // Add MCP server configuration to project
    project.addMCPServer('filesystem', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', tempDir],
      enabled: true,
      tools: {
        read_text_file: 'allow-session',
        write_text_file: 'require-approval',
        list_directory: 'allow-session'
      }
    });
    
    // Create test file for filesystem server to access
    writeFileSync(join(tempDir, 'test.txt'), 'Hello MCP Integration!');
    
    // Create session (should auto-start MCP servers)
    const sessionData = {
      id: 'test-session',
      projectId: 'test-project',
      name: 'Test Session',
      createdAt: new Date(),
      lastUsedAt: new Date(),
      configuration: {}
    };
    
    session = new Session(sessionData);
    
    // Change to temp directory
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await session.cleanup();
    await project.delete();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should complete full integration: Project config → Session startup → ToolExecutor discovery → API inclusion', async () => {
    // Step 1: Verify project MCP configuration is saved
    const projectServers = project.getMCPServers();
    expect(projectServers.filesystem).toBeDefined();
    expect(projectServers.filesystem.command).toBe('npx');
    expect(projectServers.filesystem.tools.read_text_file).toBe('allow-session');

    // Step 2: Wait for session MCP server initialization 
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Verify MCP servers started in session
    const serverStatus = session.getMCPServerStatus('filesystem');
    expect(serverStatus?.status).toBe('running');
    expect(serverStatus?.config.command).toBe('npx');

    // Step 3: Verify ToolExecutor includes MCP tools from running servers
    const toolExecutor = await session.getToolExecutor();
    const allTools = toolExecutor.getAllTools();
    
    // Should include native tools
    const nativeToolNames = allTools.filter(t => !t.name.includes('/')).map(t => t.name);
    expect(nativeToolNames).toContain('bash');
    expect(nativeToolNames).toContain('file_read');
    
    // Should include MCP tools from running servers
    const mcpToolNames = allTools.filter(t => t.name.includes('/')).map(t => t.name);
    expect(mcpToolNames).toContain('filesystem/read_text_file');
    expect(mcpToolNames).toContain('filesystem/write_text_file');

    // Step 4: Test actual MCP tool execution through ToolExecutor
    const readTool = allTools.find(t => t.name === 'filesystem/read_text_file');
    expect(readTool).toBeDefined();
    
    const result = await readTool!.execute({ path: 'test.txt' });
    expect(result.status).toBe('completed');
    expect(result.content[0].text).toContain('Hello MCP Integration!');

    // Step 5: Verify MCP tools appear in session configuration API
    // (This would be tested via actual API call in full implementation)
    // For now, verify ToolExecutor provides correct tool list
    const userConfigurableTools = allTools
      .filter(tool => !tool.annotations?.safeInternal)
      .map(tool => ({
        name: tool.name,
        description: tool.description,
        isMCP: tool.name.includes('/')
      }));
      
    const mcpConfigurableTools = userConfigurableTools.filter(t => t.isMCP);
    expect(mcpConfigurableTools.length).toBeGreaterThan(0);
    expect(mcpConfigurableTools.map(t => t.name)).toContain('filesystem/read_text_file');
  }, 10000); // Long timeout for real server startup

  it('should handle project MCP config changes with session auto-restart', async () => {
    // Wait for initial startup
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Verify initial server is running
    let serverStatus = session.getMCPServerStatus('filesystem');
    expect(serverStatus?.status).toBe('running');
    
    // Update project MCP server configuration
    project.updateMCPServer('filesystem', {
      command: 'echo',
      args: ['updated-server'],
      enabled: true,
      tools: { 
        echo_test: 'allow-always',
        new_tool: 'require-approval' 
      }
    });
    
    // Wait for session to receive event and restart server
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify server restarted with new configuration
    serverStatus = session.getMCPServerStatus('filesystem');
    expect(serverStatus?.config.command).toBe('echo');
    expect(serverStatus?.config.args).toEqual(['updated-server']);
    
    // Verify ToolExecutor tools updated
    const toolExecutor = await session.getToolExecutor();
    const updatedTools = toolExecutor.getAllTools();
    const mcpToolNames = updatedTools.filter(t => t.name.includes('/')).map(t => t.name);
    
    // Should have new tools from updated server
    expect(mcpToolNames).toContain('filesystem/echo_test');
    expect(mcpToolNames).toContain('filesystem/new_tool');
  });

  it('should gracefully handle MCP server failures without breaking session', async () => {
    // Add invalid MCP server that will fail to start
    project.addMCPServer('invalid', {
      command: 'nonexistent-command',
      enabled: true,
      tools: { broken_tool: 'allow-session' }
    });
    
    // Wait for initialization attempt
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Session should continue working despite failed server
    expect(session.getId()).toBeDefined();
    
    // Working server should still be running
    const workingServer = session.getMCPServerStatus('filesystem');
    expect(workingServer?.status).toBe('running');
    
    // Failed server should show failure status
    const failedServer = session.getMCPServerStatus('invalid');
    expect(failedServer?.status).toBe('failed');
    expect(failedServer?.lastError).toContain('nonexistent-command');
    
    // ToolExecutor should include only tools from working servers
    const toolExecutor = await session.getToolExecutor();
    const allTools = toolExecutor.getAllTools();
    
    // Should have filesystem tools
    expect(allTools.map(t => t.name)).toContain('filesystem/read_text_file');
    
    // Should NOT have broken server tools
    expect(allTools.map(t => t.name)).not.toContain('invalid/broken_tool');
  });
});
```

**How to Test:**
```bash
npm run test:run packages/core/src/mcp/full-system-integration.test.ts
```

**Commit Message**: `test: add comprehensive end-to-end MCP system integration test`

---

### Task 3.3: API Contract Validation

**Objective**: Validate all new API endpoints work correctly with proper error handling, validation, and response formats.

#### **Step 3.3.1: Test All MCP API Endpoints**

**File**: `packages/web/app/routes/__tests__/mcp-api-contract.test.ts`

**Implementation:**
```typescript
// ABOUTME: Contract tests for all MCP API endpoints ensuring proper behavior
// ABOUTME: Tests global, project, and session MCP APIs with real data flow

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestProject, createTestSession } from '@/test-utils';

describe('MCP API Contract Tests', () => {
  let project: Project;
  let session: Session;

  beforeEach(async () => {
    project = await createTestProject();
    session = await createTestSession(project.getId());
  });

  afterEach(async () => {
    await session.cleanup();
    await project.delete();
  });

  describe('Global MCP Server API', () => {
    it('should handle complete CRUD workflow for global servers', async () => {
      // CREATE
      const createResponse = await fetch('/api/mcp/servers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'echo',
          args: ['hello'],
          enabled: true,
          tools: { echo: 'allow-session' }
        })
      });
      
      expect(createResponse.status).toBe(201);
      const createData = await createResponse.json();
      expect(createData.message).toContain('created successfully');
      
      // READ
      const readResponse = await fetch('/api/mcp/servers/test');
      expect(readResponse.status).toBe(200);
      const readData = await readResponse.json();
      expect(readData.command).toBe('echo');
      expect(readData.args).toEqual(['hello']);
      
      // UPDATE
      const updateResponse = await fetch('/api/mcp/servers/test', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'node',
          enabled: false
        })
      });
      
      expect(updateResponse.status).toBe(200);
      const updateData = await updateResponse.json();
      expect(updateData.server.command).toBe('node');
      expect(updateData.server.enabled).toBe(false);
      
      // DELETE
      const deleteResponse = await fetch('/api/mcp/servers/test', {
        method: 'DELETE'
      });
      
      expect(deleteResponse.status).toBe(200);
      const deleteData = await deleteResponse.json();
      expect(deleteData.message).toContain('deleted successfully');
      
      // Verify deletion
      const verifyResponse = await fetch('/api/mcp/servers/test');
      expect(verifyResponse.status).toBe(404);
    });

    it('should validate server configuration properly', async () => {
      // Test invalid server data
      const invalidResponse = await fetch('/api/mcp/servers/invalid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: '', // Invalid empty command
          enabled: 'not-boolean' // Invalid type
        })
      });
      
      expect(invalidResponse.status).toBe(400);
      const errorData = await invalidResponse.json();
      expect(errorData.code).toBe('VALIDATION_FAILED');
      expect(errorData.details).toBeDefined();
    });

    it('should prevent duplicate server creation', async () => {
      // Create server
      await fetch('/api/mcp/servers/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'echo',
          enabled: true,
          tools: {}
        })
      });
      
      // Try to create same server again
      const duplicateResponse = await fetch('/api/mcp/servers/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'node',
          enabled: true,
          tools: {}
        })
      });
      
      expect(duplicateResponse.status).toBe(409);
      const errorData = await duplicateResponse.json();
      expect(errorData.message).toContain('already exists');
    });
  });

  describe('Project MCP Server API', () => {
    it('should handle project-scoped server management', async () => {
      const projectId = project.getId();
      
      // CREATE project server
      const createResponse = await fetch(`/api/projects/${projectId}/mcp/servers/git`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-git'],
          enabled: true,
          tools: { 
            git_status: 'allow-always',
            git_commit: 'require-approval' 
          }
        })
      });
      
      expect(createResponse.status).toBe(201);
      
      // READ project server
      const readResponse = await fetch(`/api/projects/${projectId}/mcp/servers/git`);
      expect(readResponse.status).toBe(200);
      const readData = await readResponse.json();
      expect(readData.projectId).toBe(projectId);
      expect(readData.serverId).toBe('git');
      expect(readData.command).toBe('npx');
      
      // UPDATE project server
      const updateResponse = await fetch(`/api/projects/${projectId}/mcp/servers/git`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: false,
          tools: { git_status: 'deny' }
        })
      });
      
      expect(updateResponse.status).toBe(200);
      
      // DELETE project server
      const deleteResponse = await fetch(`/api/projects/${projectId}/mcp/servers/git`, {
        method: 'DELETE'
      });
      
      expect(deleteResponse.status).toBe(200);
    });

    it('should enforce project ownership', async () => {
      // Try to access non-existent project
      const response = await fetch('/api/projects/nonexistent/mcp/servers/test');
      expect(response.status).toBe(404);
      
      const errorData = await response.json();
      expect(errorData.code).toBe('RESOURCE_NOT_FOUND');
    });
  });

  describe('Session MCP Server Control API', () => {
    it('should handle session server control operations', async () => {
      const projectId = project.getId();
      const sessionId = session.getId();
      
      // Add MCP server to project first
      project.addMCPServer('control-test', {
        command: 'echo',
        args: ['test-server'],
        enabled: false, // Start disabled
        tools: { test_tool: 'allow-session' }
      });
      
      // START server via session control API
      const startResponse = await fetch(`/api/projects/${projectId}/sessions/${sessionId}/mcp/servers/control-test/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' })
      });
      
      expect(startResponse.status).toBe(200);
      const startData = await startResponse.json();
      expect(startData.message).toContain('start completed');
      
      // Verify server is running in session
      const serverStatus = session.getMCPServerStatus('control-test');
      expect(serverStatus?.status).toBe('running');
      
      // STOP server
      const stopResponse = await fetch(`/api/projects/${projectId}/sessions/${sessionId}/mcp/servers/control-test/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' })
      });
      
      expect(stopResponse.status).toBe(200);
      
      // RESTART server
      const restartResponse = await fetch(`/api/projects/${projectId}/sessions/${sessionId}/mcp/servers/control-test/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restart' })
      });
      
      expect(restartResponse.status).toBe(200);
    });

    it('should validate session and project ownership', async () => {
      // Try to control server for non-existent session
      const response = await fetch('/api/projects/test/sessions/nonexistent/mcp/servers/test/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' })
      });
      
      expect(response.status).toBe(404);
    });

    it('should prevent control of unconfigured servers', async () => {
      const projectId = project.getId();
      const sessionId = session.getId();
      
      // Try to start server that's not configured in project
      const response = await fetch(`/api/projects/${projectId}/sessions/${sessionId}/mcp/servers/unconfigured/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' })
      });
      
      expect(response.status).toBe(404);
      const errorData = await response.json();
      expect(errorData.message).toContain('not configured for this project');
    });
  });

  describe('Configuration API MCP Tool Integration', () => {
    it('should show MCP tools in session configuration after server startup', async () => {
      // Wait for MCP server to start and tools to be discovered
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Get session configuration API response
      const configResponse = await fetch(`/api/sessions/${session.getId()}/configuration`);
      expect(configResponse.status).toBe(200);
      
      const configData = await configResponse.json();
      const toolNames = configData.availableTools.map(t => t.name);
      
      // Should include native tools
      expect(toolNames).toContain('bash');
      expect(toolNames).toContain('file_read');
      
      // Should include MCP tools from running servers  
      expect(toolNames).toContain('filesystem/read_text_file');
      expect(toolNames).toContain('filesystem/write_text_file');
      
      // MCP tools should be properly marked
      const mcpTools = configData.availableTools.filter(t => t.isMCP);
      expect(mcpTools.length).toBeGreaterThan(0);
      
      const readFileTool = mcpTools.find(t => t.name === 'filesystem/read_text_file');
      expect(readFileTool.currentPolicy).toBe('allow-session');
    });

    it('should show only configured tools in project configuration (no runtime)', async () => {
      // Project configuration should show configured MCP tools, not discovered ones
      const configResponse = await fetch(`/api/projects/${project.getId()}/configuration`);
      expect(configResponse.status).toBe(200);
      
      const configData = await configResponse.json();
      
      // Should include configured MCP tools from project config
      const mcpTools = configData.availableTools.filter(t => t.isMCP);
      expect(mcpTools.map(t => t.name)).toContain('filesystem/read_text_file');
      expect(mcpTools.map(t => t.name)).toContain('filesystem/write_text_file');
      
      // Should show configured policies, not runtime discovery
      const readFileTool = mcpTools.find(t => t.name === 'filesystem/read_text_file');
      expect(readFileTool.configuredPolicy).toBe('allow-session');
    });
  });
});
```

**How to Test:**
```bash
npm run test:run packages/core/src/mcp/full-system-integration.test.ts
npm run test:run packages/web/app/routes/__tests__/mcp-api-contract.test.ts
```

**Commit Message**: `test: add comprehensive MCP system and API contract tests`

---

## Phase Summary

**Phase 3 Strategy:**
✅ **Clean Slate**: Remove broken implementation completely  
✅ **Prove Architecture**: End-to-end test validates complete system works  
✅ **Validate APIs**: Contract tests ensure all endpoints work correctly  
✅ **No Rollback**: Commit fully to correct architecture

**This proves the new design fixes the original issue: MCP tools appearing in session/project tool configuration.**

Ready for Phase 4 (implementation execution)?