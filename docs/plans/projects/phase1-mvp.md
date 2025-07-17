# Phase 1: MVP - Basic Project Support

## Task 1.1: Database Schema for Projects and Sessions

**Goal**: Add projects and sessions tables with proper foreign key relationships

**Test First** (`src/persistence/database.test.ts`):
```typescript
describe('Project and Session database schema', () => {
  it('should create projects table on initialization', () => {
    const db = new DatabasePersistence(':memory:');
    
    const tables = db.database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='projects'"
    ).all();
    
    expect(tables).toContainEqual({ name: 'projects' });
  });

  it('should create sessions table on initialization', () => {
    const db = new DatabasePersistence(':memory:');
    
    const tables = db.database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
    ).all();
    
    expect(tables).toContainEqual({ name: 'sessions' });
  });

  it('should have correct projects table schema', () => {
    const db = new DatabasePersistence(':memory:');
    
    const columns = db.database.prepare('PRAGMA table_info(projects)').all();
    const columnNames = columns.map(c => c.name);
    
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('name');
    expect(columnNames).toContain('description');
    expect(columnNames).toContain('working_directory');
    expect(columnNames).toContain('configuration');
    expect(columnNames).toContain('is_archived');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('last_used_at');
  });

  it('should have correct sessions table schema', () => {
    const db = new DatabasePersistence(':memory:');
    
    const columns = db.database.prepare('PRAGMA table_info(sessions)').all();
    const columnNames = columns.map(c => c.name);
    
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('project_id');
    expect(columnNames).toContain('name');
    expect(columnNames).toContain('description');
    expect(columnNames).toContain('configuration');
    expect(columnNames).toContain('status');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
  });

  it('should add session_id to threads table', () => {
    const db = new DatabasePersistence(':memory:');
    
    const columns = db.database.prepare('PRAGMA table_info(threads)').all();
    const sessionIdColumn = columns.find(c => c.name === 'session_id');
    
    expect(sessionIdColumn).toBeDefined();
  });

  it('should create Historical project for migration', () => {
    const db = new DatabasePersistence(':memory:');
    
    const project = db.database.prepare(
      "SELECT * FROM projects WHERE id = 'historical'"
    ).get();
    
    expect(project).toBeDefined();
    expect(project.name).toBe('Historical');
    expect(project.working_directory).toBe(process.cwd());
  });

  it('should migrate existing session threads to sessions table', () => {
    // Create separate database for migration test
    const migrationDb = new Database(':memory:');
    
    // Create old schema without migration
    migrationDb.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata TEXT
      );
      
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    
    // Insert old session thread with isSession metadata
    migrationDb.prepare(`
      INSERT INTO threads (id, created_at, updated_at, metadata)
      VALUES ('old_session', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z', '{"isSession": true, "name": "Old Session"}')
    `).run();
    
    // Set schema version to 5 (before sessions migration)
    migrationDb.prepare('INSERT INTO schema_version (version, applied_at) VALUES (5, ?)')
      .run(new Date().toISOString());
    
    // Run migration by creating DatabasePersistence
    new DatabasePersistence(migrationDb);
    
    // Check session was created in sessions table
    const session = migrationDb.prepare("SELECT * FROM sessions WHERE id = 'old_session'").get();
    expect(session).toBeDefined();
    expect(session.name).toBe('Old Session');
    expect(session.project_id).toBe('historical');
    
    // Check thread was updated with session_id
    const thread = migrationDb.prepare("SELECT * FROM threads WHERE id = 'old_session'").get();
    expect(thread.session_id).toBe('old_session');
    expect(JSON.parse(thread.metadata)).not.toHaveProperty('isSession');
  });
});
```

**Implementation** (`src/persistence/database.ts`):
```typescript
private migrateToV6(): void {
  if (!this.db) return;

  // Create sessions table
  this.db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      configuration TEXT DEFAULT '{}',
      status TEXT CHECK(status IN ('active', 'archived', 'completed')) DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  // Add session_id to threads table
  const hasSessionId = (this.db.prepare(
    "SELECT COUNT(*) as count FROM pragma_table_info('threads') WHERE name='session_id'"
  ).get() as { count: number }).count > 0;

  if (!hasSessionId) {
    this.db.exec('ALTER TABLE threads ADD COLUMN session_id TEXT');
  }

  // Migrate existing session threads to sessions table
  const sessionThreads = this.db.prepare(`
    SELECT id, created_at, updated_at, metadata, project_id
    FROM threads 
    WHERE metadata IS NOT NULL 
    AND json_extract(metadata, '$.isSession') = 1
  `).all() as Array<{
    id: string;
    created_at: string;
    updated_at: string;
    metadata: string;
    project_id: string;
  }>;

  for (const sessionThread of sessionThreads) {
    const metadata = JSON.parse(sessionThread.metadata);
    
    // Create session record
    this.db.prepare(`
      INSERT OR IGNORE INTO sessions (id, project_id, name, description, configuration, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionThread.id,
      sessionThread.project_id || 'historical',
      metadata.name || 'Untitled Session',
      metadata.description || '',
      JSON.stringify(metadata.configuration || {}),
      sessionThread.created_at,
      sessionThread.updated_at
    );

    // Update thread to reference session and remove isSession metadata
    const cleanMetadata = { ...metadata };
    delete cleanMetadata.isSession;
    delete cleanMetadata.name;
    delete cleanMetadata.description;
    delete cleanMetadata.configuration;

    this.db.prepare(`
      UPDATE threads 
      SET session_id = ?, metadata = ?
      WHERE id = ?
    `).run(
      sessionThread.id,
      Object.keys(cleanMetadata).length > 0 ? JSON.stringify(cleanMetadata) : null,
      sessionThread.id
    );
  }

  this.setSchemaVersion(6);
}
```

**Update runMigrations** (`src/persistence/database.ts`):
```typescript
private runMigrations(): void {
  if (!this.db) return;

  const currentVersion = this.getSchemaVersion();

  if (currentVersion < 1) {
    this.migrateToV1();
  }

  if (currentVersion < 2) {
    this.migrateToV2();
  }

  if (currentVersion < 3) {
    this.migrateToV3();
  }

  if (currentVersion < 4) {
    this.migrateToV4();
  }

  if (currentVersion < 5) {
    this.migrateToV5();
  }

  if (currentVersion < 6) {
    this.migrateToV6();
  }
}
```

**Commit**: "feat: add sessions table and migrate session threads"

## Task 1.2: Session Persistence Layer

**Goal**: Create dedicated session persistence methods

**Test First** (`src/persistence/database.test.ts`):
```typescript
describe('Session persistence', () => {
  let db: DatabasePersistence;

  beforeEach(() => {
    db = new DatabasePersistence(':memory:');
  });

  it('should save session', () => {
    const session = {
      id: 'session1',
      projectId: 'project1',
      name: 'Test Session',
      description: 'A test session',
      configuration: { provider: 'anthropic' },
      status: 'active' as const,
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01')
    };

    db.saveSession(session);

    const saved = db.loadSession('session1');
    expect(saved).toEqual(session);
  });

  it('should load session by id', () => {
    const session = {
      id: 'session1',
      projectId: 'project1',
      name: 'Test Session',
      description: 'A test session',
      configuration: { provider: 'anthropic' },
      status: 'active' as const,
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01')
    };

    db.saveSession(session);
    const loaded = db.loadSession('session1');

    expect(loaded).toEqual(session);
  });

  it('should load sessions by project', () => {
    const session1 = {
      id: 'session1',
      projectId: 'project1',
      name: 'Session 1',
      description: '',
      configuration: {},
      status: 'active' as const,
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01')
    };

    const session2 = {
      id: 'session2',
      projectId: 'project1',
      name: 'Session 2',
      description: '',
      configuration: {},
      status: 'active' as const,
      createdAt: new Date('2023-01-02'),
      updatedAt: new Date('2023-01-02')
    };

    const session3 = {
      id: 'session3',
      projectId: 'project2',
      name: 'Session 3',
      description: '',
      configuration: {},
      status: 'active' as const,
      createdAt: new Date('2023-01-03'),
      updatedAt: new Date('2023-01-03')
    };

    db.saveSession(session1);
    db.saveSession(session2);
    db.saveSession(session3);

    const project1Sessions = db.loadSessionsByProject('project1');
    expect(project1Sessions).toHaveLength(2);
    expect(project1Sessions.map(s => s.id)).toContain('session1');
    expect(project1Sessions.map(s => s.id)).toContain('session2');
  });

  it('should update session', () => {
    const session = {
      id: 'session1',
      projectId: 'project1',
      name: 'Original Name',
      description: 'Original description',
      configuration: { provider: 'anthropic' },
      status: 'active' as const,
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01')
    };

    db.saveSession(session);

    const updates = {
      name: 'Updated Name',
      description: 'Updated description',
      status: 'completed' as const,
      updatedAt: new Date('2023-01-02')
    };

    db.updateSession('session1', updates);

    const updated = db.loadSession('session1');
    expect(updated.name).toBe('Updated Name');
    expect(updated.description).toBe('Updated description');
    expect(updated.status).toBe('completed');
    expect(updated.updatedAt).toEqual(new Date('2023-01-02'));
  });

  it('should delete session', () => {
    const session = {
      id: 'session1',
      projectId: 'project1',
      name: 'Test Session',
      description: '',
      configuration: {},
      status: 'active' as const,
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01')
    };

    db.saveSession(session);
    expect(db.loadSession('session1')).not.toBeNull();

    db.deleteSession('session1');
    expect(db.loadSession('session1')).toBeNull();
  });
});
```

**Implementation** (`src/persistence/database.ts`):
```typescript
// Add session types
export interface SessionData {
  id: string;
  projectId: string;
  name: string;
  description: string;
  configuration: Record<string, unknown>;
  status: 'active' | 'archived' | 'completed';
  createdAt: Date;
  updatedAt: Date;
}

