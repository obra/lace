# MCP Tool Discovery & Caching Implementation Plan

## Problem Context

**What we're fixing**: Configuration APIs (`/api/projects/$projectId/configuration` and `/api/sessions/$sessionId/configuration`) are extremely slow (5-15 seconds) because they create fresh ToolExecutor instances just to list available tools.

**Current broken flow**:
```
User opens settings → API call → project.createToolExecutor() → MCPServerManager creation → 
MCP server startup → Tool discovery → 15 second delay → Show tools
```

**Root cause**: This expensive operation happens on EVERY configuration API call.

**Goal**: Fast configuration APIs via cached tool discovery.

---

## Solution: Simple Async Discovery with ToolCatalog

### Architecture Overview

1. **Schema Extension**: Add discovery cache fields to `MCPServerConfig`
2. **ToolCatalog Class**: Single class with static methods for tool enumeration and discovery
3. **Async Discovery**: Discover tools once when server added, cache results
4. **Fast APIs**: Configuration endpoints read from cache (sub-millisecond)

**New flow**:
```
Server addition: User adds server → ToolCatalog.discoverAndCacheTools() → background discovery → cache results
Configuration API: User opens settings → ToolCatalog.getAvailableTools() → read cache → immediate response
```

---

## Implementation Tasks

### Task 1: Extend MCP Configuration Schema (20 min)

**Objective**: Add discovery cache fields to existing `MCPServerConfig` without breaking existing functionality.

**Files to modify**:
- `packages/core/src/config/mcp-types.ts`

**Step 1: Write failing test**
```typescript
// In packages/core/src/config/__tests__/mcp-types.test.ts (create if doesn't exist)
import { describe, it, expect } from 'vitest';
import { MCPServerConfigSchema } from '../mcp-types';

describe('MCPServerConfig Discovery Fields', () => {
  it('should accept discovery cache fields', () => {
    const configWithDiscovery = {
      command: 'npx',
      args: ['test-server'],
      enabled: true,
      tools: { test_tool: 'allow' },
      // NEW fields
      discoveredTools: [{ name: 'test_tool', description: 'Test tool' }],
      discoveryStatus: 'success',
      lastDiscovery: '2023-01-01T00:00:00Z'
    };
    
    // This should not throw
    expect(() => MCPServerConfigSchema.parse(configWithDiscovery)).not.toThrow();
  });
  
  it('should work without discovery fields (backward compatibility)', () => {
    const minimalConfig = {
      command: 'npx',
      enabled: true,
      tools: {}
    };
    
    expect(() => MCPServerConfigSchema.parse(minimalConfig)).not.toThrow();
  });
});
```

