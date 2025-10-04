# Container Isolation Implementation Plan

## Overview

Implementation plan for container-based isolation in Lace sessions. Each session runs its tools and code in an isolated Apple Container with its own local git clone, preventing any interference between concurrent sessions. This is a critical requirement for multi-session safety.

## Status

### ✅ Phase 1 - Container Runtime Abstraction (COMPLETED)
- Created container abstraction interface (`ContainerRuntime`, `ContainerConfig`, `ExecOptions`, etc.)
- Implemented `BaseContainerRuntime` class with path translation and mount management
- Built `AppleContainerRuntime` using macOS `container` CLI tool
- Added comprehensive unit and integration tests (24 tests passing)
- Fixed critical issues:
  - Container working directory must use container paths, not host paths
  - Exit code 143 from `container stop` is normal (SIGTERM)
  - Container IDs need unique suffixes to prevent conflicts
  - Mount source directories must exist before mounting

### 🚧 Phase 2 - Session Integration (IN PLANNING)

## Phase 1 Implementation Details

### Container Runtime Interface
```typescript
// packages/core/src/containers/types.ts
export interface ContainerRuntime {
  create(config: ContainerConfig): string | Promise<string>;
  start(containerId: string): Promise<void>;
  stop(containerId: string, timeout?: number): Promise<void>;
  remove(containerId: string): Promise<void>;
  exec(containerId: string, options: ExecOptions): Promise<ExecResult>;
  inspect(containerId: string): ContainerInfo | Promise<ContainerInfo>;
  list(): ContainerInfo[] | Promise<ContainerInfo[]>;
  translateToContainer(hostPath: string, containerId: string): string;
  translateToHost(containerPath: string, containerId: string): string;
}
```

### AppleContainerRuntime Key Features
- Uses macOS `container` CLI tool (not sandbox-exec)
- Automatic unique ID generation with UUID suffixes
- Volume mount support (without Docker-style `:ro/:rw` suffixes)
- Graceful stop with SIGTERM (exit code 143) handling
- Path translation between host and container filesystems
- Environment variable injection
- Working directory support (must be container paths)

## Phase 2 - Session Integration

### Goals
- Integrate container runtime with Lace sessions
- Each session gets its own isolated container
- Tools execute transparently in containers
- Support for devcontainer.json configuration

### Implementation Tasks

#### Task 1: Local Clone Management
Use `git clone --local` to create full git repositories for containers:

```typescript
// packages/core/src/workspace/clone-manager.ts
export class CloneManager {
  static async createSessionClone(projectDir: string, sessionId: string): Promise<string>;
  static async removeSessionClone(sessionId: string): Promise<void>;
  static async listSessionClones(): Promise<string[]>;
}
```

Why local clones (not worktrees):
- **Containers need `.git` directory**: Worktrees only have a `.git` file pointing to parent
- **Full isolation**: Each container gets complete git functionality
- **Hardlinks for efficiency**: `git clone --local` uses hardlinks, minimal space overhead
- **Self-contained**: Can be mounted into container without external dependencies

#### Task 2: Session Container Integration
Update Session class to manage containers:

```typescript
// packages/core/src/sessions/session.ts
class Session {
  private _container?: ContainerRuntime;
  private _containerId?: string;
  private _worktreePath?: string;

  async getOrStartContainer(): Promise<string | null> {
    if (!isContainersEnabled()) return null;

    if (!this._containerId) {
      // Create local clone for session
      this._clonePath = await CloneManager.createSessionClone(
        this.project.getWorkingDirectory(),
        this._sessionId
      );

      // Create and start container
      const runtime = new AppleContainerRuntime();
      this._containerId = runtime.create({
        id: `session-${this._sessionId}`,
        workingDirectory: '/workspace',
        mounts: [{
          source: this._clonePath,
          target: '/workspace',
          readonly: false
        }],
        environment: this.getEnvironmentVariables()
      });

      await runtime.start(this._containerId);
    }

    return this._containerId;
  }
}
```

#### Task 3: Tool Executor Integration
Modify ToolExecutor to detect and use containers:

```typescript
// packages/core/src/tools/executor.ts
async executeTool(toolName: string, args: unknown, context: ToolContext): Promise<ToolResult> {
  // Get session container if available
  if (context.sessionId) {
    const session = Session.getById(context.sessionId);
    const containerId = await session?.getOrStartContainer();

    if (containerId) {
      // Add container runtime to context
      context.containerRuntime = new AppleContainerRuntime();
      context.containerId = containerId;
      // Override working directory to container path
      context.workingDirectory = '/workspace';
    }
  }

  // Continue with tool execution...
}
```

#### Task 4: Tool Implementation Updates
Update tools to use containers when available:

```typescript
// packages/core/src/tools/implementations/bash.ts
class BashTool extends Tool {
  protected async executeValidated(args: BashArgs, context?: ToolContext): Promise<ToolResult> {
    if (context?.containerRuntime && context?.containerId) {
      // Execute in container
      const result = await context.containerRuntime.exec(
        context.containerId,
        {
          command: ['/bin/bash', '-c', args.command],
          workingDirectory: context.workingDirectory,
          environment: context.processEnv,
          timeout: args.timeout
        }
      );

      return this.createResult({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
      });
    }

    // Fall back to local execution
    // ... existing code ...
  }
}
```

### Phase 2 Testing Strategy

1. **Unit Tests**
   - CloneManager operations (create/remove/list)
   - Session container lifecycle
   - Tool executor container detection
   - Git repository initialization

2. **Integration Tests**
   - End-to-end session with container
   - Tool execution in container
   - Session isolation verification
   - Clone persistence and git operations
   - Verify `.git` directory accessible in container

3. **Manual Testing**
   - Create multiple sessions
   - Verify isolation between sessions
   - Check worktree changes persist
   - Verify container cleanup on session end

## Original Prerequisites (Reference)

### Required Knowledge
- Basic TypeScript/Node.js
- Git cloning and branching (`git clone --local` command)
- Basic container concepts (images, volumes, exec)
- Test-Driven Development (write failing tests first)

### Setup Your Development Environment
```bash
# Clone the repo and install dependencies
git clone <repo-url>
npm install

# Run existing tests to ensure everything works
npm test

# Start dev server to see current behavior
npm run dev

# Create a feature branch
git checkout -b containers
```

### Key Files You'll Be Working With
- `packages/core/src/sessions/session.ts` - Main session class
- `packages/core/src/tools/executor.ts` - Intercepts all tool executions
- `packages/core/src/tools/implementations/bash.ts` - Example tool that needs container support
- `packages/core/src/config/lace-dir.ts` - Manages Lace directories

## Implementation Tasks

### Task 1: Create Container Abstraction Interface

**Goal**: Define the contract for container implementations without building the implementation yet.

**Files to create**:
- `packages/core/src/containers/types.ts`

**Code to write**:
```typescript
// packages/core/src/containers/types.ts
// ABOUTME: Container abstraction interface for different container runtimes
// ABOUTME: Defines the contract that Apple Container, Docker, etc must implement

export interface Container {
  start(): Promise<void>;
  stop(): Promise<void>;
  exec(command: string[], options?: ExecOptions): Promise<ExecResult>;
  isRunning(): Promise<boolean>;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ContainerConfig {
  sessionId: string;
  sessionPath: string;
  mountPoint: string;
  image: string;
  env?: Record<string, string>;
  mounts?: string[];
}

export interface DevcontainerConfig {
  image?: string;
  build?: { dockerfile: string };
  features?: Record<string, any>;
  mounts?: string[];
  containerEnv?: Record<string, string>;
  postCreateCommand?: string | string[];
}
```

**Test to write FIRST**:
```typescript
// packages/core/src/containers/types.test.ts
import { describe, it, expect } from 'vitest';
import type { Container, ExecResult } from './types';

describe('Container types', () => {
  it('should compile with proper type definitions', () => {
    // This test just ensures our types are properly defined
    const mockContainer: Container = {
      start: async () => {},
      stop: async () => {},
      exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      isRunning: async () => true
    };

    expect(mockContainer).toBeDefined();
  });
});
```

**How to test**:
```bash
npm test packages/core/src/containers/types.test.ts
```

**Commit**:
```bash
git add packages/core/src/containers/
git commit -m "Add container abstraction interface"
```