// Session persistence methods
saveSession(session: SessionData): void {
  if (this._closed || this._disabled || !this.db) return;

  const stmt = this.db.prepare(`
    INSERT OR REPLACE INTO sessions (id, project_id, name, description, configuration, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    session.id,
    session.projectId,
    session.name,
    session.description,
    JSON.stringify(session.configuration),
    session.status,
    session.createdAt.toISOString(),
    session.updatedAt.toISOString()
  );
}

loadSession(sessionId: string): SessionData | null {
  if (this._disabled || !this.db) return null;

  const stmt = this.db.prepare(`
    SELECT * FROM sessions WHERE id = ?
  `);

  const row = stmt.get(sessionId) as {
    id: string;
    project_id: string;
    name: string;
    description: string;
    configuration: string;
    status: string;
    created_at: string;
    updated_at: string;
  } | undefined;

  if (!row) return null;

  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    configuration: JSON.parse(row.configuration),
    status: row.status as 'active' | 'archived' | 'completed',
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

loadSessionsByProject(projectId: string): SessionData[] {
  if (this._disabled || !this.db) return [];

  const stmt = this.db.prepare(`
    SELECT * FROM sessions 
    WHERE project_id = ? 
    ORDER BY updated_at DESC
  `);

  const rows = stmt.all(projectId) as Array<{
    id: string;
    project_id: string;
    name: string;
    description: string;
    configuration: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map(row => ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    configuration: JSON.parse(row.configuration),
    status: row.status as 'active' | 'archived' | 'completed',
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }));
}

updateSession(sessionId: string, updates: Partial<SessionData>): void {
  if (this._closed || this._disabled || !this.db) return;

  const updateFields: string[] = [];
  const values: (string | number)[] = [];

  if (updates.name !== undefined) {
    updateFields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    updateFields.push('description = ?');
    values.push(updates.description);
  }
  if (updates.configuration !== undefined) {
    updateFields.push('configuration = ?');
    values.push(JSON.stringify(updates.configuration));
  }
  if (updates.status !== undefined) {
    updateFields.push('status = ?');
    values.push(updates.status);
  }

  // Always update timestamp
  updateFields.push('updated_at = ?');
  values.push(new Date().toISOString());

  values.push(sessionId);

  const stmt = this.db.prepare(`
    UPDATE sessions 
    SET ${updateFields.join(', ')}
    WHERE id = ?
  `);

  const result = stmt.run(...values);
  if (result.changes === 0) {
    throw new Error(`Session ${sessionId} not found`);
  }
}

deleteSession(sessionId: string): void {
  if (this._closed || this._disabled || !this.db) return;

  const stmt = this.db.prepare(`
    DELETE FROM sessions WHERE id = ?
  `);

  const result = stmt.run(sessionId);
  if (result.changes === 0) {
    throw new Error(`Session ${sessionId} not found`);
  }
}
```

**Commit**: "feat: add session persistence methods"

## Task 1.3: ThreadManager Session Support

**Goal**: Update ThreadManager to work with sessions table instead of isSession metadata

**Test First** (`src/threads/thread-manager.test.ts`):
```typescript
describe('ThreadManager session support', () => {
  let manager: ThreadManager;
  let sessionId: string;

  beforeEach(() => {
    manager = new ThreadManager(':memory:');
    
    // Create a session first
    const session = {
      id: 'session1',
      projectId: 'project1',
      name: 'Test Session',
      description: 'A test session',
      configuration: {},
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    manager.createSession(session);
    sessionId = session.id;
  });

  it('should create thread with session_id', () => {
    const threadId = manager.createThread(sessionId);
    const thread = manager.getThread(threadId);
    
    expect(thread).toBeDefined();
    expect(thread.sessionId).toBe(sessionId);
  });

  it('should get threads by session', () => {
    const thread1Id = manager.createThread(sessionId);
    const thread2Id = manager.createThread(sessionId);
    
    const threads = manager.getThreadsBySession(sessionId);
    
    expect(threads).toHaveLength(2);
    expect(threads.map(t => t.id)).toContain(thread1Id);
    expect(threads.map(t => t.id)).toContain(thread2Id);
  });

  it('should get sessions by project', () => {
    const session2 = {
      id: 'session2',
      projectId: 'project1',
      name: 'Session 2',
      description: '',
      configuration: {},
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    manager.createSession(session2);
    
    const sessions = manager.getSessionsByProject('project1');
    
    expect(sessions).toHaveLength(2);
    expect(sessions.map(s => s.id)).toContain('session1');
    expect(sessions.map(s => s.id)).toContain('session2');
  });

  it('should not return threads marked as sessions (legacy)', () => {
    // Create old-style session thread for backwards compatibility test
    const legacySessionId = manager.createThread();
    manager.updateThreadMetadata(legacySessionId, { isSession: true });
    
    const threads = manager.getAllThreads();
    const legacyThread = threads.find(t => t.id === legacySessionId);
    
    // Should still exist but not be returned by getThreadsBySession
    expect(legacyThread).toBeDefined();
    expect(manager.getThreadsBySession(legacySessionId)).toHaveLength(0);
  });
});
```

**Implementation** (`src/threads/thread-manager.ts`):
```typescript
import { SessionData } from '~/persistence/database';

export class ThreadManager {
  // ... existing methods ...

  createSession(session: SessionData): void {
    this.persistence.saveSession(session);
    logger.info('Session created', { sessionId: session.id, projectId: session.projectId });
  }

  getSession(sessionId: string): SessionData | null {
    return this.persistence.loadSession(sessionId);
  }

  getSessionsByProject(projectId: string): SessionData[] {
    return this.persistence.loadSessionsByProject(projectId);
  }

  updateSession(sessionId: string, updates: Partial<SessionData>): void {
    this.persistence.updateSession(sessionId, updates);
    logger.info('Session updated', { sessionId, updates });
  }

  deleteSession(sessionId: string): void {
    // First delete all threads in this session
    const threads = this.getThreadsBySession(sessionId);
    for (const thread of threads) {
      this.deleteThread(thread.id);
    }
    
    // Then delete the session
    this.persistence.deleteSession(sessionId);
    logger.info('Session deleted', { sessionId });
  }

  createThread(sessionId?: string, projectId?: string): string {
    const threadId = generateId();
    const now = new Date();
    
    const thread: Thread = {
      id: threadId,
      sessionId,
      projectId,
      createdAt: now,
      updatedAt: now,
      events: [],
      metadata: undefined
    };

    this.persistence.saveThread(thread);
    logger.info('Thread created', { threadId, sessionId, projectId });
    
    return threadId;
  }

  getThreadsBySession(sessionId: string): Thread[] {
    if (this.persistence._disabled) return [];
    
    const stmt = this.persistence.db?.prepare(`
      SELECT * FROM threads 
      WHERE session_id = ?
      ORDER BY updated_at DESC
    `);
    
    if (!stmt) return [];
    
    const rows = stmt.all(sessionId) as Array<{
      id: string;
      session_id: string;
      project_id: string;
      created_at: string;
      updated_at: string;
      metadata: string | null;
    }>;
    
    return rows.map(row => {
      const events = this.persistence.loadEvents(row.id);
      let metadata: Thread['metadata'] = undefined;
      
      if (row.metadata) {
        try {
          metadata = JSON.parse(row.metadata);
        } catch (error) {
          logger.warn('Failed to parse thread metadata', { threadId: row.id, error });
        }
      }
      
      return {
        id: row.id,
        sessionId: row.session_id,
        projectId: row.project_id,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        events,
        metadata
      };
    });
  }

  // Update existing methods to not treat threads as sessions
  getAllThreads(): Thread[] {
    const threads = this.persistence.getAllThreadsWithMetadata();
    
    // Filter out legacy session threads to avoid confusion
    return threads.filter(thread => !thread.metadata?.isSession);
  }
}
```

**Update Thread interface** (`src/threads/types.ts`):
```typescript
export interface Thread {
  id: string;
  sessionId?: string;  // Add session reference
  projectId?: string;
  createdAt: Date;
  updatedAt: Date;
  events: ThreadEvent[];
  metadata?: Record<string, unknown>;
}
```

**Update DatabasePersistence.saveThread** (`src/persistence/database.ts`):
```typescript
saveThread(thread: Thread): void {
  if (this._closed || this._disabled || !this.db) return;

  const stmt = this.db.prepare(`
    INSERT OR REPLACE INTO threads (id, session_id, project_id, created_at, updated_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const metadataJson = thread.metadata ? JSON.stringify(thread.metadata) : null;
  stmt.run(
    thread.id,
    thread.sessionId || null,
    thread.projectId || null,
    thread.createdAt.toISOString(),
    thread.updatedAt.toISOString(),
    metadataJson
  );
}
```

**Commit**: "feat: add session support to ThreadManager"

## Task 1.4: Working Directory in ToolContext ✅

**Goal**: Pass working directory through ToolContext to all tools

**Status**: COMPLETED - Added workingDirectory field to ToolContext interface, Agent now resolves and passes working directory from session/project hierarchy

**Test First** (`src/tools/tool-context.test.ts`):
```typescript
describe('ToolContext working directory', () => {
  it('should include working directory in context', () => {
    const context = new ToolContext({
      threadId: 'thread1',
      sessionId: 'session1',
      projectId: 'project1',
      workingDirectory: '/project/path'
    });
    
    expect(context.workingDirectory).toBe('/project/path');
  });
  
  it('should default to process.cwd() when no working directory provided', () => {
    const context = new ToolContext({
      threadId: 'thread1',
      sessionId: 'session1',
      projectId: 'project1'
    });
    
    expect(context.workingDirectory).toBe(process.cwd());
  });
});
```

**Implementation** (`src/tools/tool-context.ts`):
```typescript
export interface ToolContextData {
  threadId: string;
  sessionId?: string;
  projectId?: string;
  workingDirectory?: string;
}

export class ToolContext {
  public readonly threadId: string;
  public readonly sessionId?: string;
  public readonly projectId?: string;
  public readonly workingDirectory: string;

  constructor(data: ToolContextData) {
    this.threadId = data.threadId;
    this.sessionId = data.sessionId;
    this.projectId = data.projectId;
    this.workingDirectory = data.workingDirectory || process.cwd();
  }
}
```

**Update Agent to pass working directory** (`src/agents/agent.ts`):
```typescript
export class Agent {
  // ... existing methods ...

  private async getWorkingDirectory(): Promise<string> {
    if (!this.sessionId) {
      return process.cwd();
    }
    
    const session = this.threadManager.getSession(this.sessionId);
    if (!session) {
      return process.cwd();
    }
    
    // Check for session-level working directory override
    if (session.configuration?.workingDirectory) {
      return session.configuration.workingDirectory as string;
    }
    
    // Fall back to project working directory
    if (session.projectId) {
      const project = this.threadManager.getProject(session.projectId);
      if (project) {
        return project.workingDirectory;
      }
    }
    
    return process.cwd();
  }

  private async createToolContext(): Promise<ToolContext> {
    const workingDirectory = await this.getWorkingDirectory();
    
    return new ToolContext({
      threadId: this.threadId,
      sessionId: this.sessionId,
      projectId: this.projectId,
      workingDirectory
    });
  }

  // Update tool execution to use the context
  private async executeTool(toolCall: ToolCall): Promise<void> {
    const context = await this.createToolContext();
    
    const result = await this.toolExecutor.execute(
      toolCall.name,
      toolCall.arguments,
      context
    );
    
    // ... rest of method
  }
}
```

**Commit**: "feat: add working directory support to ToolContext"

## Task 1.5: Update Tools to Use Working Directory

**Goal**: Update file operation tools to use working directory from context

**Test First** (`src/tools/implementations/file-read.test.ts`):
```typescript
describe('FileReadTool working directory', () => {
  it('should resolve paths relative to working directory', async () => {
    const tool = new FileReadTool();
    const context = new ToolContext({
      threadId: 'thread1',
      workingDirectory: '/project/root'
    });
    
    // Mock fs.readFile to track the resolved path
    const mockReadFile = vi.fn().mockResolvedValue('file content');
    vi.mocked(fs.readFile).mockImplementation(mockReadFile);
    
    await tool.execute({ file_path: 'src/file.ts' }, context);
    
    expect(mockReadFile).toHaveBeenCalledWith('/project/root/src/file.ts', 'utf8');
  });
  
  it('should handle absolute paths correctly', async () => {
    const tool = new FileReadTool();
    const context = new ToolContext({
      threadId: 'thread1',
      workingDirectory: '/project/root'
    });
    
    const mockReadFile = vi.fn().mockResolvedValue('file content');
    vi.mocked(fs.readFile).mockImplementation(mockReadFile);
    
    await tool.execute({ file_path: '/absolute/path/file.ts' }, context);
    
    expect(mockReadFile).toHaveBeenCalledWith('/absolute/path/file.ts', 'utf8');
  });
});
```

**Implementation** (`src/tools/implementations/file-read.ts`):
```typescript
import path from 'path';
import { Tool } from '../tool';
import { ToolContext } from '../tool-context';

export class FileReadTool extends Tool {
  // ... existing schema and metadata ...

  protected async executeValidated(
    args: { file_path: string },
    context?: ToolContext
  ): Promise<ToolResult> {
    const workingDirectory = context?.workingDirectory || process.cwd();
    
    // Resolve path relative to working directory
    const resolvedPath = path.isAbsolute(args.file_path)
      ? args.file_path
      : path.resolve(workingDirectory, args.file_path);
    
    try {
      const content = await fs.readFile(resolvedPath, 'utf8');
      return this.createResult(content);
    } catch (error) {
      return this.createErrorResult(
        `Failed to read file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
```

**Update other file tools similarly** (`src/tools/implementations/file-write.ts`, `file-edit.ts`, `file-list.ts`):
```typescript
// Apply same pattern to all file operation tools
protected async executeValidated(
  args: ToolArgs,
  context?: ToolContext
): Promise<ToolResult> {
  const workingDirectory = context?.workingDirectory || process.cwd();
  const resolvedPath = path.isAbsolute(args.file_path)
    ? args.file_path
    : path.resolve(workingDirectory, args.file_path);
  
  // ... rest of implementation using resolvedPath
}
```

**Update BashTool** (`src/tools/implementations/bash.ts`):
```typescript
export class BashTool extends Tool {
  // ... existing schema and metadata ...

  protected async executeValidated(
    args: { command: string; timeout?: number },
    context?: ToolContext
  ): Promise<ToolResult> {
    const workingDirectory = context?.workingDirectory || process.cwd();
    
    try {
      const result = await this.executeCommand(args.command, {
        timeout: args.timeout || 120000,
        cwd: workingDirectory  // Use working directory as cwd
      });
      
      return this.createResult(result.output, {
        exitCode: result.exitCode,
        workingDirectory
      });
    } catch (error) {
      return this.createErrorResult(
        `Command failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
```

**Commit**: "feat: update tools to use working directory from context"

**✅ COMPLETED**: All tools now use working directory from ToolContext:
- ✅ Base Tool class implements `resolvePath()` method for DRY path resolution
- ✅ File tools (read, write, edit, insert, list, find) use base class `resolvePath()`
- ✅ System tools (bash, ripgrep) use `context.workingDirectory` for exec/search
- ✅ All tools fall back to `process.cwd()` when no working directory provided  
- ✅ Comprehensive working directory tests added (324 tool tests pass)
- ✅ Removed problematic schema path transformations

## Task 1.6: Session Class Project Support

**Goal**: Update existing Session class to use sessions table instead of metadata

**Test First** (Update existing `src/sessions/__tests__/session.test.ts`):
```typescript
describe('Session class project support', () => {
  it('should create session with project context', () => {
    // Set up environment
    process.env.ANTHROPIC_KEY = 'test-key';
    
    const session = Session.create(
      'Test Session',
      'anthropic',
      'claude-3-haiku-20240307',
      ':memory:',
      'project1' // Add projectId parameter
    );
    
    expect(session.getProjectId()).toBe('project1');
    expect(session.getWorkingDirectory()).toBe('/project/path');
  });

  it('should spawn agents with project working directory', () => {
    process.env.ANTHROPIC_KEY = 'test-key';
    
    const session = Session.create(
      'Test Session',
      'anthropic', 
      'claude-3-haiku-20240307',
      ':memory:',
      'project1'
    );
    
    const agent = session.spawnAgent('Worker Agent');
    expect(agent.getWorkingDirectory()).toBe('/project/path');
  });

  it('should store session in sessions table not metadata', () => {
    process.env.ANTHROPIC_KEY = 'test-key';
    
    const session = Session.create(
      'Test Session',
      'anthropic',
      'claude-3-haiku-20240307', 
      ':memory:',
      'project1'
    );
    
    // Verify session is in sessions table
    const threadManager = new ThreadManager(':memory:');
    const sessionData = threadManager.getSession(session.getId());
    expect(sessionData).toBeDefined();
    expect(sessionData.projectId).toBe('project1');
    expect(sessionData.name).toBe('Test Session');
  });

  it('should get sessions from table not metadata in getAll', () => {
    process.env.ANTHROPIC_KEY = 'test-key';
    
    Session.create('Session 1', 'anthropic', 'claude-3-haiku-20240307', ':memory:', 'project1');
    Session.create('Session 2', 'anthropic', 'claude-3-haiku-20240307', ':memory:', 'project1'); 
    
    const sessions = Session.getAll(':memory:');
    expect(sessions).toHaveLength(2);
    expect(sessions[0].name).toBe('Session 1');
    expect(sessions[1].name).toBe('Session 2');
  });
});
```

**Implementation Changes** (`src/sessions/session.ts`):

**Key Changes to Existing Session Class:**

1. **Update `create()` method signature** - Add projectId parameter:
```typescript
static create(
  name: string,
  provider = 'anthropic',
  model = 'claude-3-haiku-20240307',
  dbPath?: string,
  projectId?: string  // NEW: Add project support
): Session
```

2. **Replace metadata approach with sessions table**:
```typescript
// OLD: Mark thread as session via metadata
sessionAgent.updateThreadMetadata({
  isSession: true,
  name,
  provider,
  model,
});

// NEW: Create session record in sessions table  
if (projectId) {
  const sessionData = {
    id: threadId,
    projectId,
    name,
    description: '',
    configuration: { provider, model },
    status: 'active' as const,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  threadManager.createSession(sessionData);
}
```

3. **Add project support methods**:
```typescript
getProjectId(): string | undefined {
  const sessionData = this.getSessionData();
  return sessionData?.projectId;
}

getWorkingDirectory(): string {
  const sessionData = this.getSessionData();
  if (sessionData?.configuration?.workingDirectory) {
    return sessionData.configuration.workingDirectory as string;
  }
  
  if (sessionData?.projectId) {
    const threadManager = new ThreadManager(this._dbPath);
    const project = threadManager.getProject(sessionData.projectId);
    if (project) {
      return project.workingDirectory;
    }
  }
  
  return process.cwd();
}

private getSessionData() {
  const threadManager = new ThreadManager(this._dbPath);
  return threadManager.getSession(this._sessionId);
}
```

4. **Update `getAll()` to use sessions table**:
```typescript
// OLD: Filter threads by isSession metadata
const sessionThreads = allThreads.filter((thread) => thread.metadata?.isSession === true);

// NEW: Get sessions from sessions table
const threadManager = new ThreadManager(dbPath || getLaceDbPath());
const sessions = threadManager.getAllSessions();
return sessions.map(session => ({
  id: asThreadId(session.id),
  name: session.name,
  createdAt: session.createdAt,
  provider: session.configuration?.provider || 'unknown',
  model: session.configuration?.model || 'unknown',
  agents: [], // Will be populated later if needed
}));
```

5. **Update agent creation to pass working directory**:
```typescript
// In spawnAgent() and agent creation, ensure working directory context is passed
const workingDirectory = this.getWorkingDirectory();
// Pass workingDirectory to agent configuration
```

**Commit**: "feat: implement Session class with sessions table support"

## Task 1.7: Agent Working Directory Support

**Goal**: Update Agent to use working directory from session/project

**Test First** (`src/agents/agent.test.ts`):
```typescript
describe('Agent working directory support', () => {
  let threadManager: ThreadManager;
  let agent: Agent;

  beforeEach(() => {
    threadManager = new ThreadManager(':memory:');
    
    // Create project
    const project = {
      id: 'project1',
      name: 'Test Project',
      description: 'A test project',
      workingDirectory: '/project/path',
      configuration: {},
      isArchived: false,
      createdAt: new Date(),
      lastUsedAt: new Date()
    };
    
    threadManager.createProject(project);
    
    // Create session
    const session = {
      id: 'session1',
      projectId: 'project1',
      name: 'Test Session',
      description: '',
      configuration: {},
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    threadManager.createSession(session);
    
    // Create agent
    const threadId = threadManager.createThread('session1', 'project1');
    agent = new Agent({
      threadId,
      sessionId: 'session1',
      projectId: 'project1',
      threadManager
    });
  });

  it('should get working directory from project', () => {
    expect(agent.getWorkingDirectory()).toBe('/project/path');
  });

  it('should use session override when available', () => {
    // Update session with working directory override
    threadManager.updateSession('session1', {
      configuration: { workingDirectory: '/session/override' }
    });
    
    expect(agent.getWorkingDirectory()).toBe('/session/override');
  });

  it('should pass working directory to tool context', async () => {
    const mockTool = {
      execute: vi.fn().mockResolvedValue({ success: true, output: 'test' })
    };
    
    // Mock tool executor
    const mockExecutor = {
      execute: vi.fn((name, args, context) => {
        expect(context.workingDirectory).toBe('/project/path');
        return mockTool.execute(name, args, context);
      })
    };
    
    agent.toolExecutor = mockExecutor;
    
    await agent.executeToolCall({
      id: 'call1',
      name: 'test-tool',
      arguments: {}
    });
    
    expect(mockExecutor.execute).toHaveBeenCalledWith(
      'test-tool',
      {},
      expect.objectContaining({
        workingDirectory: '/project/path'
      })
    );
  });
});
```

**Implementation** (`src/agents/agent.ts`):
```typescript
export interface AgentConfig {
  threadId: string;
  sessionId?: string;
  projectId?: string;
  threadManager: ThreadManager;
}

export class Agent {
  private threadId: string;
  private sessionId?: string;
  private projectId?: string;
  private threadManager: ThreadManager;

  constructor(config: AgentConfig) {
    this.threadId = config.threadId;
    this.sessionId = config.sessionId;
    this.projectId = config.projectId;
    this.threadManager = config.threadManager;
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  getProjectId(): string | undefined {
    return this.projectId;
  }

  getThreadId(): string {
    return this.threadId;
  }

  getWorkingDirectory(): string {
    if (this.sessionId) {
      const session = this.threadManager.getSession(this.sessionId);
      if (session?.configuration?.workingDirectory) {
        return session.configuration.workingDirectory as string;
      }
      
      if (session?.projectId) {
        const project = this.threadManager.getProject(session.projectId);
        if (project) {
          return project.workingDirectory;
        }
      }
    }
    
    if (this.projectId) {
      const project = this.threadManager.getProject(this.projectId);
      if (project) {
        return project.workingDirectory;
      }
    }
    
    return process.cwd();
  }

  private createToolContext(): ToolContext {
    return new ToolContext({
      threadId: this.threadId,
      sessionId: this.sessionId,
      projectId: this.projectId,
      workingDirectory: this.getWorkingDirectory()
    });
  }

  async executeToolCall(toolCall: ToolCall): Promise<void> {
    const context = this.createToolContext();
    
    const result = await this.toolExecutor.execute(
      toolCall.name,
      toolCall.arguments,
      context
    );
    
    // ... rest of implementation
  }
}
```

**Commit**: "feat: add working directory support to Agent"

## Task 1.8: Web API - Project Endpoints

**Goal**: Create REST API endpoints for project management

**Test First** (`packages/web/app/api/projects/route.test.ts`):
```typescript
describe('Project API endpoints', () => {
  describe('GET /api/projects', () => {
    it('should return all projects', async () => {
      const mockThreadManager = {
        getProjects: vi.fn().mockReturnValue([
          {
            id: 'project1',
            name: 'Project 1',
            description: 'First project',
            workingDirectory: '/path/1',
            configuration: {},
            isArchived: false,
            createdAt: new Date('2023-01-01'),
            lastUsedAt: new Date('2023-01-01')
          },
          {
            id: 'project2',
            name: 'Project 2',
            description: 'Second project',
            workingDirectory: '/path/2',
            configuration: {},
            isArchived: false,
            createdAt: new Date('2023-01-02'),
            lastUsedAt: new Date('2023-01-02')
          }
        ])
      };
      
      vi.mocked(ThreadManager).mockImplementation(() => mockThreadManager);
      
      const response = await GET(new NextRequest('http://localhost/api/projects'));
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.projects).toHaveLength(2);
      expect(data.projects[0].id).toBe('project1');
      expect(data.projects[1].id).toBe('project2');
    });
  });

  describe('POST /api/projects', () => {
    it('should create new project', async () => {
      const mockThreadManager = {
        createProject: vi.fn(),
        getProject: vi.fn().mockReturnValue({
          id: 'new-project',
          name: 'New Project',
          description: 'A new project',
          workingDirectory: '/new/path',
          configuration: {},
          isArchived: false,
          createdAt: new Date('2023-01-03'),
          lastUsedAt: new Date('2023-01-03')
        })
      };
      
      vi.mocked(ThreadManager).mockImplementation(() => mockThreadManager);
      
      const request = new NextRequest('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Project',
          description: 'A new project',
          workingDirectory: '/new/path'
        })
      });
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(201);
      expect(data.project.name).toBe('New Project');
      expect(mockThreadManager.createProject).toHaveBeenCalledWith({
        id: expect.any(String),
        name: 'New Project',
        description: 'A new project',
        workingDirectory: '/new/path',
        configuration: {},
        isArchived: false,
        createdAt: expect.any(Date),
        lastUsedAt: expect.any(Date)
      });
    });
  });
});
```

**Implementation** (`packages/web/app/api/projects/route.ts`):
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { ThreadManager, getLaceDbPath } from '@/lib/server/lace-imports';
import { generateId } from '@/lib/utils/id-generator';
import { z } from 'zod';

const CreateProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  description: z.string().optional(),
  workingDirectory: z.string().min(1, 'Working directory is required'),
  configuration: z.record(z.unknown()).optional()
});

export async function GET() {
  try {
    const threadManager = new ThreadManager(getLaceDbPath());
    const projects = threadManager.getProjects();
    
    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = CreateProjectSchema.parse(body);
    
    const threadManager = new ThreadManager(getLaceDbPath());
    
    const project = {
      id: generateId(),
      name: validatedData.name,
      description: validatedData.description || '',
      workingDirectory: validatedData.workingDirectory,
      configuration: validatedData.configuration || {},
      isArchived: false,
      createdAt: new Date(),
      lastUsedAt: new Date()
    };
    
    threadManager.createProject(project);
    
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create project' },
      { status: 500 }
    );
  }
}
```

**Individual project endpoints** (`packages/web/app/api/projects/[projectId]/route.ts`):
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { ThreadManager, getLaceDbPath } from '@/lib/server/lace-imports';
import { z } from 'zod';

const UpdateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  workingDirectory: z.string().min(1).optional(),
  configuration: z.record(z.unknown()).optional(),
  isArchived: z.boolean().optional()
});

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const threadManager = new ThreadManager(getLaceDbPath());
    const project = threadManager.getProject(params.projectId);
    
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch project' },
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
    const validatedData = UpdateProjectSchema.parse(body);
    
    const threadManager = new ThreadManager(getLaceDbPath());
    
    threadManager.updateProject(params.projectId, {
      ...validatedData,
      lastUsedAt: new Date()
    });
    
    const updatedProject = threadManager.getProject(params.projectId);
    
    return NextResponse.json({ project: updatedProject });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update project' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const threadManager = new ThreadManager(getLaceDbPath());
    threadManager.deleteProject(params.projectId);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete project' },
      { status: 500 }
    );
  }
}
```

**Commit**: "feat: add project REST API endpoints"

## Task 1.9: Session API Endpoints

**Goal**: Create REST API endpoints for session management under projects

**Test First** (`packages/web/app/api/projects/[projectId]/sessions/route.test.ts`):
```typescript
describe('Session API endpoints', () => {
  describe('GET /api/projects/:projectId/sessions', () => {
    it('should return sessions for project', async () => {
      const mockThreadManager = {
        getSessionsByProject: vi.fn().mockReturnValue([
          {
            id: 'session1',
            projectId: 'project1',
            name: 'Session 1',
            description: 'First session',
            configuration: {},
            status: 'active',
            createdAt: new Date('2023-01-01'),
            updatedAt: new Date('2023-01-01')
          }
        ])
      };
      
      vi.mocked(ThreadManager).mockImplementation(() => mockThreadManager);
      
      const response = await GET(
        new NextRequest('http://localhost/api/projects/project1/sessions'),
        { params: { projectId: 'project1' } }
      );
      
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.sessions).toHaveLength(1);
      expect(data.sessions[0].id).toBe('session1');
      expect(mockThreadManager.getSessionsByProject).toHaveBeenCalledWith('project1');
    });
  });

  describe('POST /api/projects/:projectId/sessions', () => {
    it('should create session in project', async () => {
      const mockThreadManager = {
        createSession: vi.fn(),
        getSession: vi.fn().mockReturnValue({
          id: 'new-session',
          projectId: 'project1',
          name: 'New Session',
          description: 'A new session',
          configuration: {},
          status: 'active',
          createdAt: new Date('2023-01-01'),
          updatedAt: new Date('2023-01-01')
        })
      };
      
      vi.mocked(ThreadManager).mockImplementation(() => mockThreadManager);
      
      const request = new NextRequest('http://localhost/api/projects/project1/sessions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Session',
          description: 'A new session'
        })
      });
      
      const response = await POST(request, { params: { projectId: 'project1' } });
      const data = await response.json();
      
      expect(response.status).toBe(201);
      expect(data.session.name).toBe('New Session');
      expect(mockThreadManager.createSession).toHaveBeenCalledWith({
        id: expect.any(String),
        projectId: 'project1',
        name: 'New Session',
        description: 'A new session',
        configuration: {},
        status: 'active',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date)
      });
    });
  });
});
```

**Implementation** (`packages/web/app/api/projects/[projectId]/sessions/route.ts`):
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { ThreadManager, getLaceDbPath } from '@/lib/server/lace-imports';
import { generateId } from '@/lib/utils/id-generator';
import { z } from 'zod';

const CreateSessionSchema = z.object({
  name: z.string().min(1, 'Session name is required'),
  description: z.string().optional(),
  configuration: z.record(z.unknown()).optional()
});

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const threadManager = new ThreadManager(getLaceDbPath());
    const sessions = threadManager.getSessionsByProject(params.projectId);
    
    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch sessions' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const body = await request.json();
    const validatedData = CreateSessionSchema.parse(body);
    
    const threadManager = new ThreadManager(getLaceDbPath());
    
    const session = {
      id: generateId(),
      projectId: params.projectId,
      name: validatedData.name,
      description: validatedData.description || '',
      configuration: validatedData.configuration || {},
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    threadManager.createSession(session);
    
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create session' },
      { status: 500 }
    );
  }
}
```

