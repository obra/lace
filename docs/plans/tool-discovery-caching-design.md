# Tool Discovery & Caching System Design (Revised)

## Problem Statement

Configuration APIs need to show available tools efficiently without:
- Creating expensive ToolExecutor instances per API call
- Starting MCP servers just for tool discovery
- Showing stale or incorrect tool information

## Core Design: Async Discovery with Secure Caching

**Revised based on engineering review feedback addressing UX, security, and consistency concerns**

### 1. Enhanced MCP Configuration Schema

Extend existing `MCPServerConfig` to include discovery cache:

```typescript
interface MCPServerConfig {
  // Existing fields
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  enabled: boolean;
  tools: Record<string, ToolPolicy>; // Approval policies for discovered tools
  
  // NEW: Tool discovery cache with security and consistency
  discoveredTools?: DiscoveredTool[];
  lastDiscovery?: string; // ISO timestamp
  discoveryError?: string;
  discoveryStatus: 'never' | 'discovering' | 'success' | 'failed';
  configHash?: string; // Hash of command+args+env for cache invalidation
  discoveryTimeoutMs?: number; // Per-server timeout (default: 30s)
}

interface DiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: SafeJSONSchema; // Sanitized, size-limited schema
}

interface SafeJSONSchema {
  type: string;
  description?: string;
  properties?: Record<string, unknown>;
  // Excludes potentially dangerous schema properties
}
```

### 2. Tool Discovery Service

Central service responsible for MCP server tool discovery and cache management:

```typescript
class ToolDiscoveryService {
  /**
   * Discover tools from MCP server (temporary startup for discovery only)
   * Called when user adds new MCP server
   */
  static async discoverServerTools(serverId: string, config: MCPServerConfig): Promise<DiscoveredTool[]> {
    const tempManager = new MCPServerManager();
    try {
      await tempManager.startServer(serverId, config);
      const client = tempManager.getClient(serverId);
      const response = await client.listTools();
      
      return response.tools.map(tool => ({
        name: tool.name,
        description: tool.description || `${serverId} tool: ${tool.name}`,
        inputSchema: tool.inputSchema
      }));
    } catch (error) {
      logger.warn(`Failed to discover tools for ${serverId}:`, error);
      throw new Error(`Tool discovery failed: ${error.message}`);
    } finally {
      await tempManager.cleanup();
    }
  }
  
  /**
   * Refresh cached tools for already-running server
   * Called during session MCP server initialization
   */
  static async refreshCachedTools(serverId: string, mcpManager: MCPServerManager, projectDir: string): Promise<void> {
    try {
      const client = mcpManager.getClient(serverId);
      if (!client) return; // Server not running
      
      const response = await client.listTools();
      const discoveredTools = response.tools.map(tool => ({
        name: tool.name,
        description: tool.description || `${serverId} tool: ${tool.name}`,
        inputSchema: tool.inputSchema
      }));
      
      await this.updateToolCache(serverId, discoveredTools, 'success', undefined, projectDir);
      logger.debug(`Refreshed tool cache for ${serverId}:`, { toolCount: discoveredTools.length });
    } catch (error) {
      await this.updateToolCache(serverId, [], 'failed', error.message, projectDir);
      logger.warn(`Failed to refresh tools for ${serverId}:`, error);
    }
  }
  
  /**
   * Update tool discovery cache in project configuration
   */
  private static async updateToolCache(
    serverId: string, 
    tools: DiscoveredTool[], 
    status: 'success' | 'failed',
    error?: string,
    projectDir?: string
  ): Promise<void> {
    // Get current config
    const currentConfig = projectDir 
      ? MCPConfigLoader.loadConfig(projectDir).servers[serverId]
      : MCPConfigLoader.loadGlobalConfig()?.servers[serverId];
    
    if (!currentConfig) return;
    
    const updatedConfig = {
      ...currentConfig,
      discoveredTools: tools,
      lastDiscovery: new Date().toISOString(),
      discoveryStatus: status,
      discoveryError: error
    };
    
    MCPConfigLoader.updateServerConfig(serverId, updatedConfig, projectDir);
  }
}
```

### 3. Fast Tool Catalog Service

Efficient service for configuration APIs to get tool information without ToolExecutor creation:

```typescript
interface ToolInfo {
  name: string;
  description: string;
  type: 'native' | 'mcp';
  configuredPolicy?: string;
  discoveryStatus?: 'never' | 'discovering' | 'success' | 'failed';
  lastDiscovered?: string;
}

class ToolCatalog {
  /**
   * Get complete tool catalog for project configuration APIs
   * Fast operation - just reads cached discovery data
   */
  static getProjectToolCatalog(project: Project): ToolInfo[] {
    const nativeTools = this.getNativeToolCatalog();
    const mcpTools = this.getMCPToolCatalogFromCache(project);
    return [...nativeTools, ...mcpTools];
  }
  
  /**
   * Get runtime tool catalog for session configuration APIs
   * Prefers actual running tools, falls back to cached
   */
  static getSessionToolCatalog(session: Session): ToolInfo[] {
    // Try to get from session's active ToolExecutor first
    const activeToolExecutor = session.getActiveToolExecutor();
    if (activeToolExecutor) {
      return activeToolExecutor.getAllTools()
        .filter(tool => !tool.annotations?.safeInternal)
        .map(tool => ({
          name: tool.name,
          description: tool.description,
          type: tool.name.includes('/') ? 'mcp' : 'native'
        }));
    }
    
    // Fallback to project tool catalog
    return this.getProjectToolCatalog(session.getProject());
  }
  
  private static getNativeToolCatalog(): ToolInfo[] {
    return [
      { name: 'bash', description: 'Execute shell commands', type: 'native' },
      { name: 'file_read', description: 'Read files', type: 'native' },
      { name: 'file_write', description: 'Write files', type: 'native' },
      { name: 'file_edit', description: 'Edit files', type: 'native' },
      { name: 'file_list', description: 'List directory contents', type: 'native' },
      { name: 'ripgrep_search', description: 'Search files', type: 'native' },
      { name: 'file_find', description: 'Find files', type: 'native' },
      { name: 'delegate', description: 'Delegate to sub-agent', type: 'native' },
      { name: 'url_fetch', description: 'Fetch URLs', type: 'native' },
      { name: 'task_create', description: 'Create tasks', type: 'native' },
      { name: 'task_list', description: 'List tasks', type: 'native' },
      { name: 'task_complete', description: 'Complete tasks', type: 'native' },
      { name: 'task_update', description: 'Update tasks', type: 'native' },
      { name: 'task_add_note', description: 'Add task notes', type: 'native' },
      { name: 'task_view', description: 'View tasks', type: 'native' },
    ];
  }
  
  private static getMCPToolCatalogFromCache(project: Project): ToolInfo[] {
    const mcpServers = project.getMCPServers();
    return Object.entries(mcpServers).flatMap(([serverId, serverConfig]) => {
      if (!serverConfig.discoveredTools) {
        return []; // No discovery yet
      }
      
      return serverConfig.discoveredTools.map(tool => ({
        name: `${serverId}/${tool.name}`,
        description: tool.description,
        type: 'mcp' as const,
        configuredPolicy: serverConfig.tools[tool.name],
        discoveryStatus: serverConfig.discoveryStatus,
        lastDiscovered: serverConfig.lastDiscovery
      }));
    });
  }
}
```

### 4. Updated Configuration APIs

```typescript
// Project Configuration API
export async function loader({ params }: Route.LoaderArgs) {
  try {
    const project = Project.getById(params.projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }
    
    const configuration = project.getConfiguration();
    
    // FAST: Just read from cache, no ToolExecutor creation
    const availableTools = ToolCatalog.getProjectToolCatalog(project);
    
    return createSuperjsonResponse({
      configuration: {
        ...configuration,
        availableTools
      }
    });
  } catch (error) {
    return createErrorResponse(error.message, 500);
  }
}

// Session Configuration API  
export async function loader({ params }: Route.LoaderArgs) {
  try {
    const session = await sessionService.getSession(params.sessionId);
    if (!session) {
      return createErrorResponse('Session not found', 404);
    }
    
    const configuration = session.getEffectiveConfiguration();
    
    // SMART: Use runtime tools if available, cached if not
    const availableTools = ToolCatalog.getSessionToolCatalog(session);
    
    return createSuperjsonResponse({
      configuration: {
        ...configuration,
        availableTools
      }
    });
  } catch (error) {
    return createErrorResponse(error.message, 500);
  }
}
```

### 5. Integration with Existing Flows

```typescript
// Project class updates
class Project {
  async addMCPServer(serverId: string, config: MCPServerConfig): Promise<void> {
    // Discover tools immediately for user feedback
    try {
      const discoveredTools = await ToolDiscoveryService.discoverServerTools(serverId, config);
      const configWithDiscovery = {
        ...config,
        discoveredTools,
        lastDiscovery: new Date().toISOString(),
        discoveryStatus: 'success' as const
      };
      
      MCPConfigLoader.updateServerConfig(serverId, configWithDiscovery, this.getWorkingDirectory());
      this.notifySessionsMCPChange(serverId, 'created', configWithDiscovery);
    } catch (error) {
      // Store server with discovery failure
      const configWithError = {
        ...config,
        discoveryStatus: 'failed' as const,
        discoveryError: error.message,
        lastDiscovery: new Date().toISOString()
      };
      
      MCPConfigLoader.updateServerConfig(serverId, configWithError, this.getWorkingDirectory());
      throw error; // Let user know about discovery failure
    }
  }
}

// Session class updates
class Session {
  async initializeMCPServers(): Promise<void> {
    const projectDir = this.getProject().getWorkingDirectory();
    
    for (const [serverId, config] of Object.entries(this.getMCPServers())) {
      if (config.enabled) {
        try {
          await this.mcpServerManager.startServer(serverId, config);
          
          // Refresh discovery cache (background, non-blocking)
          void ToolDiscoveryService.refreshCachedTools(serverId, this.mcpServerManager, projectDir);
        } catch (error) {
          logger.warn(`Failed to start MCP server ${serverId}:`, error);
        }
      }
    }
  }
  
  getActiveToolExecutor(): ToolExecutor | null {
    // Check if any agents are running and return their ToolExecutor
    const activeAgents = this.getActiveAgents();
    return activeAgents.length > 0 ? activeAgents[0].getToolExecutor() : null;
  }
}
```

## Cache Update Strategy

**Tool cache gets updated on**:
1. **Server Add**: Immediate discovery for user feedback
2. **Server Config Change**: Re-discovery if command/args change
3. **Session Startup**: Background refresh of all project MCP servers
4. **Manual Refresh**: User-triggered re-discovery action

**Configuration APIs**:
- Are fast cache reads (no ToolExecutor creation)
- Show most current available information
- Gracefully handle discovery failures

This design provides immediate user feedback, keeps cache current, and makes configuration APIs extremely fast while maintaining accuracy.