**Step 2: Run test** - should fail (fields don't exist yet)

**Step 3: Add fields to MCPServerConfig interface**
```typescript
// In packages/core/src/config/mcp-types.ts
export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  enabled: boolean;
  tools: Record<string, ToolPolicy>;
  
  // NEW: Tool discovery cache
  discoveredTools?: DiscoveredTool[];
  lastDiscovery?: string; // ISO timestamp
  discoveryError?: string;
  discoveryStatus?: 'never' | 'discovering' | 'success' | 'failed';
}

export interface DiscoveredTool {
  name: string;
  description?: string;
}
```

**Step 4: Update Zod schema if present**
```typescript
// Add to MCPServerConfigSchema if using Zod validation
const DiscoveredToolSchema = z.object({
  name: z.string(),
  description: z.string().optional()
});

const MCPServerConfigSchema = z.object({
  // existing fields...
  discoveredTools: z.array(DiscoveredToolSchema).optional(),
  lastDiscovery: z.string().optional(),
  discoveryError: z.string().optional(),
  discoveryStatus: z.enum(['never', 'discovering', 'success', 'failed']).optional()
});
```

**Step 5: Run test** - should pass

**Step 6: Check no regressions** - run all existing MCP config tests

**Commit**: `feat: add tool discovery cache fields to MCPServerConfig schema`

---

### Task 2: Create ToolCatalog Class (45 min)

**Objective**: Single class for fast tool enumeration and async discovery.

**Files to create**:
- `packages/core/src/tools/tool-catalog.ts`
- `packages/core/src/tools/__tests__/tool-catalog.test.ts`

**Files to study**:
- `packages/core/src/projects/project.ts` - understand `getMCPServers()` method
- `packages/core/src/mcp/server-manager.ts` - understand how to start/stop servers
- `packages/core/src/config/mcp-config-loader.ts` - understand config file updates

**Step 1: Write comprehensive failing tests**
```typescript
// packages/core/src/tools/__tests__/tool-catalog.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolCatalog } from '../tool-catalog';
import type { Project } from '~/projects/project';
import type { MCPServerConfig } from '~/config/mcp-types';

// Mock dependencies
const mockProject = {
  getMCPServers: vi.fn(),
  getWorkingDirectory: vi.fn().mockReturnValue('/test/project')
};

const mockServerManager = {
  startServer: vi.fn(),
  getClient: vi.fn(),
  cleanup: vi.fn()
};

const mockClient = {
  listTools: vi.fn()
};

vi.mock('~/mcp/server-manager', () => ({
  MCPServerManager: vi.fn(() => mockServerManager)
}));

vi.mock('~/config/mcp-config-loader', () => ({
  MCPConfigLoader: {
    updateServerConfig: vi.fn()
  }
}));

describe('ToolCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServerManager.getClient.mockReturnValue(mockClient);
  });

  describe('getAvailableTools', () => {
    it('should return native tools for projects without MCP servers', () => {
      mockProject.getMCPServers.mockReturnValue({});
      
      const tools = ToolCatalog.getAvailableTools(mockProject as any);
      
      expect(tools).toContain('bash');
      expect(tools).toContain('file_read');
      expect(tools).toContain('task_create');
      expect(tools.length).toBe(15); // All native tools
    });
    
    it('should include configured MCP tools from cache', () => {
      mockProject.getMCPServers.mockReturnValue({
        filesystem: {
          enabled: true,
          tools: { read_file: 'allow', write_file: 'deny' },
          discoveredTools: [
            { name: 'read_file', description: 'Read files' },
            { name: 'write_file', description: 'Write files' }
          ],
          discoveryStatus: 'success'
        }
      });
      
      const tools = ToolCatalog.getAvailableTools(mockProject as any);
      
      expect(tools).toContain('filesystem/read_file');
      expect(tools).toContain('filesystem/write_file');
    });
    
    it('should fallback to configured tool policies when no discovery cache', () => {
      mockProject.getMCPServers.mockReturnValue({
        git: {
          enabled: true,
          tools: { git_status: 'allow', git_commit: 'require-approval' },
          // No discoveredTools - should use keys from tools config
        }
      });
      
      const tools = ToolCatalog.getAvailableTools(mockProject as any);
      
      expect(tools).toContain('git/git_status');
      expect(tools).toContain('git/git_commit');
    });
    
    it('should exclude disabled MCP servers', () => {
      mockProject.getMCPServers.mockReturnValue({
        disabled_server: {
          enabled: false,
          tools: { some_tool: 'allow' }
        }
      });
      
      const tools = ToolCatalog.getAvailableTools(mockProject as any);
      
      expect(tools).not.toContain('disabled_server/some_tool');
    });
  });

  describe('discoverAndCacheTools', () => {
    const testConfig: MCPServerConfig = {
      command: 'npx',
      args: ['test-server'],
      enabled: true,
      tools: {}
    };

    afterEach(async () => {
      // Wait for background discovery to complete
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    it('should update config with discovering status immediately', async () => {
      const { MCPConfigLoader } = vi.mocked(await import('~/config/mcp-config-loader'));
      
      await ToolCatalog.discoverAndCacheTools('test-server', testConfig, '/test/project');
      
      expect(MCPConfigLoader.updateServerConfig).toHaveBeenCalledWith(
        'test-server',
        expect.objectContaining({
          discoveryStatus: 'discovering',
          lastDiscovery: expect.any(String)
        }),
        '/test/project'
      );
    });

    it('should not block caller during discovery', async () => {
      // Mock slow discovery
      mockClient.listTools.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({ tools: [] }), 100))
      );
      
      const startTime = Date.now();
      await ToolCatalog.discoverAndCacheTools('slow-server', testConfig);
      const elapsed = Date.now() - startTime;
      
      // Should return immediately, not wait for discovery
      expect(elapsed).toBeLessThan(50);
    });

    it('should cache discovered tools on success', async () => {
      mockClient.listTools.mockResolvedValue({
        tools: [
          { name: 'read_file', description: 'Read files' },
          { name: 'write_file', description: 'Write files' }
        ]
      });
      
      await ToolCatalog.discoverAndCacheTools('filesystem', testConfig, '/test/project');
      
      // Wait for background discovery
      await new Promise(resolve => setTimeout(resolve, 20));
      
      const { MCPConfigLoader } = vi.mocked(await import('~/config/mcp-config-loader'));
      expect(MCPConfigLoader.updateServerConfig).toHaveBeenLastCalledWith(
        'filesystem',
        expect.objectContaining({
          discoveredTools: [
            { name: 'read_file', description: 'Read files' },
            { name: 'write_file', description: 'Write files' }
          ],
          discoveryStatus: 'success'
        }),
        '/test/project'
      );
    });

    it('should cache error status on discovery failure', async () => {
      mockClient.listTools.mockRejectedValue(new Error('Connection failed'));
      
      await ToolCatalog.discoverAndCacheTools('broken-server', testConfig);
      
      // Wait for background discovery
      await new Promise(resolve => setTimeout(resolve, 20));
      
      const { MCPConfigLoader } = vi.mocked(await import('~/config/mcp-config-loader'));
      expect(MCPConfigLoader.updateServerConfig).toHaveBeenLastCalledWith(
        'broken-server',
        expect.objectContaining({
          discoveryStatus: 'failed',
          discoveryError: 'Connection failed'
        }),
        undefined
      );
    });

    it('should handle server startup failure', async () => {
      mockServerManager.startServer.mockRejectedValue(new Error('Startup failed'));
      
      await ToolCatalog.discoverAndCacheTools('broken-server', testConfig);
      
      // Wait for background discovery
      await new Promise(resolve => setTimeout(resolve, 20));
      
      const { MCPConfigLoader } = vi.mocked(await import('~/config/mcp-config-loader'));
      expect(MCPConfigLoader.updateServerConfig).toHaveBeenLastCalledWith(
        'broken-server',
        expect.objectContaining({
          discoveryStatus: 'failed',
          discoveryError: 'Startup failed'
        }),
        undefined
      );
    });
  });
});
```

**Step 2: Run tests** - should fail (class doesn't exist)

**Step 3: Implement ToolCatalog**
```typescript
// packages/core/src/tools/tool-catalog.ts
import { MCPServerManager } from '~/mcp/server-manager';
import { MCPConfigLoader } from '~/config/mcp-config-loader';
import { logger } from '~/utils/logger';
import type { Project } from '~/projects/project';
import type { MCPServerConfig, DiscoveredTool } from '~/config/mcp-types';

export class ToolCatalog {
  /**
   * Get all available tools for project (native + cached MCP)
   * FAST: Just reads cached data, no ToolExecutor creation
   */
  static getAvailableTools(project: Project): string[] {
    const nativeTools = [
      'bash',
      'file_read', 
      'file_write',
      'file_edit',
      'file_list',
      'ripgrep_search',
      'file_find',
      'delegate',
      'url_fetch',
      'task_create',
      'task_list',
      'task_complete',
      'task_update',
      'task_add_note',
      'task_view'
    ];
    
    // Get MCP tools from discovery cache
    const mcpServers = project.getMCPServers();
    const mcpTools = Object.entries(mcpServers)
      .filter(([_, config]) => config.enabled)
      .flatMap(([serverId, config]) => {
        // Use discovered tools if available
        if (config.discoveredTools && config.discoveryStatus === 'success') {
          return config.discoveredTools.map(tool => `${serverId}/${tool.name}`);
        }
        
        // Fallback to configured tool policies (shows something while discovering)
        return Object.keys(config.tools).map(toolName => `${serverId}/${toolName}`);
      });
    
    return [...nativeTools, ...mcpTools];
  }
  
  /**
   * Discover MCP server tools and cache results (async, non-blocking)
   */
  static async discoverAndCacheTools(
    serverId: string, 
    config: MCPServerConfig, 
    projectDir?: string
  ): Promise<void> {
    // Update config immediately with discovering status
    const pendingConfig = {
      ...config,
      discoveryStatus: 'discovering' as const,
      lastDiscovery: new Date().toISOString()
    };
    
    MCPConfigLoader.updateServerConfig(serverId, pendingConfig, projectDir);
    
    // Start background discovery (don't await)
    void this.performBackgroundDiscovery(serverId, config, projectDir);
  }
  
  /**
   * Background discovery implementation
   */
  private static async performBackgroundDiscovery(
    serverId: string,
    config: MCPServerConfig,
    projectDir?: string
  ): Promise<void> {
    const tempManager = new MCPServerManager();
    
    try {
      logger.debug(`Starting tool discovery for ${serverId}`);
      
      // Start temporary server for discovery
      await tempManager.startServer(serverId, config);
      
      // Discover available tools
      const client = tempManager.getClient(serverId);
      const response = await client.listTools();
      
      const discoveredTools: DiscoveredTool[] = response.tools.map(tool => ({
        name: tool.name,
        description: tool.description
      }));
      
      // Update cache with success
      const successConfig = {
        ...config,
        discoveredTools,
        discoveryStatus: 'success' as const,
        lastDiscovery: new Date().toISOString(),
        discoveryError: undefined
      };
      
      MCPConfigLoader.updateServerConfig(serverId, successConfig, projectDir);
      
      logger.info(`Discovered ${discoveredTools.length} tools for ${serverId}`);
      
    } catch (error) {
      // Update cache with failure
      const failureConfig = {
        ...config,
        discoveryStatus: 'failed' as const,
        discoveryError: error instanceof Error ? error.message : 'Unknown error',
        lastDiscovery: new Date().toISOString()
      };
      
      MCPConfigLoader.updateServerConfig(serverId, failureConfig, projectDir);
      
      logger.warn(`Tool discovery failed for ${serverId}:`, error);
    } finally {
      // Always cleanup temporary server
      await tempManager.cleanup();
    }
  }
}
```

**Step 4: Run tests** - should pass

**Step 5: Add export to tools index**
```typescript
// Add to packages/core/src/tools/index.ts
export { ToolCatalog } from './tool-catalog';
```

**Commit**: `feat: add ToolCatalog class with async discovery and fast tool enumeration`

---

### Task 3: Update Project.addMCPServer to Use Async Discovery (20 min)

**Objective**: Replace expensive tool creation with fast async discovery.

**Files to modify**:
- `packages/core/src/projects/project.ts`

**Step 1: Find current addMCPServer method**
- Look for existing implementation in `packages/core/src/projects/project.ts`
- Note: It likely has synchronous tool discovery or ToolExecutor creation

**Step 2: Write test for new async behavior**
```typescript
// Add to packages/core/src/projects/__tests__/project.test.ts
import { ToolCatalog } from '~/tools/tool-catalog';

describe('Project MCP Server Management', () => {
  it('should start async discovery when adding MCP server', async () => {
    const discoverSpy = vi.spyOn(ToolCatalog, 'discoverAndCacheTools');
    
    const project = Project.create({ name: 'Test Project' });
    
    await project.addMCPServer('filesystem', {
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem'],
      enabled: true,
      tools: {}
    });
    
    expect(discoverSpy).toHaveBeenCalledWith(
      'filesystem',
      expect.objectContaining({ command: 'npx' }),
      project.getWorkingDirectory()
    );
  });
  
  it('should not block on tool discovery', async () => {
    // Mock slow discovery
    vi.spyOn(ToolCatalog, 'discoverAndCacheTools').mockImplementation(() => 
      new Promise(resolve => setTimeout(resolve, 100))
    );
    
    const startTime = Date.now();
    
    const project = Project.create({ name: 'Test Project' });
    await project.addMCPServer('slow-server', {
      command: 'slow-command',
      enabled: true,
      tools: {}
    });
    
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(150); // Should not wait for full discovery
  });
});
```

**Step 3: Run test** - should fail

**Step 4: Update Project.addMCPServer method**
```typescript
// In packages/core/src/projects/project.ts
import { ToolCatalog } from '~/tools/tool-catalog';

async addMCPServer(serverId: string, serverConfig: MCPServerConfig): Promise<void> {
  // Check for duplicates
  const existingServers = this.getMCPServers();
  if (existingServers[serverId]) {
    throw new Error(`MCP server '${serverId}' already exists in project`);
  }

  // Start async tool discovery (non-blocking)
  await ToolCatalog.discoverAndCacheTools(serverId, serverConfig, this.getWorkingDirectory());

  // Notify sessions immediately
  this.notifySessionsMCPChange(serverId, 'created', serverConfig);
}
```

**Step 5: Remove old createToolExecutor method** if it exists and is no longer used

**Step 6: Run tests** - should pass

**Commit**: `feat: use async tool discovery in Project.addMCPServer for non-blocking server addition`

---

### Task 4: Update Configuration APIs to Use ToolCatalog (30 min)

**Objective**: Replace expensive ToolExecutor creation with fast ToolCatalog reads.

**Files to modify**:
- `packages/web/app/routes/api.projects.$projectId.configuration.ts` 
- `packages/web/app/routes/api.sessions.$sessionId.configuration.ts`

**Step 1: Study existing configuration API tests**
- Look at `packages/web/app/routes/__tests__/api.projects.$projectId.configuration.test.ts`
- Check what format `availableTools` field should have (likely string array)
- Note: Tests expect tools like `['file-read', 'file-write', 'bash']`

**Step 2: Update project configuration API**
```typescript
// In packages/web/app/routes/api.projects.$projectId.configuration.ts
import { Project, ProviderRegistry } from '@/lib/server/lace-imports';
import { ToolCatalog } from '@/lib/server/lace-imports'; // Add this import

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const project = Project.getById((params as { projectId: string }).projectId);

    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const configuration = project.getConfiguration();

    // FAST: Read cached tools instead of creating ToolExecutor
    const availableTools = ToolCatalog.getAvailableTools(project);

    return createSuperjsonResponse({
      configuration: {
        ...configuration,
        availableTools
      }
    });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch configuration',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
```

**Step 3: Update action function** in same file (PUT method) the same way

**Step 4: Update session configuration API** similarly
```typescript
// In packages/web/app/routes/api.sessions.$sessionId.configuration.ts
import { ToolCatalog } from '@/lib/server/lace-imports'; // Add this import

// In loader function, replace ToolExecutor creation with:
const availableTools = ToolCatalog.getAvailableTools(session.getProject());
```

**Step 5: Add ToolCatalog export** to web package imports
```typescript
// Add to packages/web/lib/server/lace-imports.ts
export { ToolCatalog } from '../../../../core/src/tools/tool-catalog';
```

**Step 6: Run configuration API tests** - should pass

**Step 7: Performance test** - API calls should be under 100ms

**Commit**: `feat: use ToolCatalog in configuration APIs for fast tool enumeration`

---

### Task 5: Add Session Cache Refresh (25 min)

**Objective**: Keep tool cache current by refreshing when sessions start servers.

**Files to modify**:
- `packages/core/src/sessions/session.ts`

**Step 1: Study session MCP initialization**
- Find `Session.initializeMCPServers()` method or similar
- Understand when/how sessions start MCP servers

**Step 2: Write test for cache refresh**
```typescript
// Add to packages/core/src/sessions/__tests__/session.test.ts
import { ToolCatalog } from '~/tools/tool-catalog';

describe('Session MCP Tool Cache', () => {
  it('should refresh tool cache when starting MCP servers', async () => {
    const refreshSpy = vi.spyOn(ToolCatalog, 'refreshCacheForRunningServer');
    
    const session = new Session(sessionData);
    // Mock project with MCP server
    vi.spyOn(session.getProject(), 'getMCPServers').mockReturnValue({
      filesystem: { command: 'test', enabled: true, tools: {} }
    });
    
    await session.initializeMCPServers();
    
    expect(refreshSpy).toHaveBeenCalledWith(
      'filesystem',
      expect.any(Object), // MCPServerManager
      session.getProject().getWorkingDirectory()
    );
  });
});
```

**Step 3: Add refreshCacheForRunningServer method to ToolCatalog**
```typescript
// Add to packages/core/src/tools/tool-catalog.ts

/**
 * Refresh tool cache for already-running MCP server
 * Called during session startup when servers are already starting
 */
static async refreshCacheForRunningServer(
  serverId: string,
  mcpManager: MCPServerManager,
  projectDir: string
): Promise<void> {
  try {
    const client = mcpManager.getClient(serverId);
    if (!client) return; // Server not running yet
    
    const response = await client.listTools();
    const discoveredTools: DiscoveredTool[] = response.tools.map(tool => ({
      name: tool.name,
      description: tool.description
    }));
    
    // Update cache (reuse existing method)
    const currentConfig = MCPConfigLoader.loadConfig(projectDir).servers[serverId];
    if (currentConfig) {
      const updatedConfig = {
        ...currentConfig,
        discoveredTools,
        discoveryStatus: 'success' as const,
        lastDiscovery: new Date().toISOString()
      };
      
      MCPConfigLoader.updateServerConfig(serverId, updatedConfig, projectDir);
    }
    
  } catch (error) {
    logger.debug(`Failed to refresh tool cache for ${serverId}:`, error);
    // Don't fail session startup for cache refresh failures
  }
}
```

**Step 4: Update Session.initializeMCPServers**
```typescript
// In packages/core/src/sessions/session.ts
import { ToolCatalog } from '~/tools/tool-catalog';

private async initializeMCPServers(): Promise<void> {
  const projectDir = this.getProject().getWorkingDirectory();
  const mcpServers = this.getMCPServers();
  
  for (const [serverId, config] of Object.entries(mcpServers)) {
    if (config.enabled) {
      try {
        await this.mcpServerManager.startServer(serverId, config);
        
        // Refresh cache in background (don't block session startup)
        void ToolCatalog.refreshCacheForRunningServer(
          serverId,
          this.mcpServerManager,
          projectDir
        );
      } catch (error) {
        logger.warn(`Failed to start MCP server ${serverId}:`, error);
      }
    }
  }
}
```

**Step 5: Run session tests** - should pass

**Commit**: `feat: refresh MCP tool cache during session startup to keep cache current`

---

### Task 6: Integration Testing (30 min)

**Objective**: Test complete end-to-end flow with real MCP servers.

**Files to create**:
- `packages/web/app/routes/__tests__/mcp-discovery-integration.test.ts`

**Setup: Install test MCP server**
```bash
# Run this in packages/web directory
npm install --save-dev @modelcontextprotocol/server-filesystem
```

**Implementation**:

```typescript
// packages/web/app/routes/__tests__/mcp-discovery-integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupWebTest, cleanupWebTest } from '@/test-utils/web-test-setup';
import { Project, ToolCatalog } from '@/lib/server/lace-imports';
import { parseResponse } from '@/lib/serialization';

describe('MCP Tool Discovery Integration', () => {
  let project: Project;
  
  beforeEach(async () => {
    await setupWebTest();
    project = Project.create({ 
      name: 'MCP Test Project',
      workingDirectory: '/tmp/mcp-test' 
    });
  });
  
  afterEach(async () => {
    await cleanupWebTest();
  });
  
  it('should complete full discovery and configuration flow', async () => {
    // Add MCP server (should start async discovery)
    await project.addMCPServer('filesystem', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      enabled: true,
      tools: {}
    });
    
    // Config API should work immediately (using fallback tools)
    const immediateResponse = await fetch(`http://localhost/api/projects/${project.getId()}/configuration`);
    expect(immediateResponse.status).toBe(200);
    
    const immediateData = await parseResponse(immediateResponse);
    expect(immediateData.configuration.availableTools).toContain('bash'); // Native tools
    
    // Wait for async discovery to complete
    let discoveryComplete = false;
    for (let i = 0; i < 50; i++) { // Wait up to 5 seconds
      const config = project.getMCPServer('filesystem');
      if (config.discoveryStatus !== 'discovering') {
        discoveryComplete = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    expect(discoveryComplete).toBe(true);
    
    // Check discovery status
    const finalConfig = project.getMCPServer('filesystem');
    if (finalConfig.discoveryStatus === 'success') {
      expect(finalConfig.discoveredTools).toBeDefined();
      expect(finalConfig.discoveredTools.length).toBeGreaterThan(0);
      
      // Config API should now include discovered tools
      const finalResponse = await fetch(`http://localhost/api/projects/${project.getId()}/configuration`);
      const finalData = await parseResponse(finalResponse);
      
      const mcpTools = finalData.configuration.availableTools.filter(tool => tool.includes('filesystem/'));
      expect(mcpTools.length).toBeGreaterThan(0);
    } else {
      // Discovery failed - check error is recorded
      expect(finalConfig.discoveryError).toBeDefined();
    }
    
  }, 10000); // 10 second timeout for real MCP server
  
  it('should handle discovery failures gracefully', async () => {
    // Add server with invalid command
    await project.addMCPServer('broken', {
      command: 'nonexistent-command',
      enabled: true,
      tools: {}
    });
    
    // Wait for discovery to fail
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const config = project.getMCPServer('broken');
    expect(config.discoveryStatus).toBe('failed');
    expect(config.discoveryError).toContain('nonexistent-command');
    
    // Config API should still work
    const response = await fetch(`http://localhost/api/projects/${project.getId()}/configuration`);
    expect(response.status).toBe(200);
  });
  
  it('should serve configuration APIs quickly after discovery', async () => {
    // Add and wait for discovery
    await project.addMCPServer('filesystem', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      enabled: true,
      tools: {}
    });
    
    // Wait for discovery
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test API performance
    const startTime = Date.now();
    const response = await fetch(`http://localhost/api/projects/${project.getId()}/configuration`);
    const elapsed = Date.now() - startTime;
    
    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(500); // Should be fast (was 5-15 seconds before)
  });
});
```

**Step 2: Run integration test** - should pass

**Step 3: Manual testing**:
- Open Lace web UI
- Add MCP server to project  
- Verify settings page loads quickly
- Check tools appear in configuration

**Commit**: `test: add integration tests for MCP tool discovery and fast configuration APIs`

---

### Task 7: Performance Validation & Cleanup (20 min)

**Objective**: Ensure performance goals met and clean up old code.

**Step 1: Performance benchmark**
```typescript
// Add to integration test file
describe('Performance Validation', () => {
  it('configuration API should respond under 100ms', async () => {
    const project = Project.create({ name: 'Perf Test' });
    
    // Measure multiple calls
    const measurements = [];
    for (let i = 0; i < 10; i++) {
      const start = Date.now();
      const response = await fetch(`http://localhost/api/projects/${project.getId()}/configuration`);
      const elapsed = Date.now() - start;
      
      expect(response.status).toBe(200);
      measurements.push(elapsed);
    }
    
    const avgTime = measurements.reduce((a, b) => a + b) / measurements.length;
    expect(avgTime).toBeLessThan(100); // Average under 100ms
  });
});
```

**Step 2: Clean up old code**
- Remove any unused methods from Project or Session classes
- Remove unused imports from configuration API files

**Step 3: Run full test suite** - ensure no regressions

**Step 4: Update documentation**
```typescript
// Add comment to packages/core/src/tools/tool-catalog.ts
/**
 * Tool Discovery & Enumeration
 * 
 * This class provides fast tool enumeration for configuration APIs without
 * the expensive overhead of creating ToolExecutor instances.
 * 
 * Discovery Flow:
 * 1. User adds MCP server → discoverAndCacheTools() → async discovery → cache results
 * 2. Configuration API → getAvailableTools() → read cache → immediate response
 * 3. Session startup → refreshCacheForRunningServer() → keep cache current
 * 
 * Performance: Configuration APIs go from 5-15 seconds to sub-millisecond.
 */