**Individual session endpoints** (`packages/web/app/api/projects/[projectId]/sessions/[sessionId]/route.ts`):
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { ThreadManager, getLaceDbPath } from '@/lib/server/lace-imports';
import { z } from 'zod';

const UpdateSessionSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  configuration: z.record(z.unknown()).optional(),
  status: z.enum(['active', 'archived', 'completed']).optional()
});

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string; sessionId: string } }
) {
  try {
    const threadManager = new ThreadManager(getLaceDbPath());
    const session = threadManager.getSession(params.sessionId);
    
    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }
    
    // Verify session belongs to project
    if (session.projectId !== params.projectId) {
      return NextResponse.json(
        { error: 'Session not found in this project' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch session' },
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
    const validatedData = UpdateSessionSchema.parse(body);
    
    const threadManager = new ThreadManager(getLaceDbPath());
    
    // Verify session exists and belongs to project
    const session = threadManager.getSession(params.sessionId);
    if (!session || session.projectId !== params.projectId) {
      return NextResponse.json(
        { error: 'Session not found in this project' },
        { status: 404 }
      );
    }
    
    threadManager.updateSession(params.sessionId, {
      ...validatedData,
      updatedAt: new Date()
    });
    
    const updatedSession = threadManager.getSession(params.sessionId);
    
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: { projectId: string; sessionId: string } }
) {
  try {
    const threadManager = new ThreadManager(getLaceDbPath());
    
    // Verify session exists and belongs to project
    const session = threadManager.getSession(params.sessionId);
    if (!session || session.projectId !== params.projectId) {
      return NextResponse.json(
        { error: 'Session not found in this project' },
        { status: 404 }
      );
    }
    
    threadManager.deleteSession(params.sessionId);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete session' },
      { status: 500 }
    );
  }
}
```

**Commit**: "feat: add session REST API endpoints under projects"

## Task 1.10: Basic Web UI for Projects

**Goal**: Update web interface to work with project/session hierarchy

**Test First** (`packages/web/components/ProjectSelector.test.tsx`):
```typescript
describe('ProjectSelector', () => {
  it('should render project options', () => {
    const projects = [
      { id: 'p1', name: 'Project 1' },
      { id: 'p2', name: 'Project 2' }
    ];
    
    render(
      <ProjectSelector
        projects={projects}
        selectedProject="p1"
        onSelectProject={vi.fn()}
      />
    );
    
    expect(screen.getByText('Project 1')).toBeInTheDocument();
    expect(screen.getByText('Project 2')).toBeInTheDocument();
  });
  
  it('should call onSelectProject when project is selected', () => {
    const onSelectProject = vi.fn();
    const projects = [
      { id: 'p1', name: 'Project 1' },
      { id: 'p2', name: 'Project 2' }
    ];
    
    render(
      <ProjectSelector
        projects={projects}
        selectedProject="p1"
        onSelectProject={onSelectProject}
      />
    );
    
    fireEvent.click(screen.getByText('Project 2'));
    expect(onSelectProject).toHaveBeenCalledWith('p2');
  });
});
```

**Implementation** (`packages/web/components/ProjectSelector.tsx`):
```typescript
import { useState } from 'react';

interface Project {
  id: string;
  name: string;
  description?: string;
}

interface ProjectSelectorProps {
  projects: Project[];
  selectedProject: string | null;
  onSelectProject: (projectId: string) => void;
}

export function ProjectSelector({ projects, selectedProject, onSelectProject }: ProjectSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  const selected = projects.find(p => p.id === selectedProject);
  
  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-3 text-left bg-gray-50 border border-gray-300 rounded-lg hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <div className="flex items-center justify-between">
          <span className="font-medium">
            {selected ? selected.name : 'Select Project'}
          </span>
          <svg
            className={`w-5 h-5 transform transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      
      {isOpen && (
        <div className="absolute top-full mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg z-10">
          {projects.map(project => (
            <button
              key={project.id}
              onClick={() => {
                onSelectProject(project.id);
                setIsOpen(false);
              }}
              className={`w-full p-3 text-left hover:bg-gray-50 ${
                project.id === selectedProject ? 'bg-blue-50 text-blue-600' : ''
              }`}
            >
              <div className="font-medium">{project.name}</div>
              {project.description && (
                <div className="text-sm text-gray-600">{project.description}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Update main page** (`packages/web/app/page.tsx`):
```typescript
'use client';

import { useState, useEffect } from 'react';
import { ProjectSelector } from '@/components/ProjectSelector';
import { SessionList } from '@/components/SessionList';

interface Project {
  id: string;
  name: string;
  description: string;
  workingDirectory: string;
  isArchived: boolean;
}

interface Session {
  id: string;
  projectId: string;
  name: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load projects on mount
  useEffect(() => {
    const loadProjects = async () => {
      try {
        const response = await fetch('/api/projects');
        const data = await response.json();
        setProjects(data.projects);
        
        // Auto-select first project if available
        if (data.projects.length > 0) {
          setSelectedProject(data.projects[0].id);
        }
      } catch (error) {
        console.error('Failed to load projects:', error);
      } finally {
        setLoading(false);
      }
    };
    
    loadProjects();
  }, []);

  // Load sessions when project changes
  useEffect(() => {
    if (selectedProject) {
      const loadSessions = async () => {
        try {
          const response = await fetch(`/api/projects/${selectedProject}/sessions`);
          const data = await response.json();
          setSessions(data.sessions);
        } catch (error) {
          console.error('Failed to load sessions:', error);
        }
      };
      
      loadSessions();
    } else {
      setSessions([]);
    }
  }, [selectedProject]);

  const createNewSession = async () => {
    if (!selectedProject) return;
    
    try {
      const response = await fetch(`/api/projects/${selectedProject}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Session' })
      });
      
      if (response.ok) {
        const data = await response.json();
        setSessions(prev => [data.session, ...prev]);
        setSelectedSession(data.session.id);
      }
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  };

  if (loading) {
    return <div className="p-8 text-center">Loading...</div>;
  }

  return (
    <div className="h-screen flex bg-gray-100">
      {/* Sidebar */}
      <div className="w-80 bg-white border-r border-gray-300 flex flex-col">
        {/* Project Selector */}
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold mb-3">Projects</h2>
          <ProjectSelector
            projects={projects}
            selectedProject={selectedProject}
            onSelectProject={setSelectedProject}
          />
        </div>
        
        {/* Session List */}
        <div className="flex-1 overflow-y-auto">
          <SessionList
            sessions={sessions}
            selectedSession={selectedSession}
            onSelectSession={setSelectedSession}
            onCreateSession={createNewSession}
            loading={false}
            projectId={selectedProject}
          />
        </div>
      </div>
      
      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {selectedSession ? (
          <div className="flex-1 p-4">
            <h1 className="text-2xl font-bold mb-4">
              Session: {sessions.find(s => s.id === selectedSession)?.name}
            </h1>
            <div className="bg-white rounded-lg shadow p-6">
              <p className="text-gray-600">
                Session interface will be implemented in Phase 2
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <h2 className="text-xl font-semibold text-gray-600 mb-2">
                Select a session to get started
              </h2>
              <p className="text-gray-500">
                Choose a project and session from the sidebar
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Commit**: "feat: add basic project/session web interface"

## Phase 1 Progress Status

### ✅ COMPLETED TASKS:
1. **✅ Task 1.1**: Database Schema for Projects and Sessions - *DONE*
2. **✅ Task 1.2**: Session Persistence Layer - *DONE* 
3. **✅ Task 1.3**: ThreadManager Session Support - *DONE*
4. **✅ Task 1.4**: Working Directory in ToolContext - *DONE*
5. **✅ Task 1.5**: Update Tools to Use Working Directory - *DONE*
6. **✅ Task 1.6**: Session Class Project Support - *DONE*
7. **✅ Task 1.7**: Agent Working Directory Support - *DONE*

### 🔄 REMAINING TASKS:
8. **🔄 Task 1.8**: Web API - Project Endpoints *(Next Priority)*  
9. **🔄 Task 1.9**: Session API Endpoints *(Depends on 1.8)*
10. **🔄 Task 1.10**: Basic Web UI for Projects *(Depends on 1.8, 1.9)*

### 🎯 PARALLELIZATION OPPORTUNITIES:
**Can work in parallel:**
- Task 1.6 (Session Class) + Task 1.8 (Project API) - *Independent implementations*
- Task 1.8 (Project API) can start before Task 1.6 completes

**Sequential dependencies:**
- Task 1.9 (Session API) requires Task 1.8 (Project API) patterns
- Task 1.10 (Web UI) requires both Task 1.8 + 1.9 (API endpoints)

### 🏗️ ARCHITECTURE STATUS:
**Projects → Sessions → Threads** hierarchy is **75% complete**:
- ✅ Database schema with proper foreign keys
- ✅ ThreadManager integration with sessions table  
- ✅ Working directory inheritance through context
- ✅ Tool ecosystem supports project working directories
- 🔄 Session class implementation needed
- 🔄 REST API and web interface needed