# Session Container Isolation Design

## Executive Summary

This design document outlines the implementation of container-based isolation for Lace sessions. Each session will run its code and tools in an isolated container with its own local git clone, providing complete separation between concurrent sessions while maintaining seamless integration with the existing Lace architecture.

## Implementation Status

### Phase 1 ✅ COMPLETED
- Container runtime abstraction layer implemented
- AppleContainerRuntime using macOS `container` CLI tool
- Full test coverage (24 tests passing)
- Path translation and volume mounting working

### Phase 2 🚧 PLANNED
- Session integration with containers
- Tool executor modifications
- Git worktree management
- Devcontainer.json support

## Goals

- **Isolation**: Each session operates in its own container with a dedicated git clone
- **Transparency**: Tools and agents work without modification
- **Efficiency**: Containers start on-demand using lightweight Apple Container
- **Standards**: Use industry-standard devcontainer.json configuration
- **Simplicity**: Minimal changes to existing codebase
- **Reliability**: Proper resource cleanup and orphan detection

## Architecture Overview

### Core Concepts

1. **Session = Clone + Container**: Each session gets its own local git clone and container
2. **Lazy Container Start**: Containers start when agents receive messages
3. **Tool Interception**: ToolExecutor transparently redirects all operations to containers
4. **Session Ownership**: Session class manages container lifecycle

### Component Relationships

```
Project (has git repo)
    ├── Session 1
    │   ├── Local Clone (~/.lace/sessions/session-{id}/)
    │   ├── Container (mcr.microsoft.com/devcontainers/universal:2-linux)
    │   └── Agents → ToolExecutor → Container.exec()
    └── Session 2
        ├── Local Clone (~/.lace/sessions/session-{id}/)
        ├── Container (from .devcontainer/devcontainer.json)
        └── Agents → ToolExecutor → Container.exec()
```

## Detailed Design

## Phase 1: Container Runtime Implementation

### Key Discoveries

1. **Container Tool vs sandbox-exec**: The macOS `container` CLI tool is the correct approach for Apple Containers, not the deprecated `sandbox-exec`.

2. **Working Directory Paths**: Container working directories must use container-internal paths (e.g., `/workspace`), not host paths. This was a critical discovery during integration testing.

3. **Exit Code 143**: When stopping containers, exit code 143 is normal and indicates successful SIGTERM signal handling. This should not be treated as an error.

4. **Volume Mount Syntax**: The `container` tool doesn't support Docker-style mount options (`:ro/:rw`). Mounts are specified as `-v "source:target"` without suffixes.

5. **Container ID Uniqueness**: Container names must be globally unique. We append 8-character UUID suffixes to prevent conflicts during testing and concurrent operations.

### Implementation Architecture

```typescript
// Core abstraction
interface ContainerRuntime {
  create(config: ContainerConfig): string | Promise<string>;
  start(containerId: string): Promise<void>;
  stop(containerId: string, timeout?: number): Promise<void>;
  remove(containerId: string): Promise<void>;
  exec(containerId: string, options: ExecOptions): Promise<ExecResult>;
  // Path translation for mounted volumes
  translateToContainer(hostPath: string, containerId: string): string;
  translateToHost(containerPath: string, containerId: string): string;
}

// Apple-specific implementation
class AppleContainerRuntime extends BaseContainerRuntime {
  // Uses 'container' CLI tool
  // Handles exit code 143 gracefully
  // Auto-creates mount directories
  // Generates unique container IDs
}
```

### Testing Insights

1. **Integration Tests Required**: Unit tests with mocks weren't sufficient. Real container launch tests were essential to discover the working directory and mount issues.

2. **Cleanup Complexity**: Container cleanup requires careful timeout handling and force-kill fallback strategies.

3. **Initialization Time**: Containers need ~2 seconds after creation to be fully ready for exec commands.

### 1. Session Clone Management (Phase 2)

Each session gets its own local git clone to provide complete isolation with full git functionality.

**Important: Why Clones, Not Worktrees**
- Git worktrees only contain a `.git` file pointing to the parent repository
- Containers need the full `.git` directory for git operations
- Local clones with `--local` flag use hardlinks, providing similar space efficiency
- Each container gets a self-contained repository that works independently