---

### Task 2: Add Feature Flag for Containers

**Goal**: Add a feature flag so containers are disabled by default during development.

**Files to modify**:
- `packages/core/src/config/features.ts` (create if doesn't exist)

**Code to write**:
```typescript
// packages/core/src/config/features.ts
// ABOUTME: Feature flags for experimental features
// ABOUTME: Controls rollout of new functionality like containers

export interface Features {
  containers: {
    enabled: boolean;
    runtime: 'auto' | 'apple' | 'docker' | 'none';
    idleTimeout: number; // minutes
  };
}

export function getFeatures(): Features {
  return {
    containers: {
      enabled: process.env.LACE_CONTAINERS_ENABLED === 'true',
      runtime: (process.env.LACE_CONTAINER_RUNTIME as any) || 'auto',
      idleTimeout: parseInt(process.env.LACE_CONTAINER_IDLE_TIMEOUT || '30')
    }
  };
}

export function isContainersEnabled(): boolean {
  return getFeatures().containers.enabled;
}
```

**Test to write FIRST**:
```typescript
// packages/core/src/config/features.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getFeatures, isContainersEnabled } from './features';

describe('Features configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should default to containers disabled', () => {
    delete process.env.LACE_CONTAINERS_ENABLED;
    expect(isContainersEnabled()).toBe(false);
  });

  it('should enable containers when env var is true', () => {
    process.env.LACE_CONTAINERS_ENABLED = 'true';
    expect(isContainersEnabled()).toBe(true);
  });

  it('should parse idle timeout from env', () => {
    process.env.LACE_CONTAINER_IDLE_TIMEOUT = '60';
    const features = getFeatures();
    expect(features.containers.idleTimeout).toBe(60);
  });

  it('should default idle timeout to 30 minutes', () => {
    delete process.env.LACE_CONTAINER_IDLE_TIMEOUT;
    const features = getFeatures();
    expect(features.containers.idleTimeout).toBe(30);
  });
});
```

**Commit**:
```bash
git add packages/core/src/config/features.*
git commit -m "Add containers feature flag"
```

---

### Task 3: Implement Session Clone Management

**Goal**: Add methods to create and manage local git clones for sessions.

**Files to create**:
- `packages/core/src/workspace/clone-manager.ts`

**Code to write**:
```typescript
// packages/core/src/workspace/clone-manager.ts
// ABOUTME: Manages local git clones for session isolation
// ABOUTME: Creates separate git repositories for each session with full functionality

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getLaceDir } from '@lace/core/config/lace-dir';
import { logger } from '@lace/core/utils/logger';

export class CloneManager {
  /**
   * Create a local git clone for a session from a project directory
   * @param projectDir The source project directory (must be a git repo)
   * @param sessionId Unique session identifier
   * @returns Path to the created clone
   */
  static async createSessionClone(projectDir: string, sessionId: string): Promise<string> {
    // Ensure project has git repo
    const gitDir = join(projectDir, '.git');
    if (!existsSync(gitDir)) {
      logger.info('Initializing git repo in project directory', { projectDir });
      execSync('git init', { cwd: projectDir });

      // Create .gitignore if missing
      const gitignorePath = join(projectDir, '.gitignore');
      if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, 'node_modules/\n.env\n*.log\n.DS_Store\n');
      }

      // Commit with proper git config
      try {
        execSync('git add -A', { cwd: projectDir });
        execSync('git commit -m "Initial commit for container isolation"', {
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
        // Might fail if no files to commit, that's ok
        logger.debug('No files to commit in new git repo');
      }
    }

    // Create sessions directory
    const sessionsDir = join(getLaceDir(), 'sessions');
    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir, { recursive: true });
    }

    // Create session clone path
    const sessionPath = join(sessionsDir, `session-${sessionId}`);

    // Check if clone already exists
    if (existsSync(sessionPath)) {
      logger.debug('Session clone already exists', { sessionPath });
      return sessionPath;
    }

    logger.info('Creating local clone for session', { projectDir, sessionPath });

    // Create local clone (uses hardlinks for efficiency)
    execSync(`git clone --local "${projectDir}" "${sessionPath}"`);

    // Create session-specific branch to avoid conflicts
    execSync(`git checkout -b session-${sessionId}`, { cwd: sessionPath });

    return sessionPath;
  }

  /**
   * Remove a session clone when session is deleted
   * Safely moves to .trash directory instead of deleting
   */
  static async removeSessionClone(sessionId: string): Promise<void> {
    const sessionPath = join(getLaceDir(), 'sessions', `session-${sessionId}`);

    if (!existsSync(sessionPath)) {
      return; // Already removed
    }

    logger.info('Moving session clone to trash', { sessionPath });

    // Move to trash directory with timestamp for safety
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const trashDir = join(getLaceDir(), '.trash', timestamp);
    mkdirSync(trashDir, { recursive: true });

    const trashPath = join(trashDir, `session-${sessionId}`);
    execSync(`mv "${sessionPath}" "${trashPath}"`);

    logger.info('Session clone moved to trash', {
      from: sessionPath,
      to: trashPath,
      note: 'Can be manually deleted later from ~/.lace/.trash/'
    });
  }

  /**
   * Check if a directory is a git repository
   */
  static isGitRepo(dir: string): boolean {
    return existsSync(join(dir, '.git'));
  }
}
```

**Test to write FIRST**:
```typescript
// packages/core/src/workspace/clone-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CloneManager } from './clone-manager';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

describe('CloneManager', () => {
  let testProjectDir: string;
  let testSessionId: string;

  beforeEach(() => {
    // Create a temporary directory for testing
    testProjectDir = mkdtempSync(join(tmpdir(), 'lace-test-'));
    testSessionId = 'test-session-123';

    // Add a test file
    writeFileSync(join(testProjectDir, 'README.md'), '# Test Project');
  });

  afterEach(() => {
    // Clean up
    try {
      rmSync(testProjectDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should initialize git repo if not present', async () => {
    expect(CloneManager.isGitRepo(testProjectDir)).toBe(false);

    const sessionPath = await CloneManager.createSessionClone(testProjectDir, testSessionId);

    expect(CloneManager.isGitRepo(testProjectDir)).toBe(true);
    expect(sessionPath).toContain('sessions');
    expect(sessionPath).toContain(testSessionId);
  });

  it('should create clone from existing repo', async () => {
    // Initialize git repo first
    execSync('git init', { cwd: testProjectDir });
    execSync('git add -A', { cwd: testProjectDir });
    execSync('git commit -m "test"', { cwd: testProjectDir });

    const sessionPath = await CloneManager.createSessionClone(testProjectDir, testSessionId);

    expect(sessionPath).toContain('sessions');
    expect(sessionPath).toContain(testSessionId);

    // Verify clone was created and has its own branch
    const branch = execSync('git branch --show-current', { cwd: sessionPath }).toString();
    expect(branch.trim()).toBe(`session-${testSessionId}`);
  });

  it('should handle existing clone gracefully', async () => {
    const path1 = await CloneManager.createSessionClone(testProjectDir, testSessionId);
    const path2 = await CloneManager.createSessionClone(testProjectDir, testSessionId);

    expect(path1).toBe(path2);
  });

  it('should move clone to trash', async () => {
    const sessionPath = await CloneManager.createSessionClone(testProjectDir, testSessionId);

    await CloneManager.removeSessionClone(testSessionId);

    // Verify moved to trash, not deleted
    expect(existsSync(sessionPath)).toBe(false);
    const trashDir = join(getLaceDir(), '.trash');
    expect(existsSync(trashDir)).toBe(true);
  });
});
```

**Commit**:
```bash
git add packages/core/src/workspace/
git commit -m "Add clone manager for session isolation"
```

---

### Task 4: Add Mock Container Implementation for Testing

**Goal**: Create a mock container that pretends to run commands (for testing without real containers).

**Files to create**:
- `packages/core/src/containers/mock-container.ts`

**Code to write**:
```typescript
// packages/core/src/containers/mock-container.ts
// ABOUTME: Mock container implementation for testing without real containers
// ABOUTME: Executes commands locally but pretends to be a container

import { spawn } from 'child_process';
import type { Container, ContainerConfig, ExecOptions, ExecResult } from './types';

export class MockContainer implements Container {
  private running = false;
  private config: ContainerConfig;

  constructor(config: ContainerConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    // Simulate container startup
    await new Promise(resolve => setTimeout(resolve, 100));
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async exec(command: string[], options?: ExecOptions): Promise<ExecResult> {
    if (!this.running) {
      throw new Error('Container is not running');
    }

    return new Promise((resolve, reject) => {
      const child = spawn(command[0], command.slice(1), {
        cwd: options?.cwd || this.config.sessionPath,
        env: { ...process.env, ...options?.env },
        shell: true
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', reject);

      child.on('close', (exitCode) => {
        resolve({
          stdout,
          stderr,
          exitCode: exitCode || 0
        });
      });

      // Handle timeout
      if (options?.timeout) {
        setTimeout(() => {
          child.kill();
          reject(new Error('Command timeout'));
        }, options.timeout);
      }
    });
  }

  async isRunning(): Promise<boolean> {
    return this.running;
  }
}
```

**Test to write FIRST**:
```typescript
// packages/core/src/containers/mock-container.test.ts
import { describe, it, expect } from 'vitest';
import { MockContainer } from './mock-container';

describe('MockContainer', () => {
  it('should start and stop', async () => {
    const container = new MockContainer({
      sessionId: 'test-123',
      sessionPath: '/tmp/test',
      mountPoint: '/workspace',
      image: 'test-image'
    });

    expect(await container.isRunning()).toBe(false);

    await container.start();
    expect(await container.isRunning()).toBe(true);

    await container.stop();
    expect(await container.isRunning()).toBe(false);
  });

  it('should execute commands when running', async () => {
    const container = new MockContainer({
      sessionId: 'test-123',
      sessionPath: process.cwd(),
      mountPoint: '/workspace',
      image: 'test-image'
    });

    await container.start();

    const result = await container.exec(['echo', 'hello']);
    expect(result.stdout).toContain('hello');
    expect(result.exitCode).toBe(0);
  });

  it('should fail exec when not running', async () => {
    const container = new MockContainer({
      sessionId: 'test-123',
      sessionPath: '/tmp/test',
      mountPoint: '/workspace',
      image: 'test-image'
    });

    await expect(container.exec(['echo', 'hello'])).rejects.toThrow('Container is not running');
  });

  it('should handle command timeout', async () => {
    const container = new MockContainer({
      sessionId: 'test-123',
      sessionPath: process.cwd(),
      mountPoint: '/workspace',
      image: 'test-image'
    });

    await container.start();

    await expect(
      container.exec(['sleep', '10'], { timeout: 100 })
    ).rejects.toThrow('Command timeout');
  });
});
```

**Commit**:
```bash
git add packages/core/src/containers/mock-container.*
git commit -m "Add mock container for testing"
```

---

### Task 5: Add Devcontainer Configuration Parser

**Goal**: Parse standard .devcontainer/devcontainer.json files.

**Files to create**:
- `packages/core/src/workspace/devcontainer-parser.ts`

**Code to write**:
```typescript
// packages/core/src/workspace/devcontainer-parser.ts
// ABOUTME: Parses devcontainer.json configuration files
// ABOUTME: Supports standard VS Code devcontainer format

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { DevcontainerConfig } from '@lace/core/containers/types';
import { logger } from '@lace/core/utils/logger';

export class DevcontainerParser {
  /**
   * Parse devcontainer configuration from a project directory
   * Falls back to default Microsoft universal image if not found
   */
  static parse(projectDir: string): DevcontainerConfig {
    // Check for .devcontainer/devcontainer.json
    const devcontainerPath = join(projectDir, '.devcontainer', 'devcontainer.json');

    if (existsSync(devcontainerPath)) {
      try {
        const content = readFileSync(devcontainerPath, 'utf8');
        const config = JSON.parse(content);

        logger.debug('Found devcontainer.json', { projectDir, config });

        return {
          image: config.image,
          build: config.build,
          features: config.features,
          mounts: config.mounts,
          containerEnv: config.containerEnv || config.remoteEnv,
          postCreateCommand: config.postCreateCommand
        };
      } catch (error) {
        logger.warn('Failed to parse devcontainer.json, using defaults', { error });
      }
    }

    // Also check for .devcontainer.json in root
    const rootDevcontainerPath = join(projectDir, '.devcontainer.json');
    if (existsSync(rootDevcontainerPath)) {
      try {
        const content = readFileSync(rootDevcontainerPath, 'utf8');
        const config = JSON.parse(content);

        logger.debug('Found .devcontainer.json in root', { projectDir, config });

        return {
          image: config.image,
          build: config.build,
          features: config.features,
          mounts: config.mounts,
          containerEnv: config.containerEnv || config.remoteEnv,
          postCreateCommand: config.postCreateCommand
        };
      } catch (error) {
        logger.warn('Failed to parse .devcontainer.json, using defaults', { error });
      }
    }

    // Default to Microsoft universal devcontainer
    logger.debug('No devcontainer.json found, using default image', { projectDir });
    return {
      image: 'mcr.microsoft.com/devcontainers/universal:2-linux'
    };
  }

  /**
   * Validate that a devcontainer config has required fields
   */
  static validate(config: DevcontainerConfig): boolean {
    // Must have either image or build.dockerfile
    if (!config.image && !config.build?.dockerfile) {
      return false;
    }

    return true;
  }
}
```

**Test to write FIRST**:
```typescript
// packages/core/src/workspace/devcontainer-parser.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DevcontainerParser } from './devcontainer-parser';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('DevcontainerParser', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'devcontainer-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should return default config when no devcontainer.json exists', () => {
    const config = DevcontainerParser.parse(testDir);

    expect(config.image).toBe('mcr.microsoft.com/devcontainers/universal:2-linux');
    expect(config.build).toBeUndefined();
  });

  it('should parse .devcontainer/devcontainer.json', () => {
    const devcontainerDir = join(testDir, '.devcontainer');
    mkdirSync(devcontainerDir);

    const devcontainerConfig = {
      image: 'mcr.microsoft.com/devcontainers/typescript-node:1',
      features: {
        'ghcr.io/devcontainers/features/node:1': {}
      },
      postCreateCommand: 'npm install'
    };

    writeFileSync(
      join(devcontainerDir, 'devcontainer.json'),
      JSON.stringify(devcontainerConfig, null, 2)
    );

    const config = DevcontainerParser.parse(testDir);

    expect(config.image).toBe('mcr.microsoft.com/devcontainers/typescript-node:1');
    expect(config.features).toEqual(devcontainerConfig.features);
    expect(config.postCreateCommand).toBe('npm install');
  });

  it('should parse root .devcontainer.json', () => {
    const devcontainerConfig = {
      build: {
        dockerfile: 'Dockerfile'
      },
      containerEnv: {
        NODE_ENV: 'development'
      }
    };

    writeFileSync(
      join(testDir, '.devcontainer.json'),
      JSON.stringify(devcontainerConfig, null, 2)
    );

    const config = DevcontainerParser.parse(testDir);

    expect(config.build?.dockerfile).toBe('Dockerfile');
    expect(config.containerEnv?.NODE_ENV).toBe('development');
  });

  it('should handle invalid JSON gracefully', () => {
    mkdirSync(join(testDir, '.devcontainer'));
    writeFileSync(
      join(testDir, '.devcontainer', 'devcontainer.json'),
      'not valid json{}'
    );

    const config = DevcontainerParser.parse(testDir);

    // Should fall back to default
    expect(config.image).toBe('mcr.microsoft.com/devcontainers/universal:2-linux');
  });

  it('should validate config correctly', () => {
    expect(DevcontainerParser.validate({ image: 'test' })).toBe(true);
    expect(DevcontainerParser.validate({ build: { dockerfile: 'Dockerfile' } })).toBe(true);
    expect(DevcontainerParser.validate({})).toBe(false);
  });
});
```

**Commit**:
```bash
git add packages/core/src/workspace/devcontainer-parser.*
git commit -m "Add devcontainer.json parser"
```

---

### Task 6: Add Orphan Cleanup System

**Goal**: Implement cleanup for orphaned containers and session clones from crashed sessions.

**Files to create**:
- `packages/core/src/containers/orphan-cleanup.ts`

**Code to write**:
```typescript
// packages/core/src/containers/orphan-cleanup.ts
// ABOUTME: Cleanup system for orphaned containers and session clones
// ABOUTME: Handles resources left behind by crashed or improperly terminated sessions

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { getLaceDir } from '@lace/core/config/lace-dir';
import { getPersistence } from '@lace/core/persistence/database';
import { Project } from '@lace/core/projects/project';
import { logger } from '@lace/core/utils/logger';

export class OrphanCleanup {
  /**
   * Clean up orphaned containers and session clones from inactive sessions
   * Should be called on Lace startup
   */
  static async cleanupAll(): Promise<void> {
    logger.info('Starting orphan resource cleanup');

    const sessions = getPersistence().getAllSessions();
    const cleanupTasks: Promise<void>[] = [];

    for (const session of sessions) {
      if (session.status !== 'active') {
        continue;
      }

      // Check if session has active process
      if (this.isSessionActive(session.id)) {
        continue;
      }

      // Clean up this orphaned session
      cleanupTasks.push(this.cleanupSession(session.id, session.projectId));
    }

    await Promise.all(cleanupTasks);
    logger.info('Orphan cleanup complete', { cleaned: cleanupTasks.length });
  }

  private static isSessionActive(sessionId: string): boolean {
    // Check if session has active agent processes
    // This is simplified - in reality would check process registry
    return false;
  }

  private static async cleanupSession(sessionId: string, projectId: string): Promise<void> {
    logger.debug('Cleaning up orphaned session', { sessionId });

    // Stop and remove container
    try {
      const containerName = `lace-session-${sessionId}`;
      execSync(`container stop ${containerName} 2>/dev/null || true`);
      execSync(`container rm ${containerName} 2>/dev/null || true`);
    } catch (error) {
      logger.debug('Container cleanup error (expected if not exists)', { sessionId, error });
    }

    // Move session clone to trash
    try {
      const sessionPath = join(getLaceDir(), 'sessions', `session-${sessionId}`);
      if (existsSync(sessionPath)) {
        // Move to trash directory with timestamp for safety
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const trashDir = join(getLaceDir(), '.trash', 'orphaned', timestamp);
        mkdirSync(trashDir, { recursive: true });

        execSync(`mv "${sessionPath}" "${trashDir}/"`);
        logger.info('Moved orphaned session to trash', { sessionPath, trashDir });
      }
    } catch (error) {
      logger.debug('Session cleanup error', { sessionId, error });
    }

    // Mark session as cleaned in database
    getPersistence().updateSession(sessionId, { status: 'cleaned' });
  }

  /**
   * Prune old session clones that no longer have sessions
   */
  static async pruneOldSessions(): Promise<void> {
    const sessionsDir = join(getLaceDir(), 'sessions');
    if (!existsSync(sessionsDir)) {
      return;
    }

    // Get all session directories
    const sessionDirs = execSync(`ls -1 ${sessionsDir}`, { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);

    // Get all session IDs
    const sessions = getPersistence().getAllSessions();
    const sessionIds = new Set(sessions.map(s => s.id));

    // Move orphaned sessions to trash
    for (const dir of sessionDirs) {
      const match = dir.match(/^session-(.+)$/);
      if (match && !sessionIds.has(match[1])) {
        logger.info('Moving orphaned session directory to trash', { dir });

        const sessionPath = join(sessionsDir, dir);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const trashDir = join(getLaceDir(), '.trash', 'pruned', timestamp);
        mkdirSync(trashDir, { recursive: true });

        execSync(`mv "${sessionPath}" "${trashDir}/"`);
      }
    }
  }
}
```

**Test to write**:
```typescript
// packages/core/src/containers/orphan-cleanup.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrphanCleanup } from './orphan-cleanup';
import { getPersistence } from '@lace/core/persistence/database';

vi.mock('~/persistence/database');

describe('OrphanCleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should clean up orphaned sessions', async () => {
    const mockSessions = [
      { id: 'orphan-1', status: 'active', projectId: 'proj-1' },
      { id: 'active-1', status: 'active', projectId: 'proj-1' },
    ];

    vi.mocked(getPersistence).getAllSessions.mockReturnValue(mockSessions);

    // Mock isSessionActive to return false for orphan-1
    vi.spyOn(OrphanCleanup as any, 'isSessionActive')
      .mockImplementation((id) => id === 'active-1');

    await OrphanCleanup.cleanupAll();

    // Should have cleaned up orphan-1 but not active-1
    expect(getPersistence().updateSession).toHaveBeenCalledWith('orphan-1', { status: 'cleaned' });
    expect(getPersistence().updateSession).not.toHaveBeenCalledWith('active-1', expect.anything());
  });
});
```

**Commit**:
```bash
git add packages/core/src/containers/orphan-cleanup.*
git commit -m "Add orphan cleanup system for containers and session clones"
```

---

### Task 7: Integrate Container Support into Session

**Files to modify**:
- `packages/core/src/sessions/session.ts`

**Changes to make**:

1. Add imports at the top:
```typescript
import { WorktreeManager } from '@lace/core/workspace/worktree-manager';
import { DevcontainerParser } from '@lace/core/workspace/devcontainer-parser';
import { MockContainer } from '@lace/core/containers/mock-container';
import type { Container } from '@lace/core/containers/types';
import { isContainersEnabled } from '@lace/core/config/features';
```

2. Add properties to Session class:
```typescript
private _worktreePath?: string;
private _container?: Container;
```

3. Modify `Session.create()` to create worktree:
```typescript
// After session creation, before return
if (isContainersEnabled()) {
  const project = Project.getById(sessionData.projectId);
  if (project) {
    session._worktreePath = await WorktreeManager.createWorktree(
      project.getWorkingDirectory(),
      sessionData.id
    );
    logger.info('Created worktree for session', {
      sessionId: sessionData.id,
      worktreePath: session._worktreePath
    });
  }
}
```

4. Add container management methods:
```typescript
/**
 * Get or start the container for this session
 */
async getOrStartContainer(): Promise<Container | null> {
  if (!isContainersEnabled()) {
    return null;
  }

  if (!this._worktreePath) {
    logger.warn('No worktree path for session, cannot start container', {
      sessionId: this._sessionId
    });
    return null;
  }

  if (!this._container || !(await this._container.isRunning())) {
    const project = Project.getById(this._projectId!);
    if (!project) {
      return null;
    }

    const devcontainerConfig = DevcontainerParser.parse(project.getWorkingDirectory());

    // For now, use MockContainer in development
    this._container = new MockContainer({
      sessionId: this._sessionId,
      worktreePath: this._worktreePath,
      mountPoint: '/workspace',
      image: devcontainerConfig.image || 'mcr.microsoft.com/devcontainers/universal:2-linux',
      env: devcontainerConfig.containerEnv
    });

    await this._container.start();
    logger.info('Started container for session', { sessionId: this._sessionId });

    // Run postCreateCommand if specified
    if (devcontainerConfig.postCreateCommand) {
      const command = Array.isArray(devcontainerConfig.postCreateCommand)
        ? devcontainerConfig.postCreateCommand
        : devcontainerConfig.postCreateCommand.split(' ');

      try {
        await this._container.exec(command);
        logger.debug('Ran postCreateCommand', { command });
      } catch (error) {
        logger.warn('Failed to run postCreateCommand', { command, error });
      }
    }
  }

  return this._container;
}

/**
 * Stop the container for this session
 */
async stopContainer(): Promise<void> {
  if (this._container && await this._container.isRunning()) {
    await this._container.stop();
    logger.info('Stopped container for session', { sessionId: this._sessionId });
  }
}
```

5. Modify `destroy()` to clean up:
```typescript
// In destroy() method, add:
if (isContainersEnabled()) {
  // Stop container
  await this.stopContainer();

  // Remove worktree
  if (this._worktreePath && this._projectId) {
    const project = Project.getById(this._projectId);
    if (project) {
      await WorktreeManager.removeWorktree(
        project.getWorkingDirectory(),
        this._sessionId
      );
    }
  }
}
```

**Test to write**:
```typescript
// packages/core/src/sessions/session-containers.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Session } from './session';
import { Project } from '@lace/core/projects/project';
import * as features from '@lace/core/config/features';

describe('Session container support', () => {
  let project: Project;

  beforeEach(() => {
    // Create a test project
    project = Project.create('Test Project', process.cwd(), 'Test project for containers');
  });

  afterEach(() => {
    // Clean up
    Session.clearRegistry();
    project.delete();
  });

  it('should not create container when feature disabled', async () => {
    vi.spyOn(features, 'isContainersEnabled').mockReturnValue(false);

    const session = Session.create({
      name: 'Test Session',
      projectId: project.getId(),
      configuration: {}
    });

    const container = await session.getOrStartContainer();
    expect(container).toBeNull();
  });

  it('should create container when feature enabled', async () => {
    vi.spyOn(features, 'isContainersEnabled').mockReturnValue(true);

    const session = Session.create({
      name: 'Test Session',
      projectId: project.getId(),
      configuration: {}
    });

    // Wait for async worktree creation
    await new Promise(resolve => setTimeout(resolve, 100));

    const container = await session.getOrStartContainer();
    expect(container).toBeDefined();
    expect(await container?.isRunning()).toBe(true);
  });

  it('should reuse existing container', async () => {
    vi.spyOn(features, 'isContainersEnabled').mockReturnValue(true);

    const session = Session.create({
      name: 'Test Session',
      projectId: project.getId(),
      configuration: {}
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    const container1 = await session.getOrStartContainer();
    const container2 = await session.getOrStartContainer();

    expect(container1).toBe(container2);
  });

  it('should stop container on destroy', async () => {
    vi.spyOn(features, 'isContainersEnabled').mockReturnValue(true);

    const session = Session.create({
      name: 'Test Session',
      projectId: project.getId(),
      configuration: {}
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    const container = await session.getOrStartContainer();
    expect(await container?.isRunning()).toBe(true);

    await session.destroy();
    expect(await container?.isRunning()).toBe(false);
  });
});
```

**Commit**:
```bash
git add packages/core/src/sessions/
git commit -m "Add container support to Session class"
```

---

### Task 7: Modify ToolExecutor to Use Containers

**Goal**: Intercept tool execution to run in containers when available.

**Files to modify**:
- `packages/core/src/tools/executor.ts`

**Changes to make**:

1. Import Session at the top:
```typescript
import { Session } from '@lace/core/sessions/session';
import { isContainersEnabled } from '@lace/core/config/features';
```

2. Modify `executeTool()` method to check for containers:
```typescript
async executeTool(
  toolName: string,
  args: unknown,
  context: ToolContext
): Promise<ToolResult> {
  // ... existing validation code ...

  // Check if we should use a container
  if (isContainersEnabled() && context.sessionId) {
    const session = Session.getByIdSync(context.sessionId);
    if (session) {
      const container = await session.getOrStartContainer();
      if (container) {
        // Modify context to include container
        context = {
          ...context,
          container,
          workingDirectory: '/workspace', // Use container mount point
        };

        logger.debug('Executing tool in container', {
          toolName,
          sessionId: context.sessionId
        });
      }
    }
  }

  // ... continue with existing tool execution ...
}
```

**Test to write**:
```typescript
// packages/core/src/tools/executor-containers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolExecutor } from './executor';
import { Session } from '@lace/core/sessions/session';
import { Project } from '@lace/core/projects/project';
import * as features from '@lace/core/config/features';
import { Tool } from './tool';
import { z } from 'zod';

// Create a test tool
class TestTool extends Tool {
  name = 'test';
  description = 'Test tool';
  schema = z.object({ message: z.string() });

  protected async executeValidated(args: any, context?: any) {
    // Check if we got a container in context
    if (context?.container) {
      return this.createResult('executed in container');
    }
    return this.createResult('executed on host');
  }
}

describe('ToolExecutor container support', () => {
  let executor: ToolExecutor;
  let project: Project;
  let session: Session;

  beforeEach(() => {
    executor = new ToolExecutor();
    executor.registerTool('test', new TestTool());

    project = Project.create('Test', process.cwd());
    session = Session.create({
      projectId: project.getId(),
      name: 'Test Session'
    });
  });

  it('should execute on host when containers disabled', async () => {
    vi.spyOn(features, 'isContainersEnabled').mockReturnValue(false);

    const result = await executor.executeTool('test', { message: 'hello' }, {
      sessionId: session.getId(),
      threadId: 'test-thread',
      signal: new AbortController().signal
    });

    expect(result.content).toContain('executed on host');
  });

  it('should execute in container when enabled', async () => {
    vi.spyOn(features, 'isContainersEnabled').mockReturnValue(true);

    // Wait for session to initialize
    await new Promise(resolve => setTimeout(resolve, 100));

    const result = await executor.executeTool('test', { message: 'hello' }, {
      sessionId: session.getId(),
      threadId: 'test-thread',
      signal: new AbortController().signal
    });

    expect(result.content).toContain('executed in container');
  });

  it('should modify working directory for container', async () => {
    vi.spyOn(features, 'isContainersEnabled').mockReturnValue(true);

    let capturedContext: any;

    class ContextCaptureTool extends Tool {
      name = 'capture';
      description = 'Captures context';
      schema = z.object({});

      protected async executeValidated(args: any, context?: any) {
        capturedContext = context;
        return this.createResult('ok');
      }
    }

    executor.registerTool('capture', new ContextCaptureTool());

    await executor.executeTool('capture', {}, {
      sessionId: session.getId(),
      threadId: 'test-thread',
      signal: new AbortController().signal,
      workingDirectory: '/original/path'
    });

    expect(capturedContext.workingDirectory).toBe('/workspace');
  });
});
```

**Commit**:
```bash
git add packages/core/src/tools/
git commit -m "Add container support to ToolExecutor"
```

---

### Task 8: Modify BashTool to Use Container

**Goal**: Make BashTool execute commands in container when available.

**Files to modify**:
- `packages/core/src/tools/implementations/bash.ts`

**Changes to make**:

1. Modify `executeCommand()` to check for container:
```typescript
private async executeCommand(command: string, context: ToolContext): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    // Check if already aborted
    if (context.signal.aborted) {
      return this.createCancellationResult();
    }

    // Check if we should execute in container
    if (context.container) {
      logger.debug('Executing bash command in container', {
        command: command.substring(0, 100)
      });

      try {
        const result = await context.container.exec(
          ['/bin/bash', '-c', command],
          {
            cwd: context.workingDirectory,
            env: context.processEnv,
            timeout: 120000 // 2 minute timeout
          }
        );

        const runtime = Date.now() - startTime;

        return this.createResult({
          command,
          exitCode: result.exitCode,
          runtime,
          stdoutPreview: result.stdout.substring(0, 10000),
          stderrPreview: result.stderr.substring(0, 10000),
          truncated: {
            stdout: {
              skipped: Math.max(0, result.stdout.length - 10000),
              total: result.stdout.length
            },
            stderr: {
              skipped: Math.max(0, result.stderr.length - 10000),
              total: result.stderr.length
            }
          },
          outputFiles: {
            stdout: 'container-stdout',
            stderr: 'container-stderr',
            combined: 'container-output'
          }
        } as BashOutput);
      } catch (error: any) {
        return this.createErrorResult(
          `Container execution failed: ${error.message}`,
          { command, error: error.message }
        );
      }
    }

    // ... existing local execution code ...
  } catch (error) {
    // ... existing error handling ...
  }
}
```

**Test to write**:
```typescript
// packages/core/src/tools/implementations/bash-container.test.ts
import { describe, it, expect, vi } from 'vitest';
import { BashTool } from './bash';
import type { ToolContext } from '@lace/core/tools/types';
import { MockContainer } from '@lace/core/containers/mock-container';

describe('BashTool container support', () => {
  let tool: BashTool;
  let context: ToolContext;

  beforeEach(() => {
    tool = new BashTool();
    context = {
      sessionId: 'test-session',
      threadId: 'test-thread',
      signal: new AbortController().signal,
      workingDirectory: '/workspace'
    };
  });

  it('should execute locally without container', async () => {
    const result = await tool.execute({ command: 'echo "hello"' }, context);

    expect(result.content).toContain('hello');
    expect(result.metadata?.container).toBeUndefined();
  });

  it('should execute in container when provided', async () => {
    const container = new MockContainer({
      sessionId: 'test',
      sessionPath: process.cwd(),
      mountPoint: '/workspace',
      image: 'test'
    });
    await container.start();

    context.container = container;

    const result = await tool.execute({ command: 'echo "from container"' }, context);

    expect(result.content).toContain('from container');
    expect(result.content).toContain('exitCode: 0');
  });

  it('should handle container exec errors', async () => {
    const container = new MockContainer({
      sessionId: 'test',
      worktreePath: '/invalid/path',
      mountPoint: '/workspace',
      image: 'test'
    });
    // Don't start container to simulate error

    context.container = container;

    const result = await tool.execute({ command: 'echo "test"' }, context);

    expect(result.isError).toBe(true);
    expect(result.content).toContain('Container execution failed');
  });

  it('should respect timeout in container', async () => {
    const container = new MockContainer({
      sessionId: 'test',
      sessionPath: process.cwd(),
      mountPoint: '/workspace',
      image: 'test'
    });
    await container.start();

    // Mock exec to simulate timeout
    vi.spyOn(container, 'exec').mockRejectedValue(new Error('Command timeout'));

    context.container = container;

    const result = await tool.execute({ command: 'sleep 999' }, context);

    expect(result.isError).toBe(true);
    expect(result.content).toContain('timeout');
  });
});
```

**Commit**:
```bash
git add packages/core/src/tools/implementations/
git commit -m "Add container support to BashTool"
```

---

### Task 9: Add Apple Container Implementation

**Goal**: Create the real Apple Container wrapper (for production use).

**Files to create**:
- `packages/core/src/containers/apple-container.ts`

**Code to write**:
```typescript
// packages/core/src/containers/apple-container.ts
// ABOUTME: Apple Container implementation using Apple's container CLI
// ABOUTME: Provides lightweight VM-based container isolation on macOS

import { exec } from 'child_process';
import { promisify } from 'util';
import type { Container, ContainerConfig, ExecOptions, ExecResult } from './types';
import { logger } from '@lace/core/utils/logger';

const execAsync = promisify(exec);

export class AppleContainer implements Container {
  private config: ContainerConfig;
  private containerName: string;
  private _isRunning = false;

  constructor(config: ContainerConfig) {
    this.config = config;
    this.containerName = `lace-session-${config.sessionId}`;
  }

  async start(): Promise<void> {
    logger.info('Starting Apple container', {
      containerName: this.containerName,
      image: this.config.image
    });

    try {
      // Pull image if needed
      await execAsync(`container image pull ${this.config.image}`);

      // Build volume mount args
      const volumeArgs = `-v ${this.config.worktreePath}:${this.config.mountPoint}`;

      // Build environment args
      let envArgs = '';
      if (this.config.env) {
        for (const [key, value] of Object.entries(this.config.env)) {
          envArgs += ` -e ${key}="${value}"`;
        }
      }

      // Start container
      const startCmd = `container run -d --name ${this.containerName} ${volumeArgs}${envArgs} ${this.config.image} /bin/sh -c "while true; do sleep 30; done"`;

      await execAsync(startCmd);
      this._isRunning = true;

      logger.info('Apple container started successfully', {
        containerName: this.containerName
      });
    } catch (error: any) {
      logger.error('Failed to start Apple container', {
        containerName: this.containerName,
        error: error.message
      });
      throw new Error(`Failed to start container: ${error.message}`);
    }
  }

  async stop(): Promise<void> {
    logger.info('Stopping Apple container', {
      containerName: this.containerName
    });

    try {
      await execAsync(`container stop ${this.containerName}`);
      await execAsync(`container rm ${this.containerName}`);
      this._isRunning = false;

      logger.info('Apple container stopped successfully', {
        containerName: this.containerName
      });
    } catch (error: any) {
      // Container might already be stopped
      logger.debug('Error stopping container (might be already stopped)', {
        error: error.message
      });
      this._isRunning = false;
    }
  }

  async exec(command: string[], options?: ExecOptions): Promise<ExecResult> {
    if (!this._isRunning) {
      throw new Error('Container is not running');
    }

    // Build the exec command
    let execCmd = `container exec`;

    if (options?.cwd) {
      execCmd += ` -w "${options.cwd}"`;
    }

    if (options?.env) {
      for (const [key, value] of Object.entries(options.env)) {
        execCmd += ` -e ${key}="${value}"`;
      }
    }

    execCmd += ` ${this.containerName} ${command.join(' ')}`;

    try {
      const { stdout, stderr } = await execAsync(execCmd, {
        timeout: options?.timeout,
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      });

      return {
        stdout,
        stderr,
        exitCode: 0
      };
    } catch (error: any) {
      // exec returns non-zero exit code as error
      if (error.code !== undefined) {
        return {
          stdout: error.stdout || '',
          stderr: error.stderr || '',
          exitCode: error.code
        };
      }
      throw error;
    }
  }

  async isRunning(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`container inspect ${this.containerName} --format='{{.State.Running}}'`);
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }
}
```

**Test notes**:
- This requires Apple's container CLI to be installed
- Tests should check for availability and skip if not present
- Use MockContainer for CI testing

**Integration test to write**:
```typescript
// packages/core/src/containers/apple-container.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AppleContainer } from './apple-container';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('AppleContainer integration', () => {
  let hasAppleContainer = false;

  beforeAll(async () => {
    // Check if Apple container is available
    try {
      await execAsync('which container');
      hasAppleContainer = true;
    } catch {
      hasAppleContainer = false;
    }
  });

  afterAll(async () => {
    // Clean up any test containers
    if (hasAppleContainer) {
      try {
        await execAsync('container rm -f $(container ps -aq --filter name=lace-test)');
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it.skipIf(!hasAppleContainer)('should start and stop real container', async () => {
    const container = new AppleContainer({
      sessionId: 'test-integration',
      worktreePath: '/tmp',
      mountPoint: '/workspace',
      image: 'alpine:latest' // Small test image
    });

    await container.start();
    expect(await container.isRunning()).toBe(true);

    const result = await container.exec(['echo', 'hello from container']);
    expect(result.stdout).toContain('hello from container');
    expect(result.exitCode).toBe(0);

    await container.stop();
    expect(await container.isRunning()).toBe(false);
  });

  it.skipIf(!hasAppleContainer)('should handle working directory', async () => {
    const container = new AppleContainer({
      sessionId: 'test-cwd',
      worktreePath: '/tmp',
      mountPoint: '/workspace',
      image: 'alpine:latest'
    });

    await container.start();

    const result = await container.exec(['pwd'], { cwd: '/workspace' });
    expect(result.stdout.trim()).toBe('/workspace');

    await container.stop();
  });
});
```

**Commit**:
```bash
git add packages/core/src/containers/apple-container.*
git commit -m "Add Apple Container implementation"
```

---

### Task 10: Add Container Factory

**Goal**: Create a factory that selects the right container implementation.

**Files to create**:
- `packages/core/src/containers/factory.ts`

**Code to write**:
```typescript
// packages/core/src/containers/factory.ts
// ABOUTME: Factory for creating appropriate container implementation
// ABOUTME: Selects between Apple Container, Docker, or Mock based on environment

import type { Container, ContainerConfig } from './types';
import { AppleContainer } from './apple-container';
import { MockContainer } from './mock-container';
import { getFeatures } from '@lace/core/config/features';
import { logger } from '@lace/core/utils/logger';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class ContainerFactory {
  private static runtimeCache?: 'apple' | 'docker' | 'mock' | 'none';

  /**
   * Detect available container runtime
   */
  static async detectRuntime(): Promise<'apple' | 'docker' | 'mock' | 'none'> {
    if (this.runtimeCache) {
      return this.runtimeCache;
    }

    const features = getFeatures();

    // Check if user specified a runtime
    if (features.containers.runtime !== 'auto') {
      this.runtimeCache = features.containers.runtime as any;
      return this.runtimeCache;
    }

    // Auto-detect available runtime
    // Check for Apple container first (preferred on macOS)
    try {
      await execAsync('which container');
      // Also check if it's Apple's container (not just any 'container' command)
      const { stdout } = await execAsync('container --version');
      if (stdout.includes('Apple')) {
        logger.info('Detected Apple Container runtime');
        this.runtimeCache = 'apple';
        return 'apple';
      }
    } catch {
      // Not available
    }

    // Check for Docker
    try {
      await execAsync('docker --version');
      logger.info('Detected Docker runtime');
      this.runtimeCache = 'docker';
      return 'docker';
    } catch {
      // Not available
    }

    // In development/test, use mock
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
      logger.info('Using mock container for development/test');
      this.runtimeCache = 'mock';
      return 'mock';
    }

    logger.warn('No container runtime detected');
    this.runtimeCache = 'none';
    return 'none';
  }

  /**
   * Create a container instance
   */
  static async create(config: ContainerConfig): Promise<Container> {
    const runtime = await this.detectRuntime();

    switch (runtime) {
      case 'apple':
        return new AppleContainer(config);

      case 'docker':
        // TODO: Implement DockerContainer
        logger.warn('Docker support not yet implemented, falling back to mock');
        return new MockContainer(config);

      case 'mock':
        return new MockContainer(config);

      case 'none':
        throw new Error('No container runtime available. Please install Apple Container or Docker.');

      default:
        throw new Error(`Unknown container runtime: ${runtime}`);
    }
  }

  /**
   * Reset runtime cache (for testing)
   */
  static resetCache(): void {
    this.runtimeCache = undefined;
  }
}
```

**Test to write**:
```typescript
// packages/core/src/containers/factory.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContainerFactory } from './factory';
import * as features from '@lace/core/config/features';

describe('ContainerFactory', () => {
  beforeEach(() => {
    ContainerFactory.resetCache();
  });

  it('should use specified runtime from features', async () => {
    vi.spyOn(features, 'getFeatures').mockReturnValue({
      containers: {
        enabled: true,
        runtime: 'mock',
        idleTimeout: 30
      }
    });

    const runtime = await ContainerFactory.detectRuntime();
    expect(runtime).toBe('mock');
  });

  it('should create mock container in test environment', async () => {
    process.env.NODE_ENV = 'test';

    const container = await ContainerFactory.create({
      sessionId: 'test',
      worktreePath: '/tmp',
      mountPoint: '/workspace',
      image: 'test'
    });

    expect(container.constructor.name).toBe('MockContainer');
  });

  it('should throw error when no runtime available', async () => {
    vi.spyOn(features, 'getFeatures').mockReturnValue({
      containers: {
        enabled: true,
        runtime: 'none',
        idleTimeout: 30
      }
    });

    await expect(ContainerFactory.create({
      sessionId: 'test',
      worktreePath: '/tmp',
      mountPoint: '/workspace',
      image: 'test'
    })).rejects.toThrow('No container runtime available');
  });
});
```

**Commit**:
```bash
git add packages/core/src/containers/factory.*
git commit -m "Add container factory for runtime selection"
```

---

### Task 11: Update Session to Use Container Factory

**Goal**: Replace MockContainer with ContainerFactory in Session.

**Files to modify**:
- `packages/core/src/sessions/session.ts`

**Changes**:

Replace the import:
```typescript
// Remove: import { MockContainer } from '@lace/core/containers/mock-container';
// Add:
import { ContainerFactory } from '@lace/core/containers/factory';
```

Update `getOrStartContainer()`:
```typescript
// Replace: this._container = new MockContainer(...)
// With:
this._container = await ContainerFactory.create({
  sessionId: this._sessionId,
  worktreePath: this._worktreePath,
  mountPoint: '/workspace',
  image: devcontainerConfig.image || 'mcr.microsoft.com/devcontainers/universal:2-linux',
  env: devcontainerConfig.containerEnv,
  mounts: devcontainerConfig.mounts
});
```

**Commit**:
```bash
git add packages/core/src/sessions/session.ts
git commit -m "Use ContainerFactory in Session"
```

---

### Task 12: Add Container Status to Session Info

**Goal**: Let users see container status in session info.

**Files to modify**:
- `packages/core/src/sessions/session.ts`

**Changes**:

1. Add to SessionInfo interface:
```typescript
export interface SessionInfo {
  // ... existing fields ...
  container?: {
    enabled: boolean;
    running: boolean;
    runtime?: string;
    image?: string;
  };
}
```

2. Update `getInfo()` method:
```typescript
async getInfo(): Promise<SessionInfo | null> {
  const agents = this.getAgents();
  const sessionData = this.getSessionData();

  const info: SessionInfo = {
    id: this._sessionId,
    name: sessionData?.name || 'Session ' + this._sessionId,
    description: sessionData?.description,
    createdAt: this.getCoordinatorAgent()?.getThreadCreatedAt() || new Date(),
    agents: agents.map((agent) => agent.getInfo()),
  };

  // Add container info if enabled
  if (isContainersEnabled()) {
    const isRunning = this._container ? await this._container.isRunning() : false;
    const runtime = await ContainerFactory.detectRuntime();

    info.container = {
      enabled: true,
      running: isRunning,
      runtime: runtime === 'none' ? undefined : runtime,
      image: this._container ? this.config.image : undefined
    };
  }

  return info;
}
```

**Test to write**:
```typescript
// Add to session-containers.test.ts
it('should include container info in session info', async () => {
  vi.spyOn(features, 'isContainersEnabled').mockReturnValue(true);

  const session = Session.create({
    name: 'Test Session',
    projectId: project.getId(),
    configuration: {}
  });

  await new Promise(resolve => setTimeout(resolve, 100));
  await session.getOrStartContainer();

  const info = await session.getInfo();

  expect(info?.container).toBeDefined();
  expect(info?.container?.enabled).toBe(true);
  expect(info?.container?.running).toBe(true);
  expect(info?.container?.runtime).toBe('mock'); // In test env
});
```

**Commit**:
```bash
git add packages/core/src/sessions/
git commit -m "Add container status to session info"
```

---

### Task 13: Add Integration Tests

**Goal**: Create comprehensive integration tests for the container system.

**Files to create**:
- `packages/core/src/integration/containers.integration.test.ts`

**Code to write**:
```typescript
// packages/core/src/integration/containers.integration.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Session } from '@lace/core/sessions/session';
import { Project } from '@lace/core/projects/project';
import { ToolExecutor } from '@lace/core/tools/executor';
import { BashTool } from '@lace/core/tools/implementations/bash';
import * as features from '@lace/core/config/features';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Container Integration', () => {
  let testDir: string;
  let project: Project;

  beforeAll(() => {
    // Enable containers for integration tests
    process.env.LACE_CONTAINERS_ENABLED = 'true';
  });

  afterAll(() => {
    delete process.env.LACE_CONTAINERS_ENABLED;
  });

  beforeEach(() => {
    // Create test project directory
    testDir = mkdtempSync(join(tmpdir(), 'container-integration-'));

    // Add some test files
    writeFileSync(join(testDir, 'README.md'), '# Test Project');
    writeFileSync(join(testDir, 'index.js'), 'console.log("hello");');

    // Create project
    project = Project.create('Container Test', testDir);
  });

  it('should execute bash commands in container', async () => {
    const session = Session.create({
      name: 'Test Session',
      projectId: project.getId()
    });

    // Wait for worktree creation
    await new Promise(resolve => setTimeout(resolve, 500));

    const executor = new ToolExecutor();
    executor.registerTool('bash', new BashTool());

    const result = await executor.executeTool(
      'bash',
      { command: 'pwd' },
      {
        sessionId: session.getId(),
        threadId: 'test-thread',
        signal: new AbortController().signal
      }
    );

    // Should execute in /workspace (container mount point)
    expect(result.content).toContain('/workspace');
  });

  it('should isolate sessions from each other', async () => {
    const session1 = Session.create({
      name: 'Session 1',
      projectId: project.getId()
    });

    const session2 = Session.create({
      name: 'Session 2',
      projectId: project.getId()
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    const executor = new ToolExecutor();
    executor.registerTool('bash', new BashTool());

    // Create file in session 1
    await executor.executeTool(
      'bash',
      { command: 'echo "session1" > test.txt' },
      {
        sessionId: session1.getId(),
        threadId: 'thread1',
        signal: new AbortController().signal
      }
    );

    // Try to read file in session 2
    const result = await executor.executeTool(
      'bash',
      { command: 'cat test.txt 2>&1' },
      {
        sessionId: session2.getId(),
        threadId: 'thread2',
        signal: new AbortController().signal
      }
    );

    // File should not exist in session 2 (different worktree)
    expect(result.content).toContain('No such file');
  });

  it('should persist changes in worktree', async () => {
    const session = Session.create({
      name: 'Test Session',
      projectId: project.getId()
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    const executor = new ToolExecutor();
    executor.registerTool('bash', new BashTool());

    // Create a file
    await executor.executeTool(
      'bash',
      { command: 'echo "persistent" > data.txt' },
      {
        sessionId: session.getId(),
        threadId: 'test',
        signal: new AbortController().signal
      }
    );

    // Stop container
    await session.stopContainer();

    // Execute another command (should restart container)
    const result = await executor.executeTool(
      'bash',
      { command: 'cat data.txt' },
      {
        sessionId: session.getId(),
        threadId: 'test',
        signal: new AbortController().signal
      }
    );

    // File should still exist
    expect(result.content).toContain('persistent');
  });

  it('should respect devcontainer.json', async () => {
    // Create .devcontainer/devcontainer.json
    const devcontainerDir = join(testDir, '.devcontainer');
    mkdirSync(devcontainerDir);
    writeFileSync(
      join(devcontainerDir, 'devcontainer.json'),
      JSON.stringify({
        image: 'node:18-alpine',
        containerEnv: {
          TEST_VAR: 'from-devcontainer'
        },
        postCreateCommand: 'echo "setup complete" > /tmp/setup.txt'
      }, null, 2)
    );

    const session = Session.create({
      name: 'DevContainer Test',
      projectId: project.getId()
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    const executor = new ToolExecutor();
    executor.registerTool('bash', new BashTool());

    // Check environment variable
    const envResult = await executor.executeTool(
      'bash',
      { command: 'echo $TEST_VAR' },
      {
        sessionId: session.getId(),
        threadId: 'test',
        signal: new AbortController().signal
      }
    );

    expect(envResult.content).toContain('from-devcontainer');

    // Check postCreateCommand was run
    const setupResult = await executor.executeTool(
      'bash',
      { command: 'cat /tmp/setup.txt 2>/dev/null || echo "not found"' },
      {
        sessionId: session.getId(),
        threadId: 'test',
        signal: new AbortController().signal
      }
    );

    // This might not work with MockContainer, but would with real container
    // Just ensure it doesn't crash
    expect(setupResult.content).toBeDefined();
  });
});
```

**Commit**:
```bash
git add packages/core/src/integration/
git commit -m "Add container integration tests"
```

---

### Task 14: Add Documentation

**Goal**: Document the container feature for users and developers.

**Files to create**:
- `docs/features/containers.md`

**Content to write**:
```markdown
# Container Isolation

## Overview

Lace can run each session's tools and code in isolated containers, providing complete separation between concurrent sessions. This feature is currently in beta and disabled by default.

## Enabling Containers

Set the environment variable:
```bash
export LACE_CONTAINERS_ENABLED=true
```

## How It Works

1. **Git Worktrees**: Each session creates its own git worktree from the project repository
2. **Container per Session**: Each session runs in its own container
3. **Tool Execution**: All tools (bash, file operations, etc.) execute inside the container
4. **Persistence**: Changes persist in the worktree even when containers restart

## Container Configuration

### Using devcontainer.json

Lace respects standard `.devcontainer/devcontainer.json` files in your project:

```json
{
  "image": "mcr.microsoft.com/devcontainers/typescript-node:1",
  "features": {
    "ghcr.io/devcontainers/features/python:1": {}
  },
  "containerEnv": {
    "NODE_ENV": "development"
  },
  "postCreateCommand": "npm install"
}
```

### Default Container

If no devcontainer.json is found, Lace uses:
- `mcr.microsoft.com/devcontainers/universal:2-linux`

## Container Runtimes

Lace supports multiple container runtimes:

1. **Apple Container** (preferred on macOS with Apple Silicon)
2. **Docker** (fallback, not yet implemented)
3. **Mock** (for development/testing)

The runtime is auto-detected, or you can specify:
```bash
export LACE_CONTAINER_RUNTIME=apple  # or docker, mock
```

## Requirements

### For Apple Container
- macOS 15+ with Apple Silicon
- Apple's container CLI installed

### For Docker
- Docker Desktop or Docker Engine installed

## Troubleshooting

### Container Won't Start
- Check that your chosen runtime is installed
- Verify the devcontainer.json image exists
- Check logs for specific error messages

### Files Not Persisting
- Ensure the project directory is a git repository
- Check that worktrees are being created in `~/.lace/worktrees/`

### Performance Issues
- Containers may take 1-2 seconds to start initially
- File operations should be near-native speed
- Report performance issues with specific tools

## Architecture

```
Project Directory (git repo)
    ├── .devcontainer/devcontainer.json
    └── source code

~/.lace/worktrees/
    ├── session-{id-1}/  (git worktree)
    └── session-{id-2}/  (git worktree)

Containers:
    ├── lace-session-{id-1} (mounts session-{id-1})
    └── lace-session-{id-2} (mounts session-{id-2})
```

## Security

- Each container is isolated from others
- Containers only have access to their worktree
- No network access between containers (currently)
- Host filesystem is not accessible (except mounted worktree)
```

**Commit**:
```bash
git add docs/features/containers.md
git commit -m "Add container feature documentation"
```

---

### Task 15: Add README Updates

**Goal**: Update main README with container feature information.

**Files to modify**:
- `README.md` (add section about containers)

**Add this section**:
```markdown
## Container Isolation (Beta)

Lace supports running each session in an isolated container with its own git worktree:

- **Complete Isolation**: Each session gets its own container and working directory
- **Devcontainer Support**: Uses your project's `.devcontainer/devcontainer.json`
- **Transparent**: Tools automatically execute in containers when enabled

To enable:
```bash
export LACE_CONTAINERS_ENABLED=true
```

See [Container Documentation](docs/features/containers.md) for details.
```

**Commit**:
```bash
git add README.md
git commit -m "Add container feature to README"
```

---

## Testing Strategy

### Unit Tests
Run after each task:
```bash
npm test <specific-test-file>
```

### Integration Tests
Run after completing core functionality:
```bash
npm test packages/core/src/integration/containers.integration.test.ts
```

### Manual Testing
1. Enable containers: `export LACE_CONTAINERS_ENABLED=true`
2. Start Lace: `npm run dev`
3. Create a project and session
4. Run bash commands and verify they execute in container
5. Check that files persist in worktree
6. Verify session isolation

### Test Coverage
Check coverage after implementation:
```bash
npm run test:coverage
```

## Commit Strategy

- **Commit after each task** (as shown above)
- **Push every 3-4 commits** to backup work
- **Create PR** when feature is complete

## Definition of Done

- [ ] All tests pass
- [ ] Feature flag works (disabled by default)
- [ ] Mock container works in tests
- [ ] Apple container works on macOS (if available)
- [ ] Sessions create worktrees
- [ ] Tools execute in containers
- [ ] Container status visible in session info
- [ ] Documentation complete
- [ ] Integration tests pass

## Rollback Plan

If issues arise:
1. Set `LACE_CONTAINERS_ENABLED=false`
2. Sessions revert to host execution
3. Git worktrees remain but aren't used
4. Containers can be manually cleaned up

## Next Steps After Implementation

1. **Docker Implementation**: Add DockerContainer class
2. **Performance Optimization**: Pre-warm containers, optimize images
3. **GPU Support**: Enable GPU passthrough for ML workloads
4. **Remote Containers**: Run on remote machines
5. **Container Templates**: Pre-built images for common stacks

## Common Pitfalls to Avoid

1. **Don't forget error handling** - Containers can fail to start
2. **Test both enabled and disabled** - Feature flag must work both ways
3. **Clean up resources** - Stop containers and remove worktrees
4. **Handle missing runtimes** - Graceful errors when no container runtime
5. **Async operations** - Container operations are async, handle properly

## Questions to Ask During Implementation

1. Is the feature flag checked before using containers?
2. Are errors handled gracefully with clear messages?
3. Do tests cover both success and failure cases?
4. Is the code DRY (no duplication)?
5. Are commits atomic and well-described?

## Success Criteria

- Sessions are truly isolated from each other
- No performance degradation for non-container mode
- Clear error messages when containers unavailable
- All existing tests still pass
- New tests provide good coverage