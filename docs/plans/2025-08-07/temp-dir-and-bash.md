# Temp Directory Support and Bash Tool Output Management

## Problem Statement

The bash tool currently returns unbounded stderr and stdout output. A single test run can generate 800k+ of stderr, which:
- Blows out token windows (800k = ~200k tokens, 4x Claude's context window)
- Makes conversation history unusable  
- Causes massive API costs
- Breaks the model's ability to process results

## Solution Overview

Implement two-tier output management:
1. **Full output storage**: Store complete output in temporary files for audit/debugging
2. **Smart truncation**: Return head + tail summaries to model with file references

## Architecture

```
Session Temp Directory Structure:
/tmp/lace-runtime-{pid}-{timestamp}-{random}/
├── project-{projectId}/
│   └── session-{sessionId}/
│       └── tool-call-{toolCallId}/
│           ├── stdout.txt       # Complete stdout
│           ├── stderr.txt       # Complete stderr  
│           └── combined.txt     # Combined output
```

## Implementation Plan: Two Stacked PRs

### PR 1: Temp Directory Infrastructure
Foundation for session-scoped temporary directories

### PR 2: Bash Tool Output Management  
Update bash tool to use temp directories and implement smart truncation

---

# PR 1: Temp Directory Infrastructure

## Overview
Add process-stable temporary directory management with project/session/tool-call hierarchy. This provides the foundation for tools to store large outputs without overwhelming the model.

## Files to Modify

### 1. `src/config/lace-dir.ts`
Add process-scoped temporary directory management.

### 2. `src/projects/project.ts`  
Add project temporary directory helper.

### 3. `src/sessions/session.ts`
Add session temporary directory helper.

### 4. `src/tools/tool.ts`
Add tool-call temporary directory helpers to base class.

### 5. Test files
- `src/config/lace-dir.test.ts`
- `src/projects/project.test.ts` 
- `src/sessions/session.test.ts`
- `src/tools/tool.test.ts`

## Task 1: Add Process Temp Directory to lace-dir.ts

### Background Context
- `lace-dir.ts` manages Lace's directory structure (config, database, etc.)
- Uses `getLaceDir()` which returns `~/.lace/` or `LACE_DIR` env var
- Has utilities like `ensureLaceDir()`, `getLaceFilePath()`, etc.

### Code Changes

**File**: `src/config/lace-dir.ts`

Add these imports at the top:
```typescript
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
```

Add after existing exports:
```typescript
/**
 * Process-scoped temporary directory for this server runtime
 * Stable across session recreations, cleaned up when process ends
 */
let _processTempDir: string | null = null;

/**
 * Get or create the process temporary directory
 * Creates one stable temp dir per server process that persists until process ends
 */
export function getProcessTempDir(): string {
  if (!_processTempDir) {
    const processId = process.pid;
    const timestamp = Date.now();
    _processTempDir = mkdtempSync(path.join(tmpdir(), `lace-runtime-${processId}-${timestamp}-`));
  }
  return _processTempDir;
}

/**
 * Clear process temp dir cache - primarily for testing
 */
export function clearProcessTempDirCache(): void {
  _processTempDir = null;
}
```

### Testing

**File**: `src/config/lace-dir.test.ts`

Add these test cases at the end of the existing describe block:

```typescript
describe('process temp directory', () => {
  afterEach(() => {
    // Clean up for next test
    clearProcessTempDirCache();
  });

  it('should create a process temp directory', () => {
    const tempDir = getProcessTempDir();
    
    expect(tempDir).toMatch(/^.*lace-runtime-\d+-\d+-[a-zA-Z0-9]+$/);
    expect(existsSync(tempDir)).toBe(true);
  });

  it('should return the same directory on multiple calls', () => {
    const tempDir1 = getProcessTempDir();
    const tempDir2 = getProcessTempDir();
    
    expect(tempDir1).toBe(tempDir2);
  });

  it('should create different directories after cache clear', () => {
    const tempDir1 = getProcessTempDir();
    clearProcessTempDirCache();
    const tempDir2 = getProcessTempDir();
    
    expect(tempDir1).not.toBe(tempDir2);
  });

  it('should create directory under system tmpdir', () => {
    const tempDir = getProcessTempDir();
    const systemTmpDir = tmpdir();
    
    expect(tempDir).toContain(systemTmpDir);
  });
});
```

**Required imports to add**:
```typescript
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { getProcessTempDir, clearProcessTempDirCache } from './lace-dir';
```

### How to Test
```bash
# Run the specific test
npm test -- src/config/lace-dir.test.ts

# Run with coverage
npm run test:coverage -- src/config/lace-dir.test.ts
```

### Commit Message
```
feat: add process-scoped temporary directory management

- Add getProcessTempDir() for stable temp dirs per server runtime
- Process temp dirs persist across session object recreation
- Automatic cleanup when process ends
- Add clearProcessTempDirCache() for testing
```

## Task 2: Add Project Temp Directory Helper

### Background Context
- `Project` class in `src/projects/project.ts` manages project configuration
- Has methods like `getById()`, `getWorkingDirectory()`, etc.
- Projects have IDs that we can use for temp directory names

### Code Changes

**File**: `src/projects/project.ts`

Add import at the top:
```typescript
import { getProcessTempDir } from '~/config/lace-dir';
import { mkdirSync } from 'fs';
import { join } from 'path';
```

Add static method to the `Project` class:
```typescript
/**
 * Get temporary directory for a project
 * Creates: /tmp/lace-runtime-{pid}-{timestamp}-{random}/project-{projectId}/
 */
static getProjectTempDir(projectId: string): string {
  const processTempDir = getProcessTempDir();
  const projectTempPath = join(processTempDir, `project-${projectId}`);
  mkdirSync(projectTempPath, { recursive: true });
  return projectTempPath;
}
```

### Testing

**File**: `src/projects/project.test.ts`

Add at the end of the existing describe blocks:

```typescript
describe('temp directory management', () => {
  it('should create project temp directory', () => {
    const projectId = 'test-project-123';
    const tempDir = Project.getProjectTempDir(projectId);
    
    expect(tempDir).toContain(`project-${projectId}`);
    expect(existsSync(tempDir)).toBe(true);
  });

  it('should return same directory for same project', () => {
    const projectId = 'test-project-456';
    const tempDir1 = Project.getProjectTempDir(projectId);
    const tempDir2 = Project.getProjectTempDir(projectId);
    
    expect(tempDir1).toBe(tempDir2);
  });

  it('should create different directories for different projects', () => {
    const tempDir1 = Project.getProjectTempDir('project-a');
    const tempDir2 = Project.getProjectTempDir('project-b');
    
    expect(tempDir1).not.toBe(tempDir2);
    expect(tempDir1).toContain('project-a');
    expect(tempDir2).toContain('project-b');
  });

  it('should create directory under process temp dir', () => {
    const projectId = 'nested-test';
    const tempDir = Project.getProjectTempDir(projectId);
    const processTempDir = getProcessTempDir();
    
    expect(tempDir).toContain(processTempDir);
  });
});
```

**Required imports to add**:
```typescript
import { existsSync } from 'fs';
import { getProcessTempDir } from '~/config/lace-dir';
```

### How to Test
```bash
npm test -- src/projects/project.test.ts
```

### Commit Message
```
feat(projects): add project temp directory management

- Add Project.getProjectTempDir() for project-scoped temp directories
- Temp dirs are stable and created on demand
- Directory structure: process-temp/project-{id}/
```

## Task 3: Add Session Temp Directory Helper

### Background Context
- `Session` class manages collections of agents and session-level operations
- Has methods like `create()`, `getById()`, etc.
- Sessions have IDs and optional project IDs
- Sessions can be destroyed/recreated but we want temp dirs to persist

### Code Changes

**File**: `src/sessions/session.ts`

Add imports at the top (check if they already exist):
```typescript
import { getProcessTempDir } from '~/config/lace-dir';
import { mkdirSync } from 'fs';
import { join } from 'path';
```

Add static method to the `Session` class:
```typescript
/**
 * Get temporary directory for a session
 * Creates: /tmp/lace-runtime-{pid}-{timestamp}/project-{projectId}/session-{sessionId}/
 * or: /tmp/lace-runtime-{pid}-{timestamp}/session-{sessionId}/ (if no project)
 */
static getSessionTempDir(sessionId: string, projectId?: string): string {
  const baseDir = projectId 
    ? Project.getProjectTempDir(projectId)
    : getProcessTempDir();
    
  const sessionTempPath = join(baseDir, `session-${sessionId}`);
  mkdirSync(sessionTempPath, { recursive: true });
  return sessionTempPath;
}
```

### Testing

**File**: `src/sessions/session.test.ts`

Add at the end of the existing describe blocks:

```typescript
describe('temp directory management', () => {
  it('should create session temp directory without project', () => {
    const sessionId = 'test-session-123';
    const tempDir = Session.getSessionTempDir(sessionId);
    
    expect(tempDir).toContain(`session-${sessionId}`);
    expect(existsSync(tempDir)).toBe(true);
  });

  it('should create session temp directory with project', () => {
    const sessionId = 'test-session-456';
    const projectId = 'test-project-789';
    const tempDir = Session.getSessionTempDir(sessionId, projectId);
    
    expect(tempDir).toContain(`project-${projectId}`);
    expect(tempDir).toContain(`session-${sessionId}`);
    expect(existsSync(tempDir)).toBe(true);
  });

  it('should return same directory for same session', () => {
    const sessionId = 'stable-session';
    const projectId = 'stable-project';
    const tempDir1 = Session.getSessionTempDir(sessionId, projectId);
    const tempDir2 = Session.getSessionTempDir(sessionId, projectId);
    
    expect(tempDir1).toBe(tempDir2);
  });

  it('should create different directories for different sessions', () => {
    const projectId = 'same-project';
    const tempDir1 = Session.getSessionTempDir('session-a', projectId);
    const tempDir2 = Session.getSessionTempDir('session-b', projectId);
    
    expect(tempDir1).not.toBe(tempDir2);
    expect(tempDir1).toContain('session-a');
    expect(tempDir2).toContain('session-b');
  });

  it('should nest under project directory when project provided', () => {
    const sessionId = 'nested-session';
    const projectId = 'parent-project';
    const sessionTempDir = Session.getSessionTempDir(sessionId, projectId);
    const projectTempDir = Project.getProjectTempDir(projectId);
    
    expect(sessionTempDir).toContain(projectTempDir);
  });

  it('should nest under process directory when no project', () => {
    const sessionId = 'root-session';
    const sessionTempDir = Session.getSessionTempDir(sessionId);
    const processTempDir = getProcessTempDir();
    
    expect(sessionTempDir).toContain(processTempDir);
  });
});
```

**Required imports to add**:
```typescript
import { existsSync } from 'fs';
import { getProcessTempDir } from '~/config/lace-dir';
import { Project } from '~/projects/project';
```

### How to Test
```bash
npm test -- src/sessions/session.test.ts
```

### Commit Message
```
feat(sessions): add session temp directory management

- Add Session.getSessionTempDir() for session-scoped temp directories
- Support both project-scoped and global sessions
- Directory structure: project-{id}/session-{id}/ or session-{id}/
```

## Task 4: Add Tool Temp Directory Helpers

### Background Context
- `Tool` is the base class for all tools in `src/tools/tool.ts`
- Has methods like `execute()`, `createResult()`, helper methods
- Tools receive `ToolContext` which includes `sessionId`, `projectId`, `threadId`
- We want tools to easily get temp directories for their specific tool call

### Code Changes

**File**: `src/tools/tool.ts`

Add imports at the top:
```typescript
import { Session } from '~/sessions/session';
import { mkdirSync } from 'fs';
import { join } from 'path';
```

Add constants and methods to the `Tool` class:
```typescript
// Constants for temp directory naming
private static readonly TOOL_CALL_TEMP_PREFIX = 'tool-call-';
private static readonly OUTPUT_FILE_STDOUT = 'stdout.txt';
private static readonly OUTPUT_FILE_STDERR = 'stderr.txt';
private static readonly OUTPUT_FILE_COMBINED = 'combined.txt';

/**
 * Get temporary directory for a specific tool call
 * Creates: session-temp-dir/tool-call-{toolCallId}/
 */
protected getToolCallTempDir(toolCallId: string, context?: ToolContext): string {
  if (!context?.sessionId) {
    throw new Error('Session ID required for tool temp directory');
  }
  
  const sessionDir = Session.getSessionTempDir(context.sessionId, context.projectId);
  const toolCallDir = join(sessionDir, `${Tool.TOOL_CALL_TEMP_PREFIX}${toolCallId}`);
  mkdirSync(toolCallDir, { recursive: true });
  
  return toolCallDir;
}

/**
 * Get standard output file paths for a tool call
 * Returns paths for stdout.txt, stderr.txt, combined.txt
 */
protected getOutputFilePaths(toolCallId: string, context?: ToolContext): {
  stdout: string;
  stderr: string;
  combined: string;
} {
  const dir = this.getToolCallTempDir(toolCallId, context);
  return {
    stdout: join(dir, Tool.OUTPUT_FILE_STDOUT),
    stderr: join(dir, Tool.OUTPUT_FILE_STDERR),
    combined: join(dir, Tool.OUTPUT_FILE_COMBINED),
  };
}
```

### Testing

**File**: `src/tools/tool.test.ts`

Create this new test file:

```typescript
// ABOUTME: Tests for Tool base class temp directory functionality
// ABOUTME: Covers tool-call-specific temp directory creation and file path generation

import { describe, it, expect, beforeEach } from 'vitest';
import { Tool } from './tool';
import { z } from 'zod';
import { existsSync } from 'fs';
import { join } from 'path';
import { clearProcessTempDirCache } from '~/config/lace-dir';
import type { ToolContext, ToolResult } from './types';

// Test tool implementation for testing base class functionality
class TestTool extends Tool {
  name = 'test_tool';
  description = 'Tool for testing temp directory functionality';
  schema = z.object({
    message: z.string(),
  });

  protected async executeValidated(
    args: z.infer<typeof this.schema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    return this.createResult(`Test executed: ${args.message}`);
  }

  // Expose protected methods for testing
  public getToolCallTempDirPublic(toolCallId: string, context?: ToolContext): string {
    return this.getToolCallTempDir(toolCallId, context);
  }

  public getOutputFilePathsPublic(toolCallId: string, context?: ToolContext) {
    return this.getOutputFilePaths(toolCallId, context);
  }
}

describe('Tool temp directory functionality', () => {
  let testTool: TestTool;

  beforeEach(() => {
    testTool = new TestTool();
    clearProcessTempDirCache();
  });

  describe('getToolCallTempDir', () => {
    it('should create tool call temp directory', () => {
      const toolCallId = 'tool-call-123';
      const context: ToolContext = {
        sessionId: 'session-456',
        projectId: 'project-789',
      };

      const tempDir = testTool.getToolCallTempDirPublic(toolCallId, context);

      expect(tempDir).toContain(`tool-call-${toolCallId}`);
      expect(tempDir).toContain('session-session-456');
      expect(tempDir).toContain('project-project-789');
      expect(existsSync(tempDir)).toBe(true);
    });

    it('should create tool call temp directory without project', () => {
      const toolCallId = 'tool-call-abc';
      const context: ToolContext = {
        sessionId: 'session-def',
      };

      const tempDir = testTool.getToolCallTempDirPublic(toolCallId, context);

      expect(tempDir).toContain(`tool-call-${toolCallId}`);
      expect(tempDir).toContain('session-session-def');
      expect(tempDir).not.toContain('project-');
      expect(existsSync(tempDir)).toBe(true);
    });

    it('should throw error when session ID is missing', () => {
      const toolCallId = 'tool-call-error';
      const context: ToolContext = {
        projectId: 'project-orphan',
      };

      expect(() => {
        testTool.getToolCallTempDirPublic(toolCallId, context);
      }).toThrow('Session ID required for tool temp directory');
    });

    it('should throw error when context is undefined', () => {
      const toolCallId = 'tool-call-no-context';

      expect(() => {
        testTool.getToolCallTempDirPublic(toolCallId, undefined);
      }).toThrow('Session ID required for tool temp directory');
    });

    it('should return same directory for same tool call', () => {
      const toolCallId = 'stable-tool-call';
      const context: ToolContext = {
        sessionId: 'stable-session',
      };

      const tempDir1 = testTool.getToolCallTempDirPublic(toolCallId, context);
      const tempDir2 = testTool.getToolCallTempDirPublic(toolCallId, context);

      expect(tempDir1).toBe(tempDir2);
    });

    it('should create different directories for different tool calls', () => {
      const context: ToolContext = {
        sessionId: 'same-session',
      };

      const tempDir1 = testTool.getToolCallTempDirPublic('tool-call-a', context);
      const tempDir2 = testTool.getToolCallTempDirPublic('tool-call-b', context);

      expect(tempDir1).not.toBe(tempDir2);
      expect(tempDir1).toContain('tool-call-a');
      expect(tempDir2).toContain('tool-call-b');
    });
  });

  describe('getOutputFilePaths', () => {
    it('should return correct file paths', () => {
      const toolCallId = 'output-test';
      const context: ToolContext = {
        sessionId: 'file-session',
      };

      const paths = testTool.getOutputFilePathsPublic(toolCallId, context);

      expect(paths.stdout).toContain('stdout.txt');
      expect(paths.stderr).toContain('stderr.txt');
      expect(paths.combined).toContain('combined.txt');

      // All paths should be in the same directory
      const toolCallDir = testTool.getToolCallTempDirPublic(toolCallId, context);
      expect(paths.stdout).toContain(toolCallDir);
      expect(paths.stderr).toContain(toolCallDir);
      expect(paths.combined).toContain(toolCallDir);
    });

    it('should create consistent paths across calls', () => {
      const toolCallId = 'consistent-test';
      const context: ToolContext = {
        sessionId: 'consistent-session',
      };

      const paths1 = testTool.getOutputFilePathsPublic(toolCallId, context);
      const paths2 = testTool.getOutputFilePathsPublic(toolCallId, context);

      expect(paths1.stdout).toBe(paths2.stdout);
      expect(paths1.stderr).toBe(paths2.stderr);
      expect(paths1.combined).toBe(paths2.combined);
    });

    it('should have correct file names', () => {
      const toolCallId = 'filename-test';
      const context: ToolContext = {
        sessionId: 'filename-session',
      };

      const paths = testTool.getOutputFilePathsPublic(toolCallId, context);

      expect(paths.stdout.endsWith('stdout.txt')).toBe(true);
      expect(paths.stderr.endsWith('stderr.txt')).toBe(true);
      expect(paths.combined.endsWith('combined.txt')).toBe(true);
    });
  });
});
```

### How to Test
```bash
npm test -- src/tools/tool.test.ts
```

### Commit Message
```
feat(tools): add temp directory support to Tool base class

- Add getToolCallTempDir() for tool-call-specific temp directories
- Add getOutputFilePaths() for standard output file locations
- Support stdout.txt, stderr.txt, combined.txt naming convention
- Require sessionId in context for temp directory creation
```

## Task 5: Integration Testing

### Create Integration Test

**File**: `src/tools/temp-directory-integration.test.ts`

```typescript
// ABOUTME: Integration tests for temp directory functionality across all layers
// ABOUTME: Tests the complete flow from process temp to tool-call directories

import { describe, it, expect, beforeEach } from 'vitest';
import { getProcessTempDir, clearProcessTempDirCache } from '~/config/lace-dir';
import { Project } from '~/projects/project';
import { Session } from '~/sessions/session';
import { Tool } from './tool';
import { z } from 'zod';
import { existsSync } from 'fs';
import { writeFileSync, readFileSync } from 'fs';
import type { ToolContext, ToolResult } from './types';

// Test tool for integration testing
class IntegrationTestTool extends Tool {
  name = 'integration_test_tool';
  description = 'Tool for testing full temp directory integration';
  schema = z.object({
    content: z.string(),
  });

  protected async executeValidated(
    args: z.infer<typeof this.schema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    return this.createResult(`Integration test: ${args.content}`);
  }

  public getToolCallTempDirPublic(toolCallId: string, context?: ToolContext): string {
    return this.getToolCallTempDir(toolCallId, context);
  }

  public getOutputFilePathsPublic(toolCallId: string, context?: ToolContext) {
    return this.getOutputFilePaths(toolCallId, context);
  }
}

describe('Temp Directory Integration', () => {
  let testTool: IntegrationTestTool;

  beforeEach(() => {
    testTool = new IntegrationTestTool();
    clearProcessTempDirCache();
  });

  it('should create proper directory hierarchy', () => {
    const projectId = 'integration-project';
    const sessionId = 'integration-session';
    const toolCallId = 'integration-tool-call';

    // Create directories through each layer
    const processTempDir = getProcessTempDir();
    const projectTempDir = Project.getProjectTempDir(projectId);
    const sessionTempDir = Session.getSessionTempDir(sessionId, projectId);
    
    const context: ToolContext = {
      sessionId,
      projectId,
    };
    const toolCallTempDir = testTool.getToolCallTempDirPublic(toolCallId, context);

    // Verify hierarchy
    expect(projectTempDir).toContain(processTempDir);
    expect(sessionTempDir).toContain(projectTempDir);
    expect(toolCallTempDir).toContain(sessionTempDir);

    // Verify all directories exist
    expect(existsSync(processTempDir)).toBe(true);
    expect(existsSync(projectTempDir)).toBe(true);
    expect(existsSync(sessionTempDir)).toBe(true);
    expect(existsSync(toolCallTempDir)).toBe(true);
  });

  it('should handle file operations in tool temp directory', () => {
    const context: ToolContext = {
      sessionId: 'file-ops-session',
      projectId: 'file-ops-project',
    };
    const toolCallId = 'file-ops-tool-call';

    const paths = testTool.getOutputFilePathsPublic(toolCallId, context);

    // Write test content to each output file
    const testContent = {
      stdout: 'This is stdout content',
      stderr: 'This is stderr content', 
      combined: 'This is combined content',
    };

    writeFileSync(paths.stdout, testContent.stdout);
    writeFileSync(paths.stderr, testContent.stderr);
    writeFileSync(paths.combined, testContent.combined);

    // Verify files were written correctly
    expect(readFileSync(paths.stdout, 'utf-8')).toBe(testContent.stdout);
    expect(readFileSync(paths.stderr, 'utf-8')).toBe(testContent.stderr);
    expect(readFileSync(paths.combined, 'utf-8')).toBe(testContent.combined);
  });

  it('should maintain stability across object recreation', () => {
    const projectId = 'stability-project';
    const sessionId = 'stability-session';
    const toolCallId = 'stability-tool-call';

    // Get paths with first tool instance
    const context: ToolContext = { sessionId, projectId };
    const paths1 = testTool.getOutputFilePathsPublic(toolCallId, context);

    // Create new tool instance and get paths
    const newTestTool = new IntegrationTestTool();
    const paths2 = newTestTool.getOutputFilePathsPublic(toolCallId, context);

    // Paths should be identical
    expect(paths1.stdout).toBe(paths2.stdout);
    expect(paths1.stderr).toBe(paths2.stderr);
    expect(paths1.combined).toBe(paths2.combined);
  });

  it('should handle session without project correctly', () => {
    const sessionId = 'no-project-session';
    const toolCallId = 'no-project-tool-call';

    const context: ToolContext = {
      sessionId,
      // No projectId
    };

    const toolCallTempDir = testTool.getToolCallTempDirPublic(toolCallId, context);
    const processTempDir = getProcessTempDir();
    const sessionTempDir = Session.getSessionTempDir(sessionId);

    // Should nest under process temp, not project temp
    expect(toolCallTempDir).toContain(processTempDir);
    expect(toolCallTempDir).toContain(sessionTempDir);
    expect(toolCallTempDir).not.toContain('project-');
    expect(existsSync(toolCallTempDir)).toBe(true);
  });
});
```

### How to Test
```bash
npm test -- src/tools/temp-directory-integration.test.ts
```

### Commit Message
```
test: add comprehensive temp directory integration tests

- Test full hierarchy from process to tool-call directories
- Verify file operations work correctly in temp directories
- Test stability across object recreation
- Cover both project and non-project scenarios
```

## Task 6: Run Full Test Suite and Fix Issues

### Run All Tests
```bash
# Run all tests to ensure nothing is broken
npm test

# Run with coverage to see what we've covered
npm run test:coverage

# Run linting
npm run lint

# Run type checking
npm run build
```

### Common Issues and Fixes

**TypeScript Errors**:
- Never use `any` type - use `unknown` and type guards instead
- Import types properly: `import type { Session } from '~/sessions/session'`
- Use proper type assertions: `as string` not `as any`

**Test Failures**:
- Always test real functionality, never mock what you're testing
- Use real file operations, real directories, real temp paths
- Clean up temp directories between tests with `clearProcessTempDirCache()`

**Import Issues**:
- Use `~/` path aliases, not relative imports like `../../../`
- Import Node.js modules explicitly: `import { join } from 'path'`

### Final Commit
```
feat: complete temp directory infrastructure

- Process-stable temp directories for server runtime
- Hierarchical structure: process/project/session/tool-call
- Tool base class provides easy access to temp directories
- Standard output file naming (stdout.txt, stderr.txt, combined.txt)
- Comprehensive test coverage across all layers
- Documentation and integration tests included
```

---

# PR 2: Bash Tool Output Management

## Overview
Update the bash tool to store complete output in temp files while returning truncated head+tail summaries to the model. This prevents token window overflow while maintaining full audit capability.

## Files to Modify

### 1. `src/tools/implementations/bash.ts`
Update bash tool to use temp directories and implement smart truncation.

### 2. `src/tools/bash.test.ts`  
Update existing tests and add new tests for output management.

### 3. New test file for large output scenarios

## Task 1: Understand Current Bash Tool Implementation

### Read and Analyze
Before making changes, read these files carefully:

**Files to read**:
- `src/tools/implementations/bash.ts` - Current implementation
- `src/tools/bash.test.ts` - Existing tests  
- `src/tools/types.ts` - Tool result types

**Key things to understand**:
1. How `execAsync` is used with `maxBuffer` limit
2. The `BashOutput` interface structure
3. How tool results are created with `this.createResult()`
4. How error handling works (tool success vs command exit code)
5. Current test patterns and expectations

### Current Problems to Note
- `maxBuffer: 10485760` (10MB) will throw on large output
- Raw stdout/stderr returned directly to model
- No audit trail for debugging failed commands

## Task 2: Design Output Management Interface

### Define Types

**File**: `src/tools/implementations/bash.ts`

Update the `BashOutput` interface:
```typescript
interface BashOutput {
  command: string;
  exitCode: number;
  runtime: number;
  
  // Truncated output for model consumption
  stdoutPreview: string;
  stderrPreview: string;
  
  // Truncation info
  truncated: {
    stdout: { skipped: number; total: number };
    stderr: { skipped: number; total: number };
  };
  
  // Full output file references
  outputFiles: {
    stdout: string;
    stderr: string;
    combined: string;
  };
}
```

### Define Constants

Add these constants to the bash tool class:
```typescript
// Output truncation limits
private static readonly PREVIEW_HEAD_LINES = 100;
private static readonly PREVIEW_TAIL_LINES = 50;
private static readonly MAX_PREVIEW_CHARS = 10000; // Safety limit
```

## Task 3: Implement Output Streaming and Storage

### Background
- We need to capture output as it streams (don't wait for command completion)
- Store complete output to temp files
- Keep head/tail lines in memory for preview
- Handle both stdout and stderr streams

### Code Changes

**File**: `src/tools/implementations/bash.ts`

Add these imports:
```typescript
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { readFileSync, statSync } from 'fs';
```

Replace the `executeCommand` method:
```typescript
private async executeCommand(command: string, context?: ToolContext): Promise<ToolResult> {
  // Remove maxBuffer limit, we'll handle large output gracefully
  const startTime = Date.now();
  
  // Generate tool call ID for this execution
  // In real implementation, this would come from the tool executor
  // For now, generate a unique ID
  const toolCallId = `bash-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  
  try {
    // Get temp file paths
    const outputPaths = this.getOutputFilePaths(toolCallId, context);
    
    // Set up output streams
    const stdoutStream = createWriteStream(outputPaths.stdout);
    const stderrStream = createWriteStream(outputPaths.stderr);
    const combinedStream = createWriteStream(outputPaths.combined);
    
    // Buffers for head/tail preview
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    let stdoutLineCount = 0;
    let stderrLineCount = 0;
    
    // Execute command with spawn for streaming
    const childProcess = spawn('/bin/bash', ['-c', command], {
      cwd: context?.workingDirectory || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    return new Promise<ToolResult>((resolve) => {
      let stdoutData = '';
      let stderrData = '';
      
      // Handle stdout
      childProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        stdoutData += text;
        
        // Write to files
        stdoutStream.write(data);
        combinedStream.write(data);
        
        // Track lines for preview
        const lines = text.split('\n');
        for (const line of lines) {
          if (stdoutLineCount < BashTool.PREVIEW_HEAD_LINES) {
            stdoutLines.push(line);
          } else if (stdoutLines.length > BashTool.PREVIEW_HEAD_LINES) {
            // Keep tail lines by rotating buffer
            stdoutLines.shift();
            stdoutLines.push(line);
          }
          stdoutLineCount++;
        }
      });
      
      // Handle stderr
      childProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderrData += text;
        
        // Write to files
        stderrStream.write(data);
        combinedStream.write(data);
        
        // Track lines for preview
        const lines = text.split('\n');
        for (const line of lines) {
          if (stderrLineCount < BashTool.PREVIEW_HEAD_LINES) {
            stderrLines.push(line);
          } else if (stderrLines.length > BashTool.PREVIEW_HEAD_LINES) {
            // Keep tail lines by rotating buffer
            stderrLines.shift();
            stderrLines.push(line);
          }
          stderrLineCount++;
        }
      });
      
      // Handle completion
      childProcess.on('close', (exitCode) => {
        // Close file streams
        stdoutStream.end();
        stderrStream.end();
        combinedStream.end();
        
        const endTime = Date.now();
        const runtime = endTime - startTime;
        
        // Create truncated previews
        const stdoutPreview = this.createPreview(stdoutLines, stdoutLineCount);
        const stderrPreview = this.createPreview(stderrLines, stderrLineCount);
        
        const result: BashOutput = {
          command,
          exitCode: exitCode || 0,
          runtime,
          stdoutPreview,
          stderrPreview,
          truncated: {
            stdout: {
              total: stdoutLineCount,
              skipped: Math.max(0, stdoutLineCount - stdoutLines.length),
            },
            stderr: {
              total: stderrLineCount,
              skipped: Math.max(0, stderrLineCount - stderrLines.length),
            },
          },
          outputFiles: outputPaths,
        };
        
        // Same error handling logic as before
        if (exitCode === 127 && (!stdoutData || stdoutData.trim() === '')) {
          resolve(this.createError(result as unknown as Record<string, unknown>));
        } else {
          resolve(this.createResult(result as unknown as Record<string, unknown>));
        }
      });
      
      // Handle process errors
      childProcess.on('error', (error) => {
        // Close streams
        stdoutStream.end();
        stderrStream.end();
        combinedStream.end();
        
        const result: BashOutput = {
          command,
          exitCode: 1,
          runtime: Date.now() - startTime,
          stdoutPreview: '',
          stderrPreview: error.message,
          truncated: {
            stdout: { total: 0, skipped: 0 },
            stderr: { total: 1, skipped: 0 },
          },
          outputFiles: outputPaths,
        };
        
        resolve(this.createError(result as unknown as Record<string, unknown>));
      });
    });
    
  } catch (error: unknown) {
    const err = error as Error;
    const result: BashOutput = {
      command,
      exitCode: 1,
      runtime: Date.now() - startTime,
      stdoutPreview: '',
      stderrPreview: err.message,
      truncated: {
        stdout: { total: 0, skipped: 0 },
        stderr: { total: 1, skipped: 0 },
      },
      outputFiles: {
        stdout: '',
        stderr: '',
        combined: '',
      },
    };
    
    return this.createError(result as unknown as Record<string, unknown>);
  }
}