Local clones use hardlinks for efficiency, making them almost as space-efficient as worktrees while providing the complete git functionality needed inside containers.

```typescript
// In ContainerManager class
private async ensureSessionClone(): Promise<string> {
  if (this._sessionPath) {
    return this._sessionPath;
  }

  const session = Session.getByIdSync(this.sessionId);
  const project = Project.getById(session.getProjectId());
  const projectDir = project.getWorkingDirectory();

  // Check if it's a git repo - required for session isolation
  const gitDir = join(projectDir, '.git');
  if (!existsSync(gitDir)) {
    logger.info('Initializing git repo for session isolation', { projectDir });
    await execAsync('git init', { cwd: projectDir });

    // Ensure .gitignore exists with sensible defaults
    const gitignorePath = join(projectDir, '.gitignore');
    if (!existsSync(gitignorePath)) {
      await fs.writeFile(gitignorePath, 'node_modules/\n.env\n*.log\n.DS_Store\n');
    }

    // Commit with proper git config
    try {
      await execAsync('git add -A', { cwd: projectDir });
      await execAsync('git commit -m "Initial commit for container isolation"', {
        cwd: projectDir,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Lace',
          GIT_AUTHOR_EMAIL: 'lace@localhost',
          GIT_COMMITTER_NAME: 'Lace',
          GIT_COMMITTER_EMAIL: 'lace@localhost'
        }
      });
    } catch (error) {
      logger.debug('No files to commit in new git repo');
    }
  }

  // Create local clone for this session
  const sessionsDir = join(getLaceDir(), 'sessions');
  const sessionPath = join(sessionsDir, `session-${this.sessionId}`);

  if (!existsSync(sessionPath)) {
    // Create local clone (uses hardlinks for efficiency)
    await execAsync(`git clone --local "${projectDir}" "${sessionPath}"`);

    // Create session-specific branch to avoid conflicts
    await execAsync(`git checkout -b session-${this.sessionId}`, { cwd: sessionPath });

    logger.info('Created local clone for session', {
      sessionId: this.sessionId,
      sessionPath
    });
  }

  this._sessionPath = sessionPath;
  return sessionPath;
}
```

**Key Points**:
- Local clones created lazily on first container start (not at session creation)
- Located at `~/.lace/sessions/session-{sessionId}/`
- If project lacks git repo, one is initialized automatically
- Each session gets its own branch to avoid conflicts
- `--local` flag uses hardlinks for space efficiency
- Full git functionality works inside containers

### 2. Container Lifecycle

Containers are managed by a ContainerManager that's created during session reconstruction:

```typescript
// In Session class - lazy initialization during reconstruction
private static async _performReconstruction(sessionId: ThreadId): Promise<Session | null> {
  // ... existing reconstruction code ...

  const session = new Session(sessionId, sessionData, threadManager, taskManager);

  // Initialize container manager if containers are enabled
  if (isContainersEnabled()) {
    session._containerManager = new ContainerManager(sessionId);
    // Don't await initialization - let it happen in background
    session._containerInitPromise = session._containerManager.initialize();
  }

  return session;
}

// Container manager accessor - waits for initialization if needed
async getContainerManager(): Promise<ContainerManager | null> {
  if (!this._containerManager) {
    return null;
  }

  // Wait for initialization if still in progress
  if (this._containerInitPromise) {
    await this._containerInitPromise;
  }

  return this._containerManager;
}
```

**Container States**:
- **Not Started**: Initial state, no container exists
- **Running**: Container is active and accepting commands
- **Stopped**: Container exists but is not running
- **Failed**: Container failed to start or crashed

### 3. Devcontainer Configuration

Sessions use the industry-standard `.devcontainer/devcontainer.json` if present:

```typescript
private async getDevcontainerConfig(): Promise<DevcontainerConfig> {
  const project = Project.getById(this._projectId);
  const projectDir = project.getWorkingDirectory();
  const devcontainerPath = path.join(projectDir, '.devcontainer', 'devcontainer.json');

  if (fs.existsSync(devcontainerPath)) {
    const config = JSON.parse(fs.readFileSync(devcontainerPath, 'utf8'));
    return {
      image: config.image || config.build?.dockerfile,
      features: config.features,
      mounts: config.mounts,
      env: config.containerEnv,
      postCreateCommand: config.postCreateCommand
    };
  }

  // Default to Microsoft universal devcontainer
  return {
    image: 'mcr.microsoft.com/devcontainers/universal:2-linux'
  };
}
```

