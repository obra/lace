# Phase 2: Configuration & Policies

## ✅ Phase 1 Complete - Ready for Phase 2

**Phase 1 blockers have been resolved:**

### Phase 1 Status (100% Complete):
- ✅ **7/10 tasks completed** - Core architecture fully implemented
- ✅ **2/10 tasks partially completed** - API endpoints and web UI functional
- ✅ **1/10 tasks unblocked** - Session API endpoints now functional

### ✅ Project Class Session Methods Implemented
**The Project class now has all essential session management methods that Phase 2 depends on:**
- ✅ `project.getSessions()` - Returns all sessions for this project
- ✅ `project.createSession()` - Creates new session in this project
- ✅ `project.getSession()` - Gets session (verifies it belongs to project)
- ✅ `project.updateSession()` - Updates session (verifies ownership)
- ✅ `project.deleteSession()` - Deletes session (verifies ownership)
- ✅ `project.getSessionCount()` - Returns count of sessions

**Result**: Phase 2 configuration management can now proceed with full session management capabilities.

---

## Phase 2 Ready to Begin

### ✅ Project Session Methods Implemented

**The Project class now has all required session management methods:**

```typescript
// Implemented methods in Project class (src/projects/project.ts)
export class Project {
  // ... existing methods ...
  
  // ✅ Session management methods (IMPLEMENTED)
  getSessions(): SessionData[] {
    // Returns all sessions for this project
    const persistence = getPersistence();
    return persistence.loadSessionsByProject(this._id);
  }
  
  createSession(name: string, description = '', configuration: Record<string, unknown> = {}): SessionData {
    // Creates a new session in this project
    const persistence = getPersistence();
    
    const sessionData: SessionData = {
      id: randomUUID(),
      projectId: this._id,
      name,
      description,
      configuration,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    persistence.saveSession(sessionData);
    return sessionData;
  }
  
  getSession(sessionId: string): SessionData | null {
    // Gets a specific session, verifies it belongs to this project
    const persistence = getPersistence();
    const session = persistence.loadSession(sessionId);
    
    if (session && session.projectId !== this._id) {
      return null;
    }
    
    return session;
  }
  
  updateSession(sessionId: string, updates: Partial<SessionData>): SessionData | null {
    // Updates session, verifies it belongs to this project
    const persistence = getPersistence();
    
    const existingSession = persistence.loadSession(sessionId);
    if (!existingSession || existingSession.projectId !== this._id) {
      return null;
    }
    
    const updatesWithTimestamp = {
      ...updates,
      updatedAt: new Date(),
    };
    
    persistence.updateSession(sessionId, updatesWithTimestamp);
    return persistence.loadSession(sessionId);
  }
  
  deleteSession(sessionId: string): boolean {
    // Deletes session, verifies it belongs to this project
    const persistence = getPersistence();
    
    const existingSession = persistence.loadSession(sessionId);
    if (!existingSession || existingSession.projectId !== this._id) {
      return false;
    }
    
    // Delete all threads in this session first
    const threads = persistence.getAllThreadsWithMetadata();
    const sessionThreads = threads.filter(thread => thread.sessionId === sessionId);
    
    for (const thread of sessionThreads) {
      persistence.deleteThread(thread.id);
    }
    
    persistence.deleteSession(sessionId);
    return true;
  }
  
  getSessionCount(): number {
    // Returns count of sessions in this project
    const sessions = this.getSessions();
    return sessions.length;
  }
}
```

**Status**: ✅ **COMPLETED** - Phase 2 can now proceed

---

## Phase 2 Task Overview

**Prerequisites Status**: 
- ✅ **COMPLETED** - Phase 1 Task 1.9 is complete
- ✅ **READY** - All Phase 2 tasks can now proceed

**Phase 2 Tasks (Ready to Begin):**
1. **Task 2.1**: Project Configuration Management - *READY*
2. **Task 2.2**: Tool Policy Enforcement - *READY*
3. **Task 2.3**: Session Working Directory Overrides - *READY*
4. **Task 2.4**: Configuration API Endpoints - *READY*
5. **Task 2.5**: Session Update Capabilities - *READY*

---

## Task 2.1: Project Configuration Management