```

**Commit**: `perf: validate configuration API performance and document tool discovery system`

---

## Testing Strategy Summary

### Unit Tests (Each Task)
- **Isolated functionality**: Each method works correctly in isolation
- **Error cases**: Handle all failure modes gracefully
- **Edge cases**: Empty configs, missing servers, invalid data
- **Mocking**: Use realistic mocks, avoid testing mock behavior

### Integration Tests (Task 6)
- **Real MCP servers**: Use actual @modelcontextprotocol packages
- **End-to-end flow**: Server add → discovery → cache → API usage
- **Performance validation**: Verify actual speed improvements
- **Error scenarios**: Discovery timeouts, invalid servers

### Manual Testing Checklist
- [ ] Add MCP server via web UI - responds immediately
- [ ] Open project settings - loads quickly (< 1 second)
- [ ] Session startup with MCP servers - doesn't slow down noticeably
- [ ] Invalid MCP server addition - shows error, doesn't crash
- [ ] Multiple MCP servers - all work correctly together

---

## Validation Criteria

**Before marking complete:**
- [ ] Configuration API calls < 100ms (down from 5-15 seconds)  
- [ ] MCP server addition doesn't block UI
- [ ] All existing tests still pass
- [ ] TypeScript compilation clean
- [ ] ESLint rules pass
- [ ] Real MCP servers work correctly
- [ ] Cache survives Lace restart
- [ ] Discovery errors handled gracefully

**Success metrics:**
- **10-100x performance improvement** in configuration APIs
- **Zero user-visible blocking** during MCP server addition
- **High discovery success rate** (>90% for valid servers)
- **Graceful error handling** for invalid servers

This implementation transforms the MCP tool discovery system from an expensive, blocking operation into a fast, background process that provides immediate user feedback while maintaining data accuracy.