**Supported devcontainer.json fields**:
- `image`: Container image to use
- `build.dockerfile`: Custom Dockerfile path
- `features`: Additional dev container features
- `mounts`: Extra volume mounts
- `containerEnv`: Environment variables
- `postCreateCommand`: Command to run after container creation

### 4. Tool Execution Interception

The ToolExecutor builds container context when executing tools:

```typescript
// In ToolExecutor.execute() - existing method signature
async execute(toolCall: ToolCall, context: ToolContext): Promise<ToolResult> {
  // ... existing validation ...

  let toolContext = { ...context };

  // Build enhanced context with session info
  if (context?.agent) {
    const session = await context.agent.getFullSession();

    if (session) {
      // Add container context if enabled
      const containerManager = await session.getContainerManager();
      if (containerManager && await containerManager.isReady()) {
        // Ensure container is started
        await containerManager.ensureStarted();

        // Add container info to context
        toolContext.container = {
          exec: (cmd: string[]) => containerManager.exec(cmd),
          workspacePath: '/workspace'
        };

        // Override working directory for container
        toolContext.workingDirectory = '/workspace';
      }

      // ... existing project env setup ...
    }
  }

  // Execute with enhanced context
  return await tool.execute(toolCall.arguments, toolContext);
}
```

### 5. Tool Adaptations

Tools check for container in context and adjust behavior:

```typescript
// BashTool modification
protected async executeValidated(
  args: z.infer<typeof bashSchema>,
  context: ToolContext
): Promise<ToolResult> {
  if (context.container) {
    // Execute via container
    const result = await context.container.exec([
      '/bin/bash', '-c', args.command
    ], {
      cwd: context.workingDirectory,
      env: context.processEnv
    });
    return this.formatResult(result);
  }

  // Fallback to local execution
  return await this.executeCommand(args.command, context);
}
```

**File operations** work naturally since the session clone is mounted at `/workspace` in the container.

**MCP servers** run on the host but execute commands inside the container via the container exec API. This allows them to maintain their connection to the Agent while still operating on container-isolated files.

### 6. Container Implementation

Primary implementation uses Apple's container framework on macOS, which provides lightweight, fast container isolation:

```typescript
// packages/core/src/containers/apple-container.ts
export class AppleContainer implements Container {
  constructor(private config: ContainerConfig) {}

  async start(): Promise<void> {
    // Pull image if needed
    await exec(`container image pull ${this.config.image}`);

    // Start container with volume mount
    await exec(`container run -d \
      --name lace-session-${this.config.sessionId} \
      -v ${this.config.sessionPath}:${this.config.mountPoint} \
      ${this.config.image}`);
  }

  async exec(command: string[], options?: ExecOptions): Promise<ExecResult> {
    const args = [
      'container', 'exec',
      `lace-session-${this.config.sessionId}`,
      ...command
    ];

    const result = await exec(args.join(' '), {
      cwd: options?.cwd,
      env: options?.env
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode
    };
  }

  async stop(): Promise<void> {
    await exec(`container stop lace-session-${this.config.sessionId}`);
  }

  async isRunning(): Promise<boolean> {
    try {
      const result = await exec(`container inspect lace-session-${this.config.sessionId}`);
      return result.stdout.includes('"Running": true');
    } catch {
      return false;
    }
  }
}
```

### 7. Container Runtime Strategy

Apple Container is the primary runtime for macOS due to its superior performance and native integration:

```typescript
interface Container {
  start(): Promise<void>;
  stop(): Promise<void>;
  exec(command: string[], options?: ExecOptions): Promise<ExecResult>;
  isRunning(): Promise<boolean>;
  cleanup(): Promise<void>; // Added for proper resource management
}

// Runtime priority:
// 1. Apple Container (macOS) - lightweight, fast, native
// 2. MockContainer (development/testing) - for CI and local testing
// Docker is explicitly not supported due to reliability and performance issues
```

## Critical Design Decisions

### Async Cleanup and Orphan Detection