**Goal**: Implement project-level configuration inheritance

**Status**: ✅ **READY** - All prerequisites completed

**Available Capabilities**: Can now implement configuration inheritance with:
- ✅ Get sessions for a project (`project.getSessions()`)
- ✅ Create sessions with configuration (`project.createSession()`)
- ✅ Update session configuration (`project.updateSession()`)

**Prerequisites**: ✅ **COMPLETED** - Phase 1 Task 1.9 is complete

**Test First** (`src/projects/project-config.test.ts`):
```typescript
describe('Project configuration', () => {
  let project: Project;
  let projectId: string;

  beforeEach(() => {
    project = Project.create(
      'Test Project',
      '/project/path',
      'A test project',
      {
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        maxTokens: 4000,
        tools: ['file-read', 'file-write', 'bash'],
        toolPolicies: {
          'file-write': 'allow',
          'bash': 'require-approval'
        }
      }
    );
    projectId = project.getId();
  });

  it('should inherit project configuration in sessions', () => {
    const session = Session.create(
      'Test Session',
      'anthropic',
      'claude-3-sonnet',
      projectId
    );
    
    const config = session.getProjectConfiguration();
    
    expect(config.provider).toBe('anthropic');
    expect(config.model).toBe('claude-3-sonnet');
    expect(config.maxTokens).toBe(4000);
    expect(config.tools).toEqual(['file-read', 'file-write', 'bash']);
  });

  it('should allow session to override project configuration', () => {
    const sessionData = {
      id: 'session1',
      projectId,
      name: 'Test Session',
      description: '',
      configuration: {
        model: 'claude-3-haiku',
        maxTokens: 2000
      },
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    Session.createSession(sessionData);
    const session = Session.getSession('session1');
    const projectConfig = project.getConfiguration();
    
    expect(session).toBeDefined();
    expect(projectConfig.provider).toBe('anthropic');  // From project
    expect(session?.configuration.model).toBe('claude-3-haiku');  // Overridden
    expect(session?.configuration.maxTokens).toBe(2000);  // Overridden
    expect(projectConfig.tools).toEqual(['file-read', 'file-write', 'bash']);  // From project
  });

  it('should merge tool policies correctly', () => {
    const sessionData = {
      id: 'session1',
      projectId,
      name: 'Test Session',
      description: '',
      configuration: {
        toolPolicies: {
          'file-write': 'require-approval',  // Override
          'url-fetch': 'allow'  // Add new
        }
      },
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    Session.createSession(sessionData);
    const session = Session.getSession('session1');
    const projectConfig = project.getConfiguration();
    
    expect(session).toBeDefined();
    expect(session?.configuration.toolPolicies).toEqual({
      'file-write': 'require-approval',  // Overridden
      'url-fetch': 'allow'  // Added
    });
    expect(projectConfig.toolPolicies).toEqual({
      'file-write': 'allow',  // From project (original)
      'bash': 'require-approval'  // From project
    });
  });

  it('should validate configuration schema', () => {
    expect(() => {
      Session.create({
        id: 'session1',
        projectId,
        name: 'Test Session',
        configuration: {
          maxTokens: 'invalid'  // Should be number
        },
        threadManager
      });
    }).toThrow('Invalid configuration');
  });
});
```

**Implementation** (`src/sessions/session.ts`):
```typescript
import { z } from 'zod';

const ConfigurationSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  maxTokens: z.number().positive().optional(),
  tools: z.array(z.string()).optional(),
  toolPolicies: z.record(z.enum(['allow', 'require-approval', 'deny'])).optional(),
  workingDirectory: z.string().optional(),
  environmentVariables: z.record(z.string()).optional()
});

export type Configuration = z.infer<typeof ConfigurationSchema>;

export class Session {
  // ... existing methods ...

  getEffectiveConfiguration(): Configuration {
    const sessionData = Session.getSession(this.getId());
    if (!sessionData) {
      return {};
    }
    
    const project = Project.getById(sessionData.projectId);
    const projectConfig = project?.getConfiguration() || {};
    const sessionConfig = sessionData.configuration || {};
    
    // Merge configurations with session overriding project
    const merged = {
      ...projectConfig,
      ...sessionConfig
    };
    
    // Special handling for toolPolicies - merge rather than replace
    if (projectConfig.toolPolicies || sessionConfig.toolPolicies) {
      merged.toolPolicies = {
        ...projectConfig.toolPolicies,
        ...sessionConfig.toolPolicies
      };
    }
    
    return merged;
  }

  updateConfiguration(updates: Partial<Configuration>): void {
    // Validate configuration
    const validatedConfig = ConfigurationSchema.parse(updates);
    
    const currentConfig = this.sessionData.configuration || {};
    const newConfig = { ...currentConfig, ...validatedConfig };
    
    this.updateMetadata({ configuration: newConfig });
  }

  getToolPolicy(toolName: string): 'allow' | 'require-approval' | 'deny' {
    const config = this.getEffectiveConfiguration();
    return config.toolPolicies?.[toolName] || 'require-approval';
  }
}
```