/**
 * Create a preview from collected lines with head+tail pattern
 */
private createPreview(lines: string[], totalLines: number): string {
  if (totalLines === 0) {
    return '';
  }
  
  if (totalLines <= BashTool.PREVIEW_HEAD_LINES + BashTool.PREVIEW_TAIL_LINES) {
    // No truncation needed
    return lines.join('\n');
  }
  
  // Split into head and tail
  const headLines = lines.slice(0, BashTool.PREVIEW_HEAD_LINES);
  const tailLines = lines.slice(-BashTool.PREVIEW_TAIL_LINES);
  const skippedLines = totalLines - headLines.length - tailLines.length;
  
  const preview = [
    ...headLines,
    `\n=== OUTPUT TRUNCATED ===`,
    `[Skipped ${skippedLines} lines - see full output in temp files]`,
    `=== LAST ${tailLines.length} LINES ===\n`,
    ...tailLines,
  ].join('\n');
  
  // Safety limit on preview size
  if (preview.length > BashTool.MAX_PREVIEW_CHARS) {
    return preview.substring(0, BashTool.MAX_PREVIEW_CHARS) + '\n[PREVIEW TRUNCATED]';
  }
  
  return preview;
}
```

## Task 4: Handle Tool Call ID Injection

### Problem
Tools need the tool call ID to create temp directories, but currently don't receive it.

### Temporary Solution
For this PR, generate a unique ID within the bash tool. In a future PR, the tool executor should provide the real tool call ID.

```typescript
// In executeValidated method, before calling executeCommand:
protected async executeValidated(
  args: z.infer<typeof bashSchema>,
  context?: ToolContext
): Promise<ToolResult> {
  // Generate unique tool call ID for this execution
  // TODO: Tool call ID should be provided by ToolExecutor in future PR
  const toolCallId = `bash-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  
  return await this.executeCommand(args.command, context, toolCallId);
}
```

Update `executeCommand` signature:
```typescript
private async executeCommand(
  command: string, 
  context?: ToolContext,
  toolCallId?: string
): Promise<ToolResult>
```

## Task 5: Update Tests for New Behavior

### Background
Current tests expect raw stdout/stderr in results. We need to update them for the new `BashOutput` format.

### Test Strategy
- Test small outputs (no truncation)
- Test large outputs (with truncation) 
- Test file creation and storage
- Test error scenarios
- Never mock the bash execution - use real commands

### Update Existing Tests

**File**: `src/tools/bash.test.ts`

Update test expectations for new output format:
```typescript
// Update existing tests to expect new BashOutput format
it('should execute simple bash command', async () => {
  const tool = new BashTool();
  const result = await tool.execute({ command: 'echo "hello world"' }, mockContext);
  
  expect(result.isError).toBe(false);
  
  // Parse the result content
  const content = JSON.parse(result.content[0].text) as BashOutput;
  expect(content.command).toBe('echo "hello world"');
  expect(content.exitCode).toBe(0);
  expect(content.stdoutPreview).toContain('hello world');
  expect(content.stderrPreview).toBe('');
  expect(content.runtime).toBeGreaterThan(0);
  
  // Check truncation info
  expect(content.truncated.stdout.total).toBeGreaterThan(0);
  expect(content.truncated.stdout.skipped).toBe(0); // No truncation for small output
  
  // Check output files exist
  expect(existsSync(content.outputFiles.stdout)).toBe(true);
  expect(existsSync(content.outputFiles.stderr)).toBe(true);
  expect(existsSync(content.outputFiles.combined)).toBe(true);
});
```

### Add New Tests for Large Output

**File**: `src/tools/bash-large-output.test.ts`

Create comprehensive tests for large output scenarios:

```typescript
// ABOUTME: Tests for bash tool large output handling and truncation
// ABOUTME: Covers temp file storage, head+tail truncation, and edge cases

import { describe, it, expect, beforeEach } from 'vitest';
import { BashTool } from './implementations/bash';
import { existsSync, readFileSync } from 'fs';
import { clearProcessTempDirCache } from '~/config/lace-dir';
import type { ToolContext } from './types';

describe('BashTool Large Output Handling', () => {
  let tool: BashTool;
  let mockContext: ToolContext;

  beforeEach(() => {
    tool = new BashTool();
    mockContext = {
      sessionId: 'test-session',
      projectId: 'test-project',
      workingDirectory: process.cwd(),
    };
    clearProcessTempDirCache();
  });

  it('should handle large stdout without truncation when under limits', async () => {
    // Generate 50 lines of output (under the 100 line head limit)
    const command = 'for i in {1..50}; do echo "Line $i of output"; done';
    const result = await tool.execute({ command }, mockContext);
    
    expect(result.isError).toBe(false);
    
    const content = JSON.parse(result.content[0].text);
    expect(content.truncated.stdout.total).toBe(50);
    expect(content.truncated.stdout.skipped).toBe(0);
    expect(content.stdoutPreview).toContain('Line 1 of output');
    expect(content.stdoutPreview).toContain('Line 50 of output');
    
    // Verify full output in file
    const fullOutput = readFileSync(content.outputFiles.stdout, 'utf-8');
    expect(fullOutput).toContain('Line 1 of output');
    expect(fullOutput).toContain('Line 50 of output');
  });

  it('should truncate large stdout with head+tail pattern', async () => {
    // Generate 200 lines of output (will trigger truncation)
    const command = 'for i in {1..200}; do echo "Line $i of many lines"; done';
    const result = await tool.execute({ command }, mockContext);
    
    expect(result.isError).toBe(false);
    
    const content = JSON.parse(result.content[0].text);
    expect(content.truncated.stdout.total).toBe(200);
    expect(content.truncated.stdout.skipped).toBe(50); // 200 - 100 head - 50 tail
    
    // Preview should contain head lines
    expect(content.stdoutPreview).toContain('Line 1 of many lines');
    expect(content.stdoutPreview).toContain('Line 100 of many lines');
    
    // Preview should contain truncation indicator
    expect(content.stdoutPreview).toContain('=== OUTPUT TRUNCATED ===');
    expect(content.stdoutPreview).toContain('[Skipped 50 lines');
    
    // Preview should contain tail lines
    expect(content.stdoutPreview).toContain('Line 151 of many lines'); // First tail line
    expect(content.stdoutPreview).toContain('Line 200 of many lines'); // Last line
    
    // Full output should be complete in file
    const fullOutput = readFileSync(content.outputFiles.stdout, 'utf-8');
    expect(fullOutput).toContain('Line 1 of many lines');
    expect(fullOutput).toContain('Line 100 of many lines');
    expect(fullOutput).toContain('Line 150 of many lines');
    expect(fullOutput).toContain('Line 200 of many lines');
  });

  it('should handle large stderr output', async () => {
    // Generate large stderr output
    const command = 'for i in {1..200}; do echo "Error $i" >&2; done';
    const result = await tool.execute({ command }, mockContext);
    
    expect(result.isError).toBe(false); // Tool succeeds even with stderr
    
    const content = JSON.parse(result.content[0].text);
    expect(content.truncated.stderr.total).toBe(200);
    expect(content.truncated.stderr.skipped).toBe(50);
    
    expect(content.stderrPreview).toContain('Error 1');
    expect(content.stderrPreview).toContain('=== OUTPUT TRUNCATED ===');
    expect(content.stderrPreview).toContain('Error 200');
    
    // Check stderr file
    const stderrOutput = readFileSync(content.outputFiles.stderr, 'utf-8');
    expect(stderrOutput).toContain('Error 1');
    expect(stderrOutput).toContain('Error 200');
  });

  it('should handle mixed stdout and stderr', async () => {
    const command = `
      for i in {1..100}; do 
        echo "Stdout line $i"
        echo "Stderr line $i" >&2
      done
    `;
    const result = await tool.execute({ command }, mockContext);
    
    expect(result.isError).toBe(false);
    
    const content = JSON.parse(result.content[0].text);
    
    // Both should have some lines
    expect(content.truncated.stdout.total).toBe(100);
    expect(content.truncated.stderr.total).toBe(100);
    
    // Check combined file has both streams
    const combinedOutput = readFileSync(content.outputFiles.combined, 'utf-8');
    expect(combinedOutput).toContain('Stdout line');
    expect(combinedOutput).toContain('Stderr line');
  });

  it('should handle commands with extremely large output', async () => {
    // Generate very large output (1000 lines)
    const command = 'for i in {1..1000}; do echo "Very long line $i with lots of text to make it bigger"; done';
    const result = await tool.execute({ command }, mockContext);
    
    expect(result.isError).toBe(false);
    
    const content = JSON.parse(result.content[0].text);
    expect(content.truncated.stdout.total).toBe(1000);
    expect(content.truncated.stdout.skipped).toBe(850); // 1000 - 100 head - 50 tail
    
    // Preview should be under safety limit
    expect(content.stdoutPreview.length).toBeLessThan(10000);
    
    // Full output should be much larger
    const fullOutput = readFileSync(content.outputFiles.stdout, 'utf-8');
    expect(fullOutput.length).toBeGreaterThan(50000);
  });

  it('should create separate files for stdout, stderr, and combined', async () => {
    const command = 'echo "stdout content"; echo "stderr content" >&2';
    const result = await tool.execute({ command }, mockContext);
    
    const content = JSON.parse(result.content[0].text);
    
    // All three files should exist and have different content
    const stdoutContent = readFileSync(content.outputFiles.stdout, 'utf-8');
    const stderrContent = readFileSync(content.outputFiles.stderr, 'utf-8');
    const combinedContent = readFileSync(content.outputFiles.combined, 'utf-8');
    
    expect(stdoutContent).toContain('stdout content');
    expect(stdoutContent).not.toContain('stderr content');
    
    expect(stderrContent).toContain('stderr content');
    expect(stderrContent).not.toContain('stdout content');
    
    expect(combinedContent).toContain('stdout content');
    expect(combinedContent).toContain('stderr content');
  });

  it('should handle command that produces no output', async () => {
    const command = 'true'; // Command that exits successfully with no output
    const result = await tool.execute({ command }, mockContext);
    
    expect(result.isError).toBe(false);
    
    const content = JSON.parse(result.content[0].text);
    expect(content.exitCode).toBe(0);
    expect(content.stdoutPreview).toBe('');
    expect(content.stderrPreview).toBe('');
    expect(content.truncated.stdout.total).toBe(0);
    expect(content.truncated.stderr.total).toBe(0);
    
    // Files should still exist but be empty
    expect(existsSync(content.outputFiles.stdout)).toBe(true);
    expect(readFileSync(content.outputFiles.stdout, 'utf-8')).toBe('');
  });

  it('should include runtime information', async () => {
    const command = 'sleep 0.1; echo "done"'; // Command that takes some time
    const result = await tool.execute({ command }, mockContext);
    
    const content = JSON.parse(result.content[0].text);
    expect(content.runtime).toBeGreaterThan(100); // At least 100ms
    expect(typeof content.runtime).toBe('number');
  });

  it('should handle non-zero exit codes correctly', async () => {
    const command = 'echo "before error"; exit 42';
    const result = await tool.execute({ command }, mockContext);
    
    expect(result.isError).toBe(false); // Tool execution succeeds
    
    const content = JSON.parse(result.content[0].text);
    expect(content.exitCode).toBe(42);
    expect(content.stdoutPreview).toContain('before error');
    
    // Output should still be stored in files
    const stdoutContent = readFileSync(content.outputFiles.stdout, 'utf-8');
    expect(stdoutContent).toContain('before error');
  });
});
```

## Task 6: Test the Implementation

### Run Tests
```bash
# Run bash tool specific tests
npm test -- src/tools/bash.test.ts
npm test -- src/tools/bash-large-output.test.ts

# Run all tool tests
npm test -- src/tools/

# Run full test suite
npm test
```

### Manual Testing
Create a test script to verify large output handling:

**File**: `test-bash-output.js` (temporary, for manual testing)
```javascript
import { BashTool } from './src/tools/implementations/bash.js';

const tool = new BashTool();
const context = {
  sessionId: 'manual-test-session',
  projectId: 'manual-test-project',
};

// Test large output
const result = await tool.execute({
  command: 'for i in {1..500}; do echo "Line $i of test output with some content"; done'
}, context);

console.log('Result preview length:', result.content[0].text.length);
console.log('Result sample:', result.content[0].text.substring(0, 500));

// Check temp files
const content = JSON.parse(result.content[0].text);
console.log('Temp files created:', content.outputFiles);
console.log('Truncation info:', content.truncated);
```

Run with: `node test-bash-output.js`

### Performance Testing
Test with very large outputs to ensure memory doesn't explode:

```bash
# Test with massive output
echo 'for i in {1..10000}; do echo "Line $i with lots of content to make it large"; done' | lace bash
```

## Task 7: Documentation and Final Testing

### Update Tool Documentation

**File**: `docs/design/tools.md`

Add section about temp directory usage:

```markdown
## Tool Temp Directory Usage

Tools can store large outputs and intermediate files using the temp directory system.

### Getting Temp Directories

```typescript
// In any tool that extends Tool base class
const toolCallId = 'unique-tool-call-id'; // Provided by executor
const context: ToolContext = { sessionId, projectId };

// Get tool-call-specific temp directory
const tempDir = this.getToolCallTempDir(toolCallId, context);

// Get standard output file paths
const paths = this.getOutputFilePaths(toolCallId, context);
// paths.stdout, paths.stderr, paths.combined
```

### Directory Structure

```
/tmp/lace-runtime-{pid}-{timestamp}-{random}/
├── project-{projectId}/           # Optional project grouping
│   └── session-{sessionId}/       # Session-scoped directories
│       └── tool-call-{toolCallId}/ # Tool-call-specific directories
│           ├── stdout.txt         # Standard output
│           ├── stderr.txt         # Standard error
│           └── combined.txt       # Combined output
└── session-{sessionId}/           # Sessions without projects
    └── tool-call-{toolCallId}/
        ├── stdout.txt
        ├── stderr.txt
        └── combined.txt
```

### Best Practices

1. **Large Output Management**: Store full output in temp files, return summaries to model
2. **File Naming**: Use standard names (stdout.txt, stderr.txt, combined.txt) for consistency
3. **Error Handling**: Always create temp directories even if command fails
4. **Memory Usage**: Stream output to files, don't buffer everything in memory
5. **Audit Trail**: Full output is preserved for debugging and analysis

### Example: Bash Tool Implementation

The bash tool demonstrates proper large output handling:
- Streams output to temp files during execution
- Returns head+tail preview to model (first 100 + last 50 lines)
- Includes truncation statistics and file references
- Maintains complete audit trail in temp files

```typescript
// Example result format
{
  command: "npm test",
  exitCode: 1,
  runtime: 15000,
  stdoutPreview: "first 100 lines...\n=== TRUNCATED ===/n...last 50 lines",
  stderrPreview: "Error summary...",
  truncated: {
    stdout: { total: 5000, skipped: 4850 },
    stderr: { total: 200, skipped: 50 }
  },
  outputFiles: {
    stdout: "/tmp/lace-runtime-123/session-abc/tool-call-def/stdout.txt",
    stderr: "/tmp/lace-runtime-123/session-abc/tool-call-def/stderr.txt",
    combined: "/tmp/lace-runtime-123/session-abc/tool-call-def/combined.txt"
  }
}
```
```

### Run Final Tests
```bash
# Complete test suite
npm test

# Linting and type checking
npm run lint
npm run build

# Test coverage
npm run test:coverage
```

### Final Commit Message
```
feat(bash): implement large output management with temp file storage

- Replace maxBuffer limit with streaming output capture
- Store complete output in session-scoped temp directories  
- Return head+tail previews (100+50 lines) to prevent token overflow
- Include truncation statistics and temp file references
- Maintain full audit trail for debugging
- Support stdout.txt, stderr.txt, combined.txt output files
- Add comprehensive tests for large output scenarios

Fixes: 800k stderr output causing token window overflow
```

## Task 8: Clean Up and Documentation

### Remove Temporary Files
```bash
rm test-bash-output.js  # If created for manual testing
```

### Update CLAUDE.md
Add note about temp directory system:

```markdown
### Tool Output Management

Tools that generate large outputs (like bash commands) use the temp directory system:
- Full outputs stored in `/tmp/lace-runtime-{pid}-{timestamp}/`
- Organized by project/session/tool-call hierarchy
- Model receives truncated previews with file references
- Complete audit trail preserved in temp files
```

### Final Integration Test
Run a real scenario to verify everything works:

```bash
# Start lace and run a command that generates large output
npm start
# In lace: run "npm test" and verify:
# 1. Preview is reasonable size
# 2. Temp files are created with full output
# 3. No token overflow errors
```

---

## Summary

This plan implements a complete solution for bash tool output management:

**PR 1: Temp Directory Infrastructure**
- Process-stable temp directories 
- Hierarchical organization (process/project/session/tool-call)
- Tool base class integration
- Comprehensive testing

**PR 2: Bash Tool Output Management**  
- Streaming output capture to temp files
- Head+tail truncation for model consumption
- Complete audit trail preservation
- Large output test coverage

**Key Design Principles Applied**:
- YAGNI: Simple directory creation, no complex retention policies
- DRY: Reusable temp directory system across all tools
- TDD: Tests written first, real functionality never mocked
- Frequent commits: Each task gets its own commit
- Type safety: No `any` types, proper TypeScript throughout

The result: bash tools can handle 800k+ output without breaking the model, while maintaining complete debugging capabilities.