The current `Session.destroy()` is synchronous but container cleanup requires async operations. Solution: Dual-phase cleanup with orphan detection on startup.

```typescript
// In Session class
private _cleanupPromise?: Promise<void>;

destroy(): void {
  if (this._destroyed) {
    return;
  }
  this._destroyed = true;

  // Start async cleanup but don't await
  this._cleanupPromise = this.performAsyncCleanup();

  // Continue with synchronous cleanup
  Session._sessionRegistry.delete(this._sessionId);

  // Stop all agents immediately
  for (const agent of this._agents.values()) {
    agent.stop();
    agent.removeAllListeners();
  }
  this._agents.clear();
}

private async performAsyncCleanup(): Promise<void> {
  try {
    // Stop container and remove session clone
    if (this._containerManager) {
      await this._containerManager.cleanup();
    }

    // Then shutdown MCP servers
    await this._mcpServerManager.shutdown();
  } catch (error) {
    logger.error('Error during async cleanup', { sessionId: this._sessionId, error });
  }
}

// New method for places that can wait
async waitForCleanup(): Promise<void> {
  if (this._cleanupPromise) {
    await this._cleanupPromise;
  }
}

// Orphan cleanup on startup
static async cleanupOrphaned(): Promise<void> {
  const sessions = getPersistence().getAllSessions();
  const activeIds = new Set(Session._sessionRegistry.keys());

  for (const session of sessions) {
    if (!activeIds.has(session.id) && session.status === 'active') {
      try {
        // Clean up orphaned container
        const containerName = `lace-session-${session.id}`;
        await execAsync(`container stop ${containerName} 2>/dev/null`);
        await execAsync(`container rm ${containerName} 2>/dev/null`);

        // Clean up orphaned session clone
        const sessionPath = join(getLaceDir(), 'sessions', `session-${session.id}`);
        if (existsSync(sessionPath)) {
          // Simple rm -rf for clones
          await execAsync(`rm -rf "${sessionPath}"`);
        }
      } catch (error) {
        logger.debug('Orphan cleanup error (expected for non-existent resources)', { error });
      }
    }
  }
}
```

This preserves backward compatibility while ensuring proper cleanup.

### Robust Path Translation

File tools need reliable bidirectional path translation that handles edge cases:

```typescript
// In ContainerManager
class ContainerManager {
  private hostWorkingDir: string;  // e.g., /Users/jesse/project
  private containerWorkingDir = '/workspace';

  translatePath(inputPath: string, direction: 'toContainer' | 'fromContainer'): string {
    // Resolve to absolute path first
    const absPath = path.isAbsolute(inputPath)
      ? inputPath
      : path.resolve(this.hostWorkingDir, inputPath);

    if (direction === 'toContainer') {
      // Validate path is within session workspace
      const realPath = fs.realpathSync(absPath);
      if (!realPath.startsWith(this.hostWorkingDir)) {
        throw new Error(`Path ${inputPath} is outside session workspace`);
      }

      // Convert to container path
      const relative = path.relative(this.hostWorkingDir, realPath);
      return path.posix.join('/workspace', relative.split(path.sep).join('/'));
    } else {
      // Container to host translation
      const containerPath = inputPath.split(path.sep).join('/');
      if (!containerPath.startsWith('/workspace')) {
        // Non-workspace path, likely a system path
        return inputPath;
      }

      const relative = containerPath.slice('/workspace'.length + 1);
      return path.join(this.hostWorkingDir, ...relative.split('/'));
    }
  }
}

// Tools use translation when container is present
// In FileReadTool:
protected async executeValidated(args: { path: string }, context: ToolContext) {
  let targetPath = args.path;

  if (context.container) {
    // Translate path for container
    const manager = await context.agent?.getFullSession()?.getContainerManager();
    if (manager) {
      targetPath = manager.translateToContainerPath(args.path);
    }
  }

  // ... execute with translated path ...
}
```

This ensures file operations work correctly whether in container or on host.

## Implementation Plan

### Phase 1: Foundation (Week 1)

1. **Container wrapper implementation**
   - Create `packages/core/src/containers/apple-container.ts`
   - Implement Container interface
   - Add container CLI command execution