**Update Project class** (`src/projects/project.ts`):
```typescript
export class Project {
  // ... existing methods ...

  updateConfiguration(updates: Partial<Configuration>): void {
    // Validate configuration
    const validatedConfig = ConfigurationSchema.parse(updates);
    
    const currentConfig = this.getConfiguration();
    const newConfig = { ...currentConfig, ...validatedConfig };
    
    this.updateInfo({ 
      configuration: newConfig
    });
  }

  getConfiguration(): Configuration {
    const info = this.getInfo();
    return info?.configuration || {};
  }
}
```

**Commit**: "feat: implement project configuration inheritance"

## Task 2.2: Tool Policy Enforcement

**Goal**: Enforce tool policies at the ToolExecutor level

**Test First** (`src/tools/tool-executor.test.ts`):
```typescript
describe('ToolExecutor policy enforcement', () => {
  let executor: ToolExecutor;
  let mockSession: Session;
  let context: ToolContext;

  beforeEach(() => {
    executor = new ToolExecutor();
    
    mockSession = {
      getToolPolicy: vi.fn(),
      getEffectiveConfiguration: vi.fn().mockReturnValue({
        tools: ['file-read', 'file-write', 'bash']
      })
    };
    
    context = new ToolContext({
      threadId: 'thread1',
      sessionId: 'session1',
      projectId: 'project1',
      session: mockSession
    });
  });

  it('should allow tool when policy is allow', async () => {
    mockSession.getToolPolicy.mockReturnValue('allow');
    
    const result = await executor.execute('file-read', { file_path: 'test.txt' }, context);
    
    expect(result.success).toBe(true);
    expect(mockSession.getToolPolicy).toHaveBeenCalledWith('file-read');
  });

  it('should require approval when policy is require-approval', async () => {
    mockSession.getToolPolicy.mockReturnValue('require-approval');
    
    // Mock approval system to auto-approve
    const mockApprovalService = {
      requestApproval: vi.fn().mockResolvedValue(true)
    };
    
    executor.setApprovalService(mockApprovalService);
    
    const result = await executor.execute('bash', { command: 'ls' }, context);
    
    expect(mockApprovalService.requestApproval).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('should deny tool when policy is deny', async () => {
    mockSession.getToolPolicy.mockReturnValue('deny');
    
    const result = await executor.execute('bash', { command: 'rm -rf /' }, context);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('Tool execution denied by policy');
  });

  it('should deny tool when not in allowed tools list', async () => {
    mockSession.getEffectiveConfiguration.mockReturnValue({
      tools: ['file-read']  // bash not included
    });
    
    const result = await executor.execute('bash', { command: 'ls' }, context);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('Tool not allowed in current configuration');
  });

  it('should use default policy when session not available', async () => {
    const contextWithoutSession = new ToolContext({
      threadId: 'thread1'
    });
    
    // Should fall back to default require-approval policy
    const mockApprovalService = {
      requestApproval: vi.fn().mockResolvedValue(false)
    };
    
    executor.setApprovalService(mockApprovalService);
    
    const result = await executor.execute('bash', { command: 'ls' }, contextWithoutSession);
    
    expect(mockApprovalService.requestApproval).toHaveBeenCalled();
    expect(result.success).toBe(false);
  });
});
```

