# Tool Discovery & Caching System Design (Engineering Review Draft)

## Problem Statement

Configuration APIs currently create expensive ToolExecutor instances just to list available tools. This causes:
- Slow API responses (5-15 second delays)
- Resource waste (unnecessary process spawning)
- Inconsistent data (placeholder vs real tools)
- Poor user experience (UI freezes during discovery)

## Revised Design: Async Discovery with Secure Caching & Event-Driven Updates

### Architecture Overview

1. **Async Discovery**: Tool discovery happens in background, never blocks UI
2. **Secure Execution**: Discovery runs in sandboxed, resource-limited environment  
3. **Smart Caching**: Cache updated on server add, config changes, and session startup
4. **Fast APIs**: Configuration endpoints become simple cache reads (sub-millisecond)
5. **Event-Driven**: Real-time cache updates via existing event system

---

## 1. Enhanced Configuration Schema

```typescript
interface MCPServerConfig {
  // Existing fields
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  enabled: boolean;
  tools: Record<string, ToolPolicy>;
  
  // NEW: Secure discovery cache
  discoveredTools?: DiscoveredTool[];
  lastDiscovery?: string; // ISO timestamp
  discoveryError?: string;
  discoveryStatus: 'never' | 'discovering' | 'success' | 'failed' | 'timeout';
  configHash?: string; // SHA-256 of command+args+env for cache invalidation
  discoveryTimeoutMs?: number; // Per-server timeout (default: 30s, max: 120s)
}

interface DiscoveredTool {
  name: string; // Validated: alphanumeric + underscore only
  description?: string; // Max 200 chars, HTML-sanitized
  inputSchema?: SafeJSONSchema; // Sanitized and size-limited
}

interface SafeJSONSchema {
  type: string;
  description?: string; // Max 500 chars
  properties?: Record<string, SafeSchemaProperty>;
  required?: string[];
  // Excludes: $ref, allOf, anyOf, oneOf, if/then/else (security risk)
}
```

## 2. Secure Tool Discovery Service

```typescript
class SecureToolDiscoveryService {
  private static readonly MAX_CONCURRENT_DISCOVERIES = 2;
  private static readonly DEFAULT_TIMEOUT_MS = 30000;
  private static readonly MAX_TOOL_COUNT = 50;
  private static readonly MAX_SCHEMA_SIZE = 8192; // 8KB per schema
  
  private static discoveryLocks = new Map<string, Promise<DiscoveredTool[]>>();
  private static activeDiscoveries = 0;
  
  /**
   * Async discovery at server add-time (non-blocking UI)
   */
  static async discoverServerToolsAsync(
    serverId: string, 
    config: MCPServerConfig,
    progressCallback?: (status: string) => void
  ): Promise<void> {
    // Start discovery in background, update config immediately
    const pendingConfig = {
      ...config,
      discoveryStatus: 'discovering' as const,
      lastDiscovery: new Date().toISOString(),
      configHash: this.generateConfigHash(config)
    };
    
    // Non-blocking: Add server immediately with "discovering" status
    await this.updateServerConfig(serverId, pendingConfig);
    
    // Background discovery with progress updates
    void this.performSecureDiscovery(serverId, config, progressCallback);
  }
  
  /**
   * Secure discovery with resource limits and validation
   */
  private static async performSecureDiscovery(
    serverId: string, 
    config: MCPServerConfig,
    progressCallback?: (status: string) => void
  ): Promise<void> {
    // Rate limiting
    if (this.activeDiscoveries >= this.MAX_CONCURRENT_DISCOVERIES) {
      await this.waitForDiscoverySlot();
    }
    
    // Prevent duplicate discoveries
    const lockKey = `${serverId}:${this.generateConfigHash(config)}`;
    if (this.discoveryLocks.has(lockKey)) {
      return this.discoveryLocks.get(lockKey);
    }
    
    const discoveryPromise = this.doSecureDiscovery(serverId, config, progressCallback);
    this.discoveryLocks.set(lockKey, discoveryPromise);
    
    try {
      await discoveryPromise;
    } finally {
      this.discoveryLocks.delete(lockKey);
      this.activeDiscoveries--;
    }
  }
  
  private static async doSecureDiscovery(
    serverId: string, 
    config: MCPServerConfig,
    progressCallback?: (status: string) => void
  ): Promise<void> {
    this.activeDiscoveries++;
    progressCallback?.('starting');
    
    // Create isolated, sandboxed manager
    const discoveryManager = new IsolatedMCPManager({
      tempDir: path.join(os.tmpdir(), `mcp-discovery-${serverId}-${Date.now()}`),
      resourceLimits: {
        maxMemoryMB: 100,
        maxCpuPercent: 25,
        networkAccess: false // Block network for security
      },
      timeoutMs: config.discoveryTimeoutMs || this.DEFAULT_TIMEOUT_MS
    });
    
    try {
      progressCallback?.('connecting');
      
      // Secure server startup with validation
      await discoveryManager.startSecureServer(serverId, this.sanitizeConfig(config));
      
      progressCallback?.('discovering');
      
      // Discover tools with timeout and limits
      const response = await Promise.race([
        discoveryManager.listTools(serverId),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Discovery timeout')), config.discoveryTimeoutMs || this.DEFAULT_TIMEOUT_MS)
        )
      ]);
      
      // Validate and sanitize discovered tools
      const discoveredTools = this.validateAndSanitizeTools(response.tools, serverId);
      
      progressCallback?.('caching');
      
      // Update cache with success
      await this.updateToolCache(serverId, discoveredTools, 'success');
      
      progressCallback?.('complete');
      
    } catch (error) {
      logger.warn(`Tool discovery failed for ${serverId}:`, error);
      
      // Update cache with failure
      await this.updateToolCache(serverId, [], 'failed', error.message);
      
      progressCallback?.('failed');
    } finally {
      await discoveryManager.forceCleanup();
    }
  }
  
  /**
   * Refresh cache during session startup (when servers are already starting)
   */
  static async refreshCacheForRunningServer(
    serverId: string, 
    mcpManager: MCPServerManager,
    projectDir: string
  ): Promise<void> {
    try {
      const client = mcpManager.getClient(serverId);
      if (!client) return;
      
      const response = await client.listTools();
      const discoveredTools = this.validateAndSanitizeTools(response.tools, serverId);
      
      await this.updateToolCache(serverId, discoveredTools, 'success', undefined, projectDir);
    } catch (error) {
      logger.warn(`Failed to refresh tool cache for ${serverId}:`, error);
    }
  }
  
  /**
   * Security: Validate and sanitize tool data
   */
  private static validateAndSanitizeTools(tools: MCPTool[], serverId: string): DiscoveredTool[] {
    if (tools.length > this.MAX_TOOL_COUNT) {
      logger.warn(`Server ${serverId} has too many tools (${tools.length}), limiting to ${this.MAX_TOOL_COUNT}`);
      tools = tools.slice(0, this.MAX_TOOL_COUNT);
    }
    
    return tools.map(tool => ({
      name: this.sanitizeToolName(tool.name),
      description: this.sanitizeDescription(tool.description),
      inputSchema: this.sanitizeSchema(tool.inputSchema)
    })).filter(tool => tool.name); // Remove tools with invalid names
  }
  
  private static sanitizeToolName(name: string): string {
    // Only allow alphanumeric, underscore, hyphen
    const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '');
    if (sanitized !== name) {
      logger.warn(`Sanitized tool name: ${name} -> ${sanitized}`);
    }
    return sanitized;
  }
  
  private static sanitizeDescription(description?: string): string {
    if (!description) return '';
    
    // Limit length and remove HTML
    const cleaned = description.replace(/<[^>]*>/g, '').substring(0, 200);
    return cleaned;
  }
  
  private static sanitizeSchema(schema?: unknown): SafeJSONSchema | undefined {
    if (!schema || typeof schema !== 'object') return undefined;
    
    const schemaStr = JSON.stringify(schema);
    if (schemaStr.length > this.MAX_SCHEMA_SIZE) {
      logger.warn('Tool schema too large, providing placeholder');
      return { 
        type: 'object', 
        description: 'Schema too large to cache safely' 
      };
    }
    
    // Remove dangerous schema constructs
    return this.createSafeSchema(schema as Record<string, unknown>);
  }
  
  private static generateConfigHash(config: MCPServerConfig): string {
    const hashSource = JSON.stringify({
      command: config.command,
      args: config.args || [],
      env: config.env || {}
    });
    return crypto.createHash('sha256').update(hashSource).digest('hex').substring(0, 16);
  }
  
  /**
   * Thread-safe config updates with file locking
   */
  private static async updateToolCache(
    serverId: string,
    tools: DiscoveredTool[],
    status: 'success' | 'failed' | 'timeout',
    error?: string,
    projectDir?: string
  ): Promise<void> {
    const lockFile = projectDir 
      ? path.join(projectDir, '.lace', '.mcp-discovery.lock')
      : path.join(os.homedir(), '.lace', '.mcp-discovery.lock');
      
    await this.withFileLock(lockFile, async () => {
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
    });
  }
}
```

## 3. Fast Tool Catalog Service

High-performance service for configuration APIs:

```typescript
interface ToolInfo {
  name: string;
  description: string;
  type: 'native' | 'mcp';
  configuredPolicy?: string;
  discoveryStatus?: 'never' | 'discovering' | 'success' | 'failed';
  lastDiscovered?: string;
  isAvailable: boolean; // True for native tools, depends on discovery for MCP
}

class ToolCatalog {
  private static nativeToolCache: ToolInfo[] | null = null;
  
  /**
   * Get complete tool catalog for project (fast cache read)
   */
  static getProjectToolCatalog(project: Project): ToolInfo[] {
    const nativeTools = this.getNativeToolCatalog();
    const mcpTools = this.getMCPToolCatalogFromCache(project);
    return [...nativeTools, ...mcpTools];
  }
  
  /**
   * Get runtime tool catalog for session
   * Uses actual ToolExecutor if available, otherwise cached data
   */
  static getSessionToolCatalog(session: Session): ToolInfo[] {
    // Prefer actual runtime tools if session has active agents
    const activeToolExecutor = session.getActiveToolExecutor();
    if (activeToolExecutor) {
      return this.getToolsFromRuntime(activeToolExecutor);
    }
    
    // Fallback to project catalog with availability indicators
    return this.getProjectToolCatalog(session.getProject()).map(tool => ({
      ...tool,
      isAvailable: tool.type === 'native' || tool.discoveryStatus === 'success'
    }));
  }
  
  private static getNativeToolCatalog(): ToolInfo[] {
    if (!this.nativeToolCache) {
      this.nativeToolCache = [
        { name: 'bash', description: 'Execute shell commands', type: 'native', isAvailable: true },
        { name: 'file_read', description: 'Read files', type: 'native', isAvailable: true },
        { name: 'file_write', description: 'Write files', type: 'native', isAvailable: true },
        { name: 'file_edit', description: 'Edit files', type: 'native', isAvailable: true },
        { name: 'file_list', description: 'List directory contents', type: 'native', isAvailable: true },
        { name: 'ripgrep_search', description: 'Search files', type: 'native', isAvailable: true },
        { name: 'file_find', description: 'Find files', type: 'native', isAvailable: true },
        { name: 'delegate', description: 'Delegate to sub-agent', type: 'native', isAvailable: true },
        { name: 'url_fetch', description: 'Fetch URLs', type: 'native', isAvailable: true },
        { name: 'task_create', description: 'Create tasks', type: 'native', isAvailable: true },
        { name: 'task_list', description: 'List tasks', type: 'native', isAvailable: true },
        { name: 'task_complete', description: 'Complete tasks', type: 'native', isAvailable: true },
        { name: 'task_update', description: 'Update tasks', type: 'native', isAvailable: true },
        { name: 'task_add_note', description: 'Add task notes', type: 'native', isAvailable: true },
        { name: 'task_view', description: 'View tasks', type: 'native', isAvailable: true },
      ];
    }
    return this.nativeToolCache;
  }
  
  private static getMCPToolCatalogFromCache(project: Project): ToolInfo[] {
    return Object.entries(project.getMCPServers()).flatMap(([serverId, serverConfig]) => {
      if (!serverConfig.discoveredTools) {
        // Discovery never completed or in progress
        return [{
          name: `${serverId}/*`,
          description: `${serverId} tools (discovery ${serverConfig.discoveryStatus})`,
          type: 'mcp' as const,
          discoveryStatus: serverConfig.discoveryStatus,
          isAvailable: false
        }];
      }
      
      return serverConfig.discoveredTools.map(tool => ({
        name: `${serverId}/${tool.name}`,
        description: tool.description || `${serverId}: ${tool.name}`,
        type: 'mcp' as const,
        configuredPolicy: serverConfig.tools[tool.name],
        discoveryStatus: serverConfig.discoveryStatus,
        lastDiscovered: serverConfig.lastDiscovery,
        isAvailable: serverConfig.discoveryStatus === 'success'
      }));
    });
  }
  
  private static getToolsFromRuntime(toolExecutor: ToolExecutor): ToolInfo[] {
    return toolExecutor.getAllTools()
      .filter(tool => !tool.annotations?.safeInternal)
      .map(tool => ({
        name: tool.name,
        description: tool.description,
        type: tool.name.includes('/') ? 'mcp' : 'native',
        isAvailable: true // If it's in runtime ToolExecutor, it's available
      }));
  }
}
```

## 4. Integration with Existing Components

### Project Class Updates
```typescript
class Project {
  async addMCPServer(serverId: string, config: MCPServerConfig): Promise<void> {
    // Validate server config
    if (!this.validateServerConfig(serverId, config)) {
      throw new Error('Invalid server configuration');
    }
    
    // Check for duplicates
    if (this.getMCPServer(serverId)) {
      throw new Error(`MCP server '${serverId}' already exists`);
    }
    
    // Start async discovery (non-blocking)
    await SecureToolDiscoveryService.discoverServerToolsAsync(
      serverId, 
      config,
      (status) => this.emitDiscoveryProgress(serverId, status)
    );
    
    // Notify sessions immediately (they'll see "discovering" status)
    this.notifySessionsMCPChange(serverId, 'created', config);
  }
  
  async updateMCPServer(serverId: string, updates: Partial<MCPServerConfig>): Promise<void> {
    const currentConfig = this.getMCPServer(serverId);
    if (!currentConfig) throw new Error(`Server ${serverId} not found`);
    
    const newConfig = { ...currentConfig, ...updates };
    const configChanged = this.hasSignificantConfigChange(currentConfig, newConfig);
    
    if (configChanged) {
      // Re-discover tools if server command/args changed
      await SecureToolDiscoveryService.discoverServerToolsAsync(
        serverId,
        newConfig,
        (status) => this.emitDiscoveryProgress(serverId, status)
      );
    } else {
      // Just update config without re-discovery
      MCPConfigLoader.updateServerConfig(serverId, newConfig, this.getWorkingDirectory());
    }
    
    this.notifySessionsMCPChange(serverId, 'updated', newConfig);
  }
  
  private hasSignificantConfigChange(old: MCPServerConfig, new: MCPServerConfig): boolean {
    const oldHash = SecureToolDiscoveryService.generateConfigHash(old);
    const newHash = SecureToolDiscoveryService.generateConfigHash(new);
    return oldHash !== newHash;
  }
  
  private emitDiscoveryProgress(serverId: string, status: string): void {
    // Emit real-time progress events for UI
    EventEmitter.emit('mcp-discovery-progress', { serverId, status });
  }
}
```

### Session Class Updates
```typescript
class Session {
  async initializeMCPServers(): Promise<void> {
    const projectDir = this.getProject().getWorkingDirectory();
    const mcpServers = this.getMCPServers();
    
    // Start all enabled servers
    for (const [serverId, config] of Object.entries(mcpServers)) {
      if (config.enabled) {
        try {
          await this.mcpServerManager.startServer(serverId, config);
          
          // Refresh cache in background (non-blocking session startup)
          void SecureToolDiscoveryService.refreshCacheForRunningServer(
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
  
  getActiveToolExecutor(): ToolExecutor | null {
    // Return ToolExecutor from first active agent
    const activeAgents = this.getActiveAgents();
    return activeAgents.length > 0 ? activeAgents[0].getToolExecutor() : null;
  }
}
```

## 5. Ultra-Fast Configuration APIs

```typescript
// Project Configuration: Fast cache read
export async function loader({ params }: Route.LoaderArgs) {
  const project = Project.getById(params.projectId);
  if (!project) {
    return createErrorResponse('Project not found', 404);
  }
  
  const configuration = project.getConfiguration();
  
  // FAST: Sub-millisecond cache read, no ToolExecutor creation
  const availableTools = ToolCatalog.getProjectToolCatalog(project);
  
  return createSuperjsonResponse({
    configuration: {
      ...configuration,
      availableTools // Now includes discovery status for MCP tools
    }
  });
}

// Session Configuration: Runtime-aware
export async function loader({ params }: Route.LoaderArgs) {
  const session = await sessionService.getSession(params.sessionId);
  if (!session) {
    return createErrorResponse('Session not found', 404);
  }
  
  const configuration = session.getEffectiveConfiguration();
  
  // SMART: Use runtime tools if available, cached otherwise
  const availableTools = ToolCatalog.getSessionToolCatalog(session);
  
  return createSuperjsonResponse({
    configuration: {
      ...configuration,
      availableTools,
      toolDataSource: session.getActiveToolExecutor() ? 'runtime' : 'cached'
    }
  });
}
```

## 6. Cache Update Strategy

**Cache is updated on**:
1. **Server Add**: Async discovery with immediate UI feedback
2. **Server Config Change**: Re-discovery if command/args/env changes
3. **Session Startup**: Background refresh for all project servers
4. **Manual Refresh**: User-triggered discovery action
5. **Periodic Health Check**: Daily cache validation (optional)

**Cache is NOT updated**:
- On every API call (expensive)
- When only tool policies change (no need to re-discover)
- When servers are disabled (no discovery needed)

## 7. Error Handling & Recovery

```typescript
class ToolDiscoveryErrorHandler {
  static handleDiscoveryFailure(serverId: string, error: Error): DiscoveryFailureAction {
    if (error.message.includes('timeout')) {
      return { 
        action: 'retry', 
        delay: '30s',
        suggestion: 'Server may be slow to start' 
      };
    }
    
    if (error.message.includes('command not found')) {
      return { 
        action: 'user-action-required', 
        suggestion: 'Check that MCP server package is installed' 
      };
    }
    
    if (error.message.includes('permission denied')) {
      return { 
        action: 'user-action-required',
        suggestion: 'Check file permissions for server executable' 
      };
    }
    
    return { 
      action: 'log-and-continue',
      suggestion: 'Server configuration may be invalid' 
    };
  }
}
```

## 8. Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
1. Extend MCPServerConfig schema
2. Implement ToolCatalog with fallback to current behavior
3. Add secure discovery service foundation

### Phase 2: Async Discovery (Week 1)
1. Implement async discovery for server add operations
2. Add progress tracking and error handling
3. Update Project.addMCPServer() with async discovery

### Phase 3: Cache Refresh (Week 2)
1. Add session startup cache refresh
2. Implement config change detection
3. Add file locking for thread safety

### Phase 4: Configuration API Updates (Week 2)
1. Update project configuration API to use ToolCatalog
2. Update session configuration API with runtime awareness
3. Add UI indicators for tool availability and discovery status

## Benefits Summary

1. **Performance**: Configuration APIs become sub-millisecond operations
2. **UX**: Non-blocking server addition with real-time progress
3. **Accuracy**: Cache stays current with server changes and session startup
4. **Security**: Sandboxed discovery with resource limits and input validation
5. **Maintainability**: Clear service boundaries and comprehensive error handling

## Risks & Mitigations

1. **Cache Consistency**: Mitigated by file locking and atomic updates
2. **Security**: Mitigated by process sandboxing and input sanitization
3. **Resource Usage**: Mitigated by discovery rate limiting and timeouts
4. **Complex State**: Mitigated by clear discovery status tracking and debugging tools

This design transforms tool discovery from a blocking, expensive operation into a fast, secure, background process with excellent user experience.