2. **Worktree management**
   - Modify `Session.create()` to create local clone
   - Add session path storage in session metadata
   - Handle git repo initialization

3. **Container lifecycle in Session**
   - Add `getOrStartContainer()` method
   - Parse devcontainer.json configuration
   - Implement container state tracking

### Phase 2: Tool Integration (Week 2)

4. **ToolExecutor modifications**
   - Add container detection logic
   - Implement context modification for container execution
   - Ensure backward compatibility

5. **Tool adaptations**
   - Update BashTool for container execution
   - Adjust file tool paths for container context
   - Configure MCP servers to run in containers

6. **Testing infrastructure**
   - Create container-aware test utilities
   - Add integration tests for containerized execution
   - Ensure tests work with and without containers

### Phase 3: Polish (Week 3)

7. **Lifecycle management**
   - Implement container idle timeout
   - Add container restart on failure
   - Clean up containers on session deletion
   - Handle Docker/VM restart scenarios

8. **Error handling**
   - Graceful fallback when containers unavailable
   - Clear error messages for container issues
   - Recovery strategies for container failures

9. **Configuration and flags**
   - Add `CONTAINERS_ENABLED` feature flag
   - Container runtime detection
   - User-facing configuration options

## Configuration

### Environment Variables

- `LACE_CONTAINERS_ENABLED`: Enable/disable container isolation (default: false initially)
- `LACE_CONTAINER_RUNTIME`: Override detected runtime (apple|docker|podman)
- `LACE_CONTAINER_IDLE_TIMEOUT`: Minutes before stopping idle containers (default: 30)

### Feature Flags

```typescript
// packages/core/src/config/features.ts
export const features = {
  containers: {
    enabled: process.env.LACE_CONTAINERS_ENABLED === 'true',
    runtime: process.env.LACE_CONTAINER_RUNTIME || 'auto',
    idleTimeout: parseInt(process.env.LACE_CONTAINER_IDLE_TIMEOUT || '30')
  }
};
```

## Migration Strategy

1. **Opt-in Beta**: Initially disabled by default
2. **Gradual Rollout**: Enable for new sessions first
3. **Backward Compatibility**: Existing sessions continue working without containers
4. **Migration Tool**: Utility to convert existing sessions to containerized

## Security Considerations

- Containers run with minimal privileges
- No host network access by default
- Volume mounts limited to session clone directory
- Secrets stay in Lace, not passed to containers
- Container images verified before use

## Performance Considerations

- **Startup Time**: ~1-2 seconds for container start (Apple Container)
- **Memory**: ~100MB per container (lightweight VM approach)
- **Disk**: Worktrees share git objects (minimal overhead)
- **CPU**: Near-native performance on Apple Silicon

## Testing Strategy

1. **Unit Tests**: Container wrapper, clone management
2. **Integration Tests**: Tool execution in containers
3. **E2E Tests**: Complete session workflows with containers
4. **Performance Tests**: Container startup time, resource usage
5. **Compatibility Tests**: Different container runtimes

## Success Metrics

- Container startup time < 2 seconds
- Memory overhead < 200MB per session
- Zero data leakage between sessions
- All existing tools work in containers
- No degradation in tool execution speed

## Future Enhancements

1. **Container Templates**: Pre-built containers for common stacks
2. **GPU Support**: Enable GPU access for ML workloads
3. **Remote Containers**: Run containers on remote machines
4. **Container Snapshots**: Save/restore container state
5. **Multi-Runtime Support**: Docker, Podman, Colima fallbacks

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Apple Container instability (beta) | High | Extensive testing, graceful error handling |
| Container startup latency | Medium | Lazy initialization, container reuse |
| Filesystem performance | Medium | Use virtiofs, optimize mounts |
| Resource leaks | High | Orphan detection, cleanup tracking |
| Clone branch conflicts | Low | Session-specific branches |

## Rollback Plan

If containers cause issues:
1. Set `LACE_CONTAINERS_ENABLED=false`
2. Sessions revert to host execution
3. Existing clones remain but aren't used
4. Containers can be manually cleaned up

## Conclusion

Container isolation provides Lace sessions with true workspace separation while maintaining the existing developer experience. By intercepting at the ToolExecutor level and using standard devcontainer configuration, we achieve isolation with minimal code changes and maximum compatibility.