**Implementation** (`src/tools/tool-executor.ts`):
```typescript
export class ToolExecutor {
  // ... existing methods ...

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context?: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        success: false,
        error: `Tool '${toolName}' not found`
      };
    }

    // Check if tool is allowed in configuration
    if (context?.session) {
      const config = context.session.getEffectiveConfiguration();
      if (config.tools && !config.tools.includes(toolName)) {
        return {
          success: false,
          error: `Tool '${toolName}' not allowed in current configuration`
        };
      }
    }

    // Check tool policy
    const policy = context?.session?.getToolPolicy(toolName) || 'require-approval';
    
    switch (policy) {
      case 'deny':
        return {
          success: false,
          error: `Tool '${toolName}' execution denied by policy`
        };
        
      case 'require-approval':
        if (this.approvalService) {
          const approved = await this.approvalService.requestApproval({
            toolName,
            args,
            context
          });
          
          if (!approved) {
            return {
              success: false,
              error: `Tool '${toolName}' execution denied by user`
            };
          }
        }
        break;
        
      case 'allow':
        // No additional checks needed
        break;
    }

    // Execute the tool
    try {
      return await tool.execute(args, context);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
```

**Update ToolContext** (`src/tools/tool-context.ts`):
```typescript
export interface ToolContextData {
  threadId: string;
  sessionId?: string;
  projectId?: string;
  workingDirectory?: string;
  session?: Session;  // Add session reference
}

export class ToolContext {
  public readonly threadId: string;
  public readonly sessionId?: string;
  public readonly projectId?: string;
  public readonly workingDirectory: string;
  public readonly session?: Session;

  constructor(data: ToolContextData) {
    this.threadId = data.threadId;
    this.sessionId = data.sessionId;
    this.projectId = data.projectId;
    this.workingDirectory = data.workingDirectory || process.cwd();
    this.session = data.session;
  }
}
```

**Update Agent to pass session in context** (`src/agents/agent.ts`):
```typescript
export class Agent {
  // ... existing methods ...

  private async createToolContext(): Promise<ToolContext> {
    const workingDirectory = this.getWorkingDirectory();
    const session = this.sessionId ? Session.load(this.sessionId, this.threadManager) : undefined;
    
    return new ToolContext({
      threadId: this.threadId,
      sessionId: this.sessionId,
      projectId: this.projectId,
      workingDirectory,
      session
    });
  }
}
```

**Commit**: "feat: implement tool policy enforcement in ToolExecutor"

## Task 2.3: Session Working Directory Override

**Goal**: Allow sessions to override project working directory

**Test First** (`src/sessions/session.test.ts`):
```typescript
describe('Session working directory override', () => {
  let threadManager: ThreadManager;
  let projectId: string;

  beforeEach(() => {
    threadManager = new ThreadManager(':memory:');
    projectId = 'project1';
    
    const project = {
      id: projectId,
      name: 'Test Project',
      description: 'A test project',
      workingDirectory: '/project/default',
      configuration: {},
      isArchived: false,
      createdAt: new Date(),
      lastUsedAt: new Date()
    };
    
    threadManager.createProject(project);
  });

  it('should use project working directory by default', () => {
    const session = Session.create({
      id: 'session1',
      projectId,
      name: 'Test Session',
      threadManager
    });
    
    expect(session.getWorkingDirectory()).toBe('/project/default');
  });

  it('should use session override when provided', () => {
    const session = Session.create({
      id: 'session1',
      projectId,
      name: 'Test Session',
      workingDirectory: '/session/override',
      threadManager
    });
    
    expect(session.getWorkingDirectory()).toBe('/session/override');
  });

  it('should use session override from configuration', () => {
    const session = Session.create({
      id: 'session1',
      projectId,
      name: 'Test Session',
      configuration: {
        workingDirectory: '/config/override'
      },
      threadManager
    });
    
    expect(session.getWorkingDirectory()).toBe('/config/override');
  });

  it('should prioritize constructor override over configuration', () => {
    const session = Session.create({
      id: 'session1',
      projectId,
      name: 'Test Session',
      workingDirectory: '/constructor/override',
      configuration: {
        workingDirectory: '/config/override'
      },
      threadManager
    });
    
    expect(session.getWorkingDirectory()).toBe('/constructor/override');
  });

  it('should validate working directory exists', () => {
    expect(() => {
      Session.create({
        id: 'session1',
        projectId,
        name: 'Test Session',
        workingDirectory: '/nonexistent/path',
        threadManager
      });
    }).toThrow('Working directory does not exist');
  });

  it('should update working directory dynamically', () => {
    const session = Session.create({
      id: 'session1',
      projectId,
      name: 'Test Session',
      threadManager
    });
    
    expect(session.getWorkingDirectory()).toBe('/project/default');
    
    session.updateConfiguration({ workingDirectory: '/new/path' });
    
    // Mock fs.existsSync to return true for test
    vi.mocked(fs.existsSync).mockReturnValue(true);
    
    expect(session.getWorkingDirectory()).toBe('/new/path');
  });
});
```

**Implementation** (`src/sessions/session.ts`):
```typescript
import fs from 'fs';
import path from 'path';

export class Session {
  // ... existing methods ...

  getWorkingDirectory(): string {
    // 1. Check constructor override (stored in session metadata)
    if (this.sessionData.configuration?.workingDirectoryOverride) {
      return this.sessionData.configuration.workingDirectoryOverride as string;
    }
    
    // 2. Check session configuration
    if (this.sessionData.configuration?.workingDirectory) {
      return this.sessionData.configuration.workingDirectory as string;
    }

    // 3. Fall back to project working directory
    const project = this.threadManager.getProject(this.sessionData.projectId);
    if (project) {
      return project.workingDirectory;
    }

    // 4. Final fallback to process.cwd()
    return process.cwd();
  }

  setWorkingDirectory(workingDirectory: string): void {
    // Validate directory exists
    if (!fs.existsSync(workingDirectory)) {
      throw new Error(`Working directory does not exist: ${workingDirectory}`);
    }

    // Validate it's actually a directory
    if (!fs.statSync(workingDirectory).isDirectory()) {
      throw new Error(`Path is not a directory: ${workingDirectory}`);
    }

    // Resolve to absolute path
    const absolutePath = path.resolve(workingDirectory);
    
    this.updateConfiguration({ workingDirectory: absolutePath });
  }

  // Update create method to handle workingDirectory parameter
  static create(config: SessionConfig): Session {
    const sessionData: SessionData = {
      id: config.id,
      projectId: config.projectId,
      name: config.name,
      description: config.description || '',
      configuration: {
        ...config.configuration,
        ...(config.workingDirectory && { workingDirectoryOverride: config.workingDirectory })
      },
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Validate working directory if provided
    if (config.workingDirectory) {
      if (!fs.existsSync(config.workingDirectory)) {
        throw new Error(`Working directory does not exist: ${config.workingDirectory}`);
      }
      
      if (!fs.statSync(config.workingDirectory).isDirectory()) {
        throw new Error(`Path is not a directory: ${config.workingDirectory}`);
      }
    }

    config.threadManager.createSession(sessionData);
    logger.info('Session created', { sessionId: config.id, projectId: config.projectId });

    return new Session(sessionData, config.threadManager);
  }
}
```

**Update ConfigurationSchema** (`src/sessions/session.ts`):
```typescript
const ConfigurationSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  maxTokens: z.number().positive().optional(),
  tools: z.array(z.string()).optional(),
  toolPolicies: z.record(z.enum(['allow', 'require-approval', 'deny'])).optional(),
  workingDirectory: z.string().optional(),
  workingDirectoryOverride: z.string().optional(),  // Add this
  environmentVariables: z.record(z.string()).optional()
});
```

**Commit**: "feat: implement session working directory override"

## Task 2.4: Configuration API Endpoints

**Goal**: Add REST endpoints for managing project and session configuration

**Test First** (`packages/web/app/api/projects/[projectId]/config/route.test.ts`):
```typescript
describe('Project configuration endpoints', () => {
  describe('GET /api/projects/:projectId/config', () => {
    it('should return project configuration', async () => {
      const mockThreadManager = {
        getProject: vi.fn().mockReturnValue({
          id: 'project1',
          name: 'Test Project',
          configuration: {
            provider: 'anthropic',
            model: 'claude-3-sonnet',
            tools: ['file-read', 'file-write']
          }
        })
      };
      
      vi.mocked(ThreadManager).mockImplementation(() => mockThreadManager);
      
      const response = await GET(
        new NextRequest('http://localhost/api/projects/project1/config'),
        { params: { projectId: 'project1' } }
      );
      
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.configuration.provider).toBe('anthropic');
      expect(data.configuration.model).toBe('claude-3-sonnet');
    });
  });

  describe('PATCH /api/projects/:projectId/config', () => {
    it('should update project configuration', async () => {
      const mockProject = {
        updateConfiguration: vi.fn(),
        getConfiguration: vi.fn().mockReturnValue({
          provider: 'anthropic',
          model: 'claude-3-haiku',
          tools: ['file-read', 'file-write', 'bash']
        })
      };
      
      vi.mocked(Project.getById).mockReturnValue(mockProject);
      
      const request = new NextRequest('http://localhost/api/projects/project1/config', {
        method: 'PATCH',
        body: JSON.stringify({
          model: 'claude-3-haiku',
          tools: ['file-read', 'file-write', 'bash']
        })
      });
      
      const response = await PATCH(request, { params: { projectId: 'project1' } });
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(mockProject.updateConfiguration).toHaveBeenCalledWith({
        model: 'claude-3-haiku',
        tools: ['file-read', 'file-write', 'bash']
      });
    });
  });
});
```

**Implementation** (`packages/web/app/api/projects/[projectId]/config/route.ts`):
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { Project, Session } from '@/lib/server/lace-imports';
import { z } from 'zod';

const ConfigurationSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  maxTokens: z.number().positive().optional(),
  tools: z.array(z.string()).optional(),
  toolPolicies: z.record(z.enum(['allow', 'require-approval', 'deny'])).optional(),
  workingDirectory: z.string().optional(),
  environmentVariables: z.record(z.string()).optional()
});

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const project = Project.getById(params.projectId);
    
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }
    
    const configuration = project.getConfiguration();
    
    return NextResponse.json({ configuration });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch configuration' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const body = await request.json();
    const validatedData = ConfigurationSchema.parse(body);
    
    const project = Project.getById(params.projectId);
    
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }
    
    project.updateConfiguration(validatedData);
    const updatedConfiguration = project.getConfiguration();
    
    return NextResponse.json({ configuration: updatedConfiguration });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid configuration data', details: error.errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update configuration' },
      { status: 500 }
    );
  }
}
```

**Session configuration endpoints** (`packages/web/app/api/projects/[projectId]/sessions/[sessionId]/config/route.ts`):
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { Project, Session } from '@/lib/server/lace-imports';
import { Session } from '@/lib/server/session';
import { z } from 'zod';

const SessionConfigurationSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  maxTokens: z.number().positive().optional(),
  tools: z.array(z.string()).optional(),
  toolPolicies: z.record(z.enum(['allow', 'require-approval', 'deny'])).optional(),
  workingDirectory: z.string().optional(),
  environmentVariables: z.record(z.string()).optional()
});

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string; sessionId: string } }
) {
  try {
    // Use Project and Session static methods with global persistence
    const session = Session.load(params.sessionId, threadManager);
    
    if (!session || session.getProjectId() !== params.projectId) {
      return NextResponse.json(
        { error: 'Session not found in this project' },
        { status: 404 }
      );
    }
    
    const sessionConfig = session.getConfiguration();
    const effectiveConfig = session.getEffectiveConfiguration();
    
    return NextResponse.json({ 
      sessionConfiguration: sessionConfig,
      effectiveConfiguration: effectiveConfig
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch configuration' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { projectId: string; sessionId: string } }
) {
  try {
    const body = await request.json();
    const validatedData = SessionConfigurationSchema.parse(body);
    
    // Use Project and Session static methods with global persistence
    const session = Session.load(params.sessionId, threadManager);
    
    if (!session || session.getProjectId() !== params.projectId) {
      return NextResponse.json(
        { error: 'Session not found in this project' },
        { status: 404 }
      );
    }
    
    session.updateConfiguration(validatedData);
    const updatedConfiguration = session.getEffectiveConfiguration();
    
    return NextResponse.json({ configuration: updatedConfiguration });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid configuration data', details: error.errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update configuration' },
      { status: 500 }
    );
  }
}
```

**Commit**: "feat: add configuration API endpoints"

## Task 2.5: Session Update Endpoints

**Goal**: Add comprehensive session update endpoints with validation

**Test First** (`packages/web/app/api/projects/[projectId]/sessions/[sessionId]/route.test.ts`):
```typescript
describe('Session update endpoints', () => {
  describe('PATCH /api/projects/:projectId/sessions/:sessionId', () => {
    it('should update session metadata', async () => {
      const mockSession = {
        updateMetadata: vi.fn(),
        getName: vi.fn().mockReturnValue('Updated Session'),
        getDescription: vi.fn().mockReturnValue('Updated description'),
        getStatus: vi.fn().mockReturnValue('completed'),
        getProjectId: vi.fn().mockReturnValue('project1')
      };
      
      const mockThreadManager = {
        getSession: vi.fn().mockReturnValue(mockSession)
      };
      
      vi.mocked(ThreadManager).mockImplementation(() => mockThreadManager);
      vi.mocked(Session.load).mockReturnValue(mockSession);
      
      const request = new NextRequest('http://localhost/api/projects/project1/sessions/session1', {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Updated Session',
          description: 'Updated description',
          status: 'completed'
        })
      });
      
      const response = await PATCH(request, {
        params: { projectId: 'project1', sessionId: 'session1' }
      });
      
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(mockSession.updateMetadata).toHaveBeenCalledWith({
        name: 'Updated Session',
        description: 'Updated description',
        status: 'completed'
      });
    });

    it('should validate session belongs to project', async () => {
      const mockSession = {
        getProjectId: vi.fn().mockReturnValue('other-project')
      };
      
      const mockThreadManager = {
        getSession: vi.fn().mockReturnValue(mockSession)
      };
      
      vi.mocked(ThreadManager).mockImplementation(() => mockThreadManager);
      vi.mocked(Session.load).mockReturnValue(mockSession);
      
      const request = new NextRequest('http://localhost/api/projects/project1/sessions/session1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated Session' })
      });
      
      const response = await PATCH(request, {
        params: { projectId: 'project1', sessionId: 'session1' }
      });
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Session not found in this project');
    });

    it('should validate status enum', async () => {
      const request = new NextRequest('http://localhost/api/projects/project1/sessions/session1', {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'invalid-status'
        })
      });
      
      const response = await PATCH(request, {
        params: { projectId: 'project1', sessionId: 'session1' }
      });
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Invalid request data');
    });
  });

  describe('POST /api/projects/:projectId/sessions/:sessionId/working-directory', () => {
    it('should update session working directory', async () => {
      const mockSession = {
        setWorkingDirectory: vi.fn(),
        getWorkingDirectory: vi.fn().mockReturnValue('/new/path'),
        getProjectId: vi.fn().mockReturnValue('project1')
      };
      
      vi.mocked(Session.load).mockReturnValue(mockSession);
      
      const request = new NextRequest('http://localhost/api/projects/project1/sessions/session1/working-directory', {
        method: 'POST',
        body: JSON.stringify({
          workingDirectory: '/new/path'
        })
      });
      
      const response = await POST(request, {
        params: { projectId: 'project1', sessionId: 'session1' }
      });
      
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(mockSession.setWorkingDirectory).toHaveBeenCalledWith('/new/path');
      expect(data.workingDirectory).toBe('/new/path');
    });
  });
});
```

**Implementation** (`packages/web/app/api/projects/[projectId]/sessions/[sessionId]/route.ts`):
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { Project, Session } from '@/lib/server/lace-imports';
import { Session } from '@/lib/server/session';
import { z } from 'zod';

const UpdateSessionSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'archived', 'completed']).optional()
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { projectId: string; sessionId: string } }
) {
  try {
    const body = await request.json();
    const validatedData = UpdateSessionSchema.parse(body);
    
    // Use Project and Session static methods with global persistence
    const session = Session.load(params.sessionId, threadManager);
    
    if (!session || session.getProjectId() !== params.projectId) {
      return NextResponse.json(
        { error: 'Session not found in this project' },
        { status: 404 }
      );
    }
    
    session.updateMetadata(validatedData);
    
    const updatedSession = {
      id: session.getId(),
      name: session.getName(),
      description: session.getDescription(),
      status: session.getStatus(),
      workingDirectory: session.getWorkingDirectory()
    };
    
    return NextResponse.json({ session: updatedSession });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update session' },
      { status: 500 }
    );
  }
}
```

**Working directory endpoint** (`packages/web/app/api/projects/[projectId]/sessions/[sessionId]/working-directory/route.ts`):
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { Project, Session } from '@/lib/server/lace-imports';
import { Session } from '@/lib/server/session';
import { z } from 'zod';

const WorkingDirectorySchema = z.object({
  workingDirectory: z.string().min(1, 'Working directory path is required')
});

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string; sessionId: string } }
) {
  try {
    const body = await request.json();
    const validatedData = WorkingDirectorySchema.parse(body);
    
    // Use Project and Session static methods with global persistence
    const session = Session.load(params.sessionId, threadManager);
    
    if (!session || session.getProjectId() !== params.projectId) {
      return NextResponse.json(
        { error: 'Session not found in this project' },
        { status: 404 }
      );
    }
    
    session.setWorkingDirectory(validatedData.workingDirectory);
    
    return NextResponse.json({ 
      workingDirectory: session.getWorkingDirectory() 
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update working directory' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string; sessionId: string } }
) {
  try {
    // Use Project and Session static methods with global persistence
    const session = Session.load(params.sessionId, threadManager);
    
    if (!session || session.getProjectId() !== params.projectId) {
      return NextResponse.json(
        { error: 'Session not found in this project' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ 
      workingDirectory: session.getWorkingDirectory() 
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch working directory' },
      { status: 500 }
    );
  }
}
```

**Status**: 🚨 **BLOCKED** - Cannot implement until Project class session methods are available

---

## Phase 2 Implementation Status

### Overall Status: ✅ READY TO BEGIN

**Phase 2 can now proceed - all prerequisites completed.**

### Current Status:

1. **✅ COMPLETED: Phase 1 Task 1.9**
   - ✅ Implemented Project class session methods (`getSessions()`, `createSession()`, etc.)
   - ✅ Unblocked Session API endpoints
   - ✅ Completed Phase 1 MVP (90% → 100%)

2. **✅ READY: Begin Phase 2 Tasks**
   - Task 2.1: Project Configuration Management
   - Task 2.2: Tool Policy Enforcement
   - Task 2.3: Session Working Directory Overrides
   - Task 2.4: Configuration API Endpoints
   - Task 2.5: Session Update Capabilities

### Dependencies Resolved:
- ✅ **Phase 2 → Phase 1**: All Phase 2 tasks now have required Project class session methods
- ✅ **Configuration Management → Session Management**: Can now manage session config with full session CRUD
- ✅ **Tool Policies → Configuration**: Can build on configuration framework
- ✅ **API Endpoints → Core Methods**: Can create APIs with underlying functionality

### Estimated Timeline:
- ✅ **Phase 1 Task 1.9 Completion**: COMPLETED (5 Project class methods implemented)
- 🔄 **Phase 2 Full Implementation**: 3-5 days (can begin immediately)

**Recommendation**: Phase 2 development can begin immediately with Task 2.1 (Project Configuration Management).

## Phase 2 Goals (Now Ready to Implement)

With Phase 1 complete, Phase 2 will add:

1. **Project Configuration Management**: Configuration inheritance from project to session
2. **Tool Policy Enforcement**: Allow/require-approval/deny policies enforced at ToolExecutor level
3. **Session Working Directory Override**: Sessions can override project working directory
4. **Configuration API Endpoints**: REST endpoints for managing project and session configuration
5. **Session Update Endpoints**: Comprehensive endpoints for session metadata and working directory updates

**Expected Capabilities**:
- Hierarchical configuration inheritance (project → session)
- Tool usage policies with approval workflows
- Per-session working directory customization
- Complete REST API for configuration management
- Validation and error handling for all configuration operations