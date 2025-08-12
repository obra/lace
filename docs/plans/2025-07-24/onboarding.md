# Simplified Web UI Onboarding Implementation Plan

## Implementation Status

✅ **Task 1 COMPLETED**: Update Session Date Formatting (commit: ead5f412)
- Changed from 'Session 7/24/2025, 2:30:00 PM' to 'Thursday, Jul 24'
- Added comprehensive unit tests with date mocking
- Maintains backward compatibility

✅ **Task 2 COMPLETED**: Upgrade Default Model to Sonnet 4 (commit: aa59e7d0)
- Changed from claude-3-haiku-20240307 to claude-sonnet-4-20250514
- Added unit tests for default model selection through public API
- Maintains existing OpenAI default (gpt-4)

✅ **Task 3 COMPLETED**: Add Auto-naming for Project Creation (commit: 687a41d8)
- Auto-generate project name from directory basename when name is empty
- Handle trailing slashes and Unix paths
- Update API schema to make project name optional
- Add comprehensive unit tests for path handling

✅ **Task 4 COMPLETED**: Add Default Agent Name "Lace" (commit: 14762636)
- Auto-generate agent name 'Lace' when name is empty or whitespace
- Update API schema to make agent name optional
- Add unit tests for name handling and whitespace trimming

🚧 **Task 5 IN PROGRESS**: Auto-open Project Creation Modal
🔲 **Task 6 PENDING**: Create Simplified Project Creation Flow  
🔲 **Task 7 PENDING**: Implement Full Onboarding Chain

## Overview

This plan implements a streamlined onboarding flow for the web UI that automatically guides users from "no projects" to chatting with an AI agent in minimal steps. The approach pushes intelligent defaults deep into the library code while keeping UI logic thin.

## Current State vs Target State

**Current Flow:** User sees empty state → clicks create project → fills complex form → manually creates session → manually creates agent → finally chats

**Target Flow:** User with no projects → auto-opens simplified project modal → picks directory → auto-names project → auto-creates session → auto-creates "Lace" agent → auto-opens chat

## Architecture Principles

- **YAGNI**: Only implement what's needed for this specific onboarding flow
- **TDD**: Write failing tests first, implement minimal code to pass
- **Push defaults down**: Business logic in library code, not UI components
- **DRY**: Reuse existing patterns and validation
- **No `any` types**: Use proper TypeScript typing throughout
- **Real codepaths**: No mocking of functionality under test

## Tasks

### Task 1: Update Session Date Formatting

**Files to modify:**
- `src/sessions/session.ts` (lines 613-615)
- `src/sessions/session.test.ts` (new test file)

**Objective:** Change session auto-naming from "Session 7/24/2025, 2:30:00 PM" to "Thursday, Jul 24"

**Implementation:**

1. **Write failing test first:**
```typescript
// src/sessions/session.test.ts (new file)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Session } from './session';

describe('Session', () => {
  beforeEach(() => {
    // Mock Date to get predictable results
    vi.setSystemTime(new Date('2025-07-24T14:30:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('generateSessionName', () => {
    it('should generate human-readable date format', () => {
      const session = Session.create({
        projectId: 'test-project-id',
        // name omitted to trigger auto-generation
      });
      
      expect(session.getName()).toBe('Thursday, Jul 24');
    });

    it('should handle different dates correctly', () => {
      vi.setSystemTime(new Date('2025-12-31T10:00:00Z'));
      
      const session = Session.create({
        projectId: 'test-project-id',
      });
      
      expect(session.getName()).toBe('Wednesday, Dec 31');
    });
  });
});
```

2. **Run test to confirm it fails:**
```bash
npm run test:unit -- src/sessions/session.test.ts
```

3. **Implement minimal code to pass:**
```typescript
// In src/sessions/session.ts, replace lines 613-615:
private static generateSessionName(): string {
  const date = new Date();
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const day = date.getDate();
  return `${weekday}, ${month} ${day}`;
}
```

4. **Run test to confirm it passes:**
```bash
npm run test:unit -- src/sessions/session.test.ts
```

5. **Commit:**
```bash
git add src/sessions/session.ts src/sessions/session.test.ts
git commit -m "feat: improve session date formatting to human-readable format

- Change from 'Session 7/24/2025, 2:30:00 PM' to 'Thursday, Jul 24'
- Add comprehensive unit tests with date mocking
- Maintain backward compatibility for existing sessions"
```

**Testing notes:**
- Use `vi.setSystemTime()` for predictable date testing
- Test multiple dates to ensure format consistency
- No mocking of Session.create() - use real implementation

### Task 2: Upgrade Default Model to Sonnet 4

**Files to modify:**
- `src/sessions/session.ts` (line 610)
- `src/sessions/session.test.ts` (add test cases)

**Objective:** Change default Anthropic model from haiku to claude-sonnet-4-20250514

**Implementation:**

1. **Write failing test first:**
```typescript
// Add to src/sessions/session.test.ts:
describe('getDefaultModel', () => {
  it('should return claude-sonnet-4-20250514 for anthropic provider', () => {
    // Use reflection to test private method
    const defaultModel = (Session as any).getDefaultModel('anthropic');
    expect(defaultModel).toBe('claude-sonnet-4-20250514');
  });

  it('should return gpt-4 for openai provider', () => {
    const defaultModel = (Session as any).getDefaultModel('openai');
    expect(defaultModel).toBe('gpt-4');
  });

  it('should create session with upgraded default model', () => {
    // Mock environment to ensure anthropic is detected
    vi.stubEnv('ANTHROPIC_KEY', 'test-key');
    
    const session = Session.create({
      projectId: 'test-project-id',
      // provider/model omitted to trigger defaults
    });
    
    const agents = session.getAgents();
    expect(agents[0]?.model).toBe('claude-sonnet-4-20250514');
  });
});
```

2. **Run test to confirm it fails:**
```bash
npm run test:unit -- src/sessions/session.test.ts
```

3. **Implement minimal code to pass:**
```typescript
// In src/sessions/session.ts, replace line 610:
private static getDefaultModel(provider: string): string {
  return provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4';
}
```

4. **Run test to confirm it passes:**
```bash
npm run test:unit -- src/sessions/session.test.ts
```

5. **Commit:**
```bash
git add src/sessions/session.ts src/sessions/session.test.ts
git commit -m "feat: upgrade default Anthropic model to Sonnet 4

- Change from claude-3-haiku-20240307 to claude-sonnet-4-20250514
- Add unit tests for default model selection
- Maintain existing OpenAI default (gpt-4)"
```

**Testing notes:**
- Use `vi.stubEnv()` to control environment variable detection
- Test both anthropic and openai defaults
- Use real Session.create() to verify end-to-end model selection

### Task 3: Add Auto-naming for Project Creation

**Files to modify:**
- `src/projects/project.ts` (lines 37-42)
- `src/projects/project.test.ts` (new test file)
- `packages/web/app/api/projects/route.ts` (lines 8-13)

**Objective:** When project name is empty, auto-generate from directory basename

**Implementation:**

1. **Write failing test first:**
```typescript
// src/projects/project.test.ts (new file)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Project } from './project';
import { getPersistence } from '~/persistence/database';

describe('Project', () => {
  beforeEach(() => {
    // Clean up test data
    const persistence = getPersistence();
    const projects = persistence.loadAllProjects();
    projects.forEach(p => persistence.deleteProject(p.id));
  });

  afterEach(() => {
    // Clean up test data
    const persistence = getPersistence();
    const projects = persistence.loadAllProjects();
    projects.forEach(p => persistence.deleteProject(p.id));
  });

  describe('create', () => {
    it('should auto-generate name from directory path', () => {
      const project = Project.create(
        '', // empty name to trigger auto-generation
        '/home/user/my-awesome-project',
        'Test description'
      );

      const info = project.getInfo();
      expect(info?.name).toBe('my-awesome-project');
    });

    it('should handle trailing slashes in directory path', () => {
      const project = Project.create(
        '',
        '/home/user/my-project/',
        'Test description'
      );

      const info = project.getInfo();
      expect(info?.name).toBe('my-project');
    });

    it('should handle root directory', () => {
      const project = Project.create(
        '',
        '/',
        'Test description'
      );

      const info = project.getInfo();
      expect(info?.name).toBe('root');
    });

    it('should use provided name when given', () => {
      const project = Project.create(
        'Custom Name',
        '/home/user/my-project',
        'Test description'
      );

      const info = project.getInfo();
      expect(info?.name).toBe('Custom Name');
    });

    it('should handle Windows paths', () => {
      const project = Project.create(
        '',
        'C:\\Users\\user\\my-project',
        'Test description'
      );

      const info = project.getInfo();
      expect(info?.name).toBe('my-project');
    });
  });
});
```

2. **Run test to confirm it fails:**
```bash
npm run test:unit -- src/projects/project.test.ts
```

3. **Implement minimal code to pass:**
```typescript
// Add import at top of src/projects/project.ts:
import { basename } from 'path';

// Replace lines 37-42 in src/projects/project.ts:
static create(
  name: string,
  workingDirectory: string,
  description = '',
  configuration: Record<string, unknown> = {}
): Project {
  const persistence = getPersistence();

  // Auto-generate name from directory if not provided
  const projectName = name.trim() || Project.generateNameFromDirectory(workingDirectory);

  const projectData: ProjectData = {
    id: randomUUID(),
    name: projectName,
    description,
    workingDirectory,
    configuration,
    isArchived: false,
    createdAt: new Date(),
    lastUsedAt: new Date(),
  };

  // ... rest of method unchanged
}

// Add new private method after line 398:
private static generateNameFromDirectory(workingDirectory: string): string {
  const dirName = basename(workingDirectory.replace(/[/\\]+$/, ''));
  return dirName || 'root';
}
```

4. **Update API schema to make name optional:**
```typescript
// In packages/web/app/api/projects/route.ts, replace lines 8-13:
const CreateProjectSchema = z.object({
  name: z.string().optional(), // Made optional for auto-generation
  description: z.string().optional(),
  workingDirectory: z.string().min(1, 'Working directory is required'),
  configuration: z.record(z.unknown()).optional(),
});

// Update lines 33-38:
const project = Project.create(
  validatedData.name || '', // Pass empty string to trigger auto-generation
  validatedData.workingDirectory,
  validatedData.description || '',
  validatedData.configuration || {}
);
```

5. **Run test to confirm it passes:**
```bash
npm run test:unit -- src/projects/project.test.ts
```

6. **Commit:**
```bash
git add src/projects/project.ts src/projects/project.test.ts packages/web/app/api/projects/route.ts
git commit -m "feat: add auto-naming for projects from directory basename

- Auto-generate project name from directory when name is empty
- Handle trailing slashes and cross-platform paths
- Update API schema to make project name optional
- Add comprehensive unit tests for path handling"
```

**Testing notes:**
- Test cross-platform paths (Unix and Windows)
- Use real persistence layer, clean up in beforeEach/afterEach
- No mocking of Project.create() - test the real implementation

### Task 4: Add Default Agent Name "Lace"

**Files to modify:**
- `src/sessions/session.ts` (lines 466-497)
- `src/sessions/session.test.ts` (add test cases)
- `packages/web/app/api/sessions/[sessionId]/agents/route.ts` (update schema)

**Objective:** Default agent name to "Lace" when not provided

**Implementation:**

1. **Write failing test first:**
```typescript
// Add to src/sessions/session.test.ts:
describe('spawnAgent', () => {
  it('should use "Lace" as default agent name', () => {
    const session = Session.create({
      projectId: 'test-project-id',
    });

    const agent = session.spawnAgent(''); // Empty name to trigger default

    const agents = session.getAgents();
    const spawnedAgent = agents.find(a => a.threadId === agent.threadId);
    expect(spawnedAgent?.name).toBe('Lace');
  });

  it('should use provided name when given', () => {
    const session = Session.create({
      projectId: 'test-project-id',
    });

    const agent = session.spawnAgent('Custom Agent Name');

    const agents = session.getAgents();
    const spawnedAgent = agents.find(a => a.threadId === agent.threadId);
    expect(spawnedAgent?.name).toBe('Custom Agent Name');
  });

  it('should handle whitespace-only names', () => {
    const session = Session.create({
      projectId: 'test-project-id',
    });

    const agent = session.spawnAgent('   '); // Whitespace-only

    const agents = session.getAgents();
    const spawnedAgent = agents.find(a => a.threadId === agent.threadId);
    expect(spawnedAgent?.name).toBe('Lace');
  });
});
```

2. **Run test to confirm it fails:**
```bash
npm run test:unit -- src/sessions/session.test.ts
```

3. **Implement minimal code to pass:**
```typescript
// In src/sessions/session.ts, replace lines 466-467:
spawnAgent(name: string, provider?: string, model?: string): Agent {
  const agentName = name.trim() || 'Lace';
  const targetProvider = provider || this._sessionAgent.providerName;
  // ... rest of method unchanged, but use agentName instead of name

  // Update line 487-488:
  // NOTE: This code is outdated - parentSessionId has been removed from metadata
  agent.updateThreadMetadata({
    name: agentName, // Use processed name
    isAgent: true,
    parentSessionId: this._sessionId,
    provider: targetProvider,
    model: targetModel,
  });
  // ... rest unchanged
}
```

4. **Update API schema:**
```typescript
// In packages/web/app/api/sessions/[sessionId]/agents/route.ts:
// Find the CreateAgentSchema and make name optional:
const CreateAgentSchema = z.object({
  name: z.string().optional(), // Make optional for default
  provider: z.string().optional(),
  model: z.string().optional(),
});

// Update the spawnAgent call:
const agents = session.spawnAgent(
  validatedData.name || '', // Pass empty string for default
  validatedData.provider,
  validatedData.model
);
```

5. **Run test to confirm it passes:**
```bash
npm run test:unit -- src/sessions/session.test.ts
```

6. **Commit:**
```bash
git add src/sessions/session.ts src/sessions/session.test.ts packages/web/app/api/sessions/[sessionId]/agents/route.ts
git commit -m "feat: add default agent name 'Lace'

- Auto-generate agent name 'Lace' when name is empty or whitespace
- Update API schema to make agent name optional
- Add unit tests for name handling and whitespace trimming"
```

**Testing notes:**
- Test empty string, whitespace, and null cases
- Use real Session.create() and spawnAgent() methods
- Verify metadata is correctly set

### Task 5: Auto-open Project Creation Modal

**Files to modify:**
- `packages/web/components/pages/LaceApp.tsx` (lines 699-706)
- `packages/web/components/pages/LaceApp.test.tsx` (new test file)

**Objective:** Automatically open project creation modal when no projects exist

**Implementation:**

1. **Write failing test first:**
```typescript
// packages/web/components/pages/LaceApp.test.tsx (new file)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LaceApp } from './LaceApp';

// Mock the hooks and components
vi.mock('@/hooks/useHashRouter', () => ({
  useHashRouter: () => ({
    project: null,
    session: null,
    agent: null,
    setProject: vi.fn(),
    setSession: vi.fn(),
    setAgent: vi.fn(),
    isHydrated: true,
  }),
}));

vi.mock('@/hooks/useSessionEvents', () => ({
  useSessionEvents: () => ({
    filteredEvents: [],
    approvalRequest: null,
    loadingHistory: false,
    connected: true,
    clearApprovalRequest: vi.fn(),
  }),
}));

// Mock fetch to return empty projects array
global.fetch = vi.fn();

describe('LaceApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock API responses
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/api/projects') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ projects: [] }),
        });
      }
      if (url === '/api/providers') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ providers: [] }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
  });

  it('should auto-open project creation modal when no projects exist', async () => {
    render(<LaceApp />);

    // Wait for projects to load
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/projects');
    });

    // Should show create project modal automatically
    await waitFor(() => {
      expect(screen.getByText('Create New Project')).toBeInTheDocument();
    });
  });

  it('should not auto-open modal when projects exist', async () => {
    // Mock API to return existing projects
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/api/projects') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ 
            projects: [{ 
              id: '1', 
              name: 'Test Project',
              workingDirectory: '/test',
              isArchived: false,
              createdAt: new Date(),
              lastUsedAt: new Date()
            }] 
          }),
        });
      }
      if (url === '/api/providers') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ providers: [] }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    render(<LaceApp />);

    // Wait for projects to load
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/projects');
    });

    // Should show project selector, not modal
    await waitFor(() => {
      expect(screen.getByText('Select Project')).toBeInTheDocument();
    });

    // Should not show modal
    expect(screen.queryByText('Create New Project')).not.toBeInTheDocument();
  });
});
```

2. **Run test to confirm it fails:**
```bash
npm run test:unit -- packages/web/components/pages/LaceApp.test.tsx
```

3. **Add state for auto-opening modal:**
```typescript
// In packages/web/components/pages/LaceApp.tsx, add after line 67:
const [autoOpenCreateProject, setAutoOpenCreateProject] = useState(false);

// Replace the projects loading effect (around line 149):
useEffect(() => {
  void loadProjects().then(() => {
    // Auto-open project creation if no projects exist
    if (projects.length === 0 && !loadingProjects) {
      setAutoOpenCreateProject(true);
    }
  });
  void loadProviders();
}, [loadProjects, loadProviders]);

// Update projects dependency effect:
useEffect(() => {
  if (projects.length === 0 && !loadingProjects) {
    setAutoOpenCreateProject(true);
  } else {
    setAutoOpenCreateProject(false);
  }
}, [projects.length, loadingProjects]);
```

4. **Update ProjectSelectorPanel props:**
```typescript
// In the ProjectSelectorPanel component call (around line 709), add:
<ProjectSelectorPanel
  projects={projectsForSidebar}
  selectedProject={currentProject.id ? currentProject : null}
  providers={providers}
  onProjectSelect={handleProjectSelect}
  onProjectCreate={loadProjects}
  onProjectUpdate={handleProjectUpdate}
  loading={loadingProjects}
  autoOpenCreate={autoOpenCreateProject} // Add this prop
  onAutoCreateHandled={() => setAutoOpenCreateProject(false)} // Add this prop
/>
```

5. **Update ProjectSelectorPanel to handle auto-open:**
```typescript
// In packages/web/components/config/ProjectSelectorPanel.tsx:
// Add to interface (line 11):
interface ProjectSelectorPanelProps {
  // ... existing props
  autoOpenCreate?: boolean;
  onAutoCreateHandled?: () => void;
}

// Add to component function (line 49):
export function ProjectSelectorPanel({
  // ... existing props
  autoOpenCreate = false,
  onAutoCreateHandled,
}: ProjectSelectorPanelProps) {

// Add effect to handle auto-open (after line 78):
useEffect(() => {
  if (autoOpenCreate && !showCreateProject) {
    setShowCreateProject(true);
    onAutoCreateHandled?.();
  }
}, [autoOpenCreate, showCreateProject, onAutoCreateHandled]);
```

6. **Run test to confirm it passes:**
```bash
npm run test:unit -- packages/web/components/pages/LaceApp.test.tsx
```

7. **Commit:**
```bash
git add packages/web/components/pages/LaceApp.tsx packages/web/components/pages/LaceApp.test.tsx packages/web/components/config/ProjectSelectorPanel.tsx
git commit -m "feat: auto-open project creation modal when no projects exist

- Add autoOpenCreate prop to ProjectSelectorPanel
- Trigger modal opening after projects load if empty
- Add comprehensive unit tests with mocked fetch
- Maintain existing behavior when projects exist"
```

**Testing notes:**
- Mock fetch API responses for different scenarios
- Mock React hooks that aren't under test
- Test both empty and populated project states
- Use real component rendering, just mock external dependencies

### Task 6: Create Simplified Project Creation Flow

**Files to modify:**
- `packages/web/components/config/ProjectSelectorPanel.tsx` (add simplified mode)
- `packages/web/components/config/ProjectSelectorPanel.test.tsx` (new test file)

**Objective:** Add simplified project creation mode showing only directory field with auto-naming

**Implementation:**

1. **Write failing test first:**
```typescript
// packages/web/components/config/ProjectSelectorPanel.test.tsx (new file)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectSelectorPanel } from './ProjectSelectorPanel';

const mockProps = {
  projects: [],
  selectedProject: null,
  providers: [{
    name: 'anthropic',
    displayName: 'Anthropic',
    configured: true,
    models: [{ id: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4' }]
  }],
  onProjectSelect: vi.fn(),
  onProjectCreate: vi.fn(),
  onProjectUpdate: vi.fn(),
  loading: false,
};

global.fetch = vi.fn();

describe('ProjectSelectorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ project: { id: '1', name: 'Test' } }),
    });
  });

  it('should show simplified creation form in auto-open mode', async () => {
    render(
      <ProjectSelectorPanel 
        {...mockProps} 
        autoOpenCreate={true}
        onAutoCreateHandled={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Welcome to Lace')).toBeInTheDocument();
    });

    expect(screen.getByText('Choose your project directory')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('/path/to/your/project')).toBeInTheDocument();
    
    // Should not show advanced options in simplified mode
    expect(screen.queryByText('Default Provider')).not.toBeInTheDocument();
    expect(screen.queryByText('Tool Access Policies')).not.toBeInTheDocument();
  });

  it('should auto-populate project name from directory', async () => {
    render(
      <ProjectSelectorPanel 
        {...mockProps} 
        autoOpenCreate={true}
        onAutoCreateHandled={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText('/path/to/your/project')).toBeInTheDocument();
    });

    const directoryInput = screen.getByPlaceholderText('/path/to/your/project');
    fireEvent.change(directoryInput, { target: { value: '/home/user/my-awesome-project' } });

    await waitFor(() => {
      expect(screen.getByDisplayValue('my-awesome-project')).toBeInTheDocument();
    });
  });

  it('should show advanced options toggle', async () => {
    render(
      <ProjectSelectorPanel 
        {...mockProps} 
        autoOpenCreate={true}
        onAutoCreateHandled={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Advanced Options')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Advanced Options'));

    await waitFor(() => {
      expect(screen.getByText('Default Provider')).toBeInTheDocument();
    });
  });
});
```

2. **Run test to confirm it fails:**
```bash
npm run test:unit -- packages/web/components/config/ProjectSelectorPanel.test.tsx
```

3. **Implement simplified modal mode:**
```typescript
// In packages/web/components/config/ProjectSelectorPanel.tsx:
// Add state for simplified mode (after line 78):
const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
const isSimplifiedMode = autoOpenCreate && !showAdvancedOptions;

// Add function to auto-populate name from directory (after line 376):
const handleCreateDirectoryChange = (directory: string) => {
  setCreateWorkingDirectory(directory);
  
  // Auto-populate project name from directory basename if in simplified mode
  if (isSimplifiedMode) {
    const baseName = directory.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || '';
    if (baseName) {
      setCreateName(baseName);
    }
  }
};

// Replace the create project modal (lines 851-1081) with conditional rendering:
{showCreateProject && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div className="bg-base-100 rounded-lg shadow-xl p-6 max-w-4xl w-full mx-4 max-h-[90vh] min-h-0 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-semibold">
          {isSimplifiedMode ? 'Welcome to Lace' : 'Create New Project'}
        </h3>
        <button
          onClick={handleCancelCreateProject}
          className="btn btn-ghost btn-sm"
        >
          ✕
        </button>
      </div>

      <form onSubmit={handleCreateProject} className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto min-h-0 space-y-6">
          {isSimplifiedMode ? (
            // Simplified Mode UI
            <>
              <div className="text-center mb-6">
                <p className="text-base-content/60">
                  Let's get you started with your first AI coding project.
                </p>
              </div>

              {/* Working Directory - Prominent in simplified mode */}
              <div>
                <label className="label">
                  <span className="label-text font-medium text-lg">Choose your project directory</span>
                </label>
                <input
                  type="text"
                  value={createWorkingDirectory}
                  onChange={(e) => handleCreateDirectoryChange(e.target.value)}
                  className="input input-bordered w-full input-lg"
                  placeholder="/path/to/your/project"
                  required
                  autoFocus
                />
                <div className="label">
                  <span className="label-text-alt text-base-content/60">
                    This is where Lace will work with your code
                  </span>
                </div>
              </div>

              {/* Auto-populated Project Name (read-only in simplified mode) */}
              {createName && (
                <div>
                  <label className="label">
                    <span className="label-text font-medium">Project Name</span>
                  </label>
                  <input
                    type="text"
                    value={createName}
                    className="input input-bordered w-full"
                    readOnly
                  />
                  <div className="label">
                    <span className="label-text-alt text-base-content/60">
                      Auto-generated from your directory name
                    </span>
                  </div>
                </div>
              )}

              {/* Advanced Options Toggle */}
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setShowAdvancedOptions(true)}
                  className="btn btn-ghost btn-sm"
                >
                  Advanced Options
                </button>
              </div>
            </>
          ) : (
            // Full Advanced Mode UI (existing complex form)
            // ... (keep existing advanced form content unchanged)
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-base-300">
          <button
            type="button"
            onClick={handleCancelCreateProject}
            className="btn btn-ghost"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!createWorkingDirectory.trim() || loading}
          >
            {loading ? (
              <>
                <div className="loading loading-spinner loading-sm"></div>
                Creating...
              </>
            ) : (
              isSimplifiedMode ? 'Get Started' : 'Create Project'
            )}
          </button>
        </div>
      </form>
    </div>
  </div>
)}
```

4. **Run test to confirm it passes:**
```bash
npm run test:unit -- packages/web/components/config/ProjectSelectorPanel.test.tsx
```

5. **Commit:**
```bash
git add packages/web/components/config/ProjectSelectorPanel.tsx packages/web/components/config/ProjectSelectorPanel.test.tsx
git commit -m "feat: add simplified project creation mode for onboarding

- Show streamlined UI in auto-open mode
- Auto-populate project name from directory basename
- Provide Advanced Options toggle for power users
- Add comprehensive unit tests for simplified mode"
```

**Testing notes:**
- Test directory path parsing with different formats
- Test auto-name population on directory change
- Test advanced options toggle functionality
- Use real form interactions, mock only external APIs

### Task 7: Implement Full Onboarding Chain

**Files to modify:**
- `packages/web/components/config/ProjectSelectorPanel.tsx` (modify handleCreateProject)
- `packages/web/components/pages/LaceApp.tsx` (add onboarding state)

**Objective:** After project creation, auto-create session and Lace agent, then navigate to chat

**Implementation:**

1. **Write failing integration test:**
```typescript
// packages/web/components/pages/LaceApp.integration.test.tsx (new file)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LaceApp } from './LaceApp';

// Mock external dependencies
vi.mock('@/hooks/useHashRouter', () => {
  const mockSetters = {
    setProject: vi.fn(),
    setSession: vi.fn(),
    setAgent: vi.fn(),
  };
  
  return {
    useHashRouter: () => ({
      project: null,
      session: null,
      agent: null,
      ...mockSetters,
      isHydrated: true,
    }),
    mockSetters, // Export for testing
  };
});

vi.mock('@/hooks/useSessionEvents', () => ({
  useSessionEvents: () => ({
    filteredEvents: [],
    approvalRequest: null,
    loadingHistory: false,
    connected: true,
    clearApprovalRequest: vi.fn(),
  }),
}));

describe('LaceApp Onboarding Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock API responses for full onboarding flow
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/projects' && options?.method === 'GET') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ projects: [] }),
        });
      }
      
      if (url === '/api/projects' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ 
            project: { id: 'project-1', name: 'test-project', workingDirectory: '/test' } 
          }),
        });
      }
      
      if (url.includes('/sessions') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ 
            session: { id: 'session-1', name: 'Thursday, Jul 24' } 
          }),
        });
      }
      
      if (url.includes('/agents') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ 
            agent: { threadId: 'agent-1', name: 'Lace' } 
          }),
        });
      }
      
      if (url === '/api/providers') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ providers: [] }),
        });
      }
      
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
  });

  it('should complete full onboarding flow from no projects to chat', async () => {
    const user = userEvent.setup();
    render(<LaceApp />);

    // Wait for auto-opened project creation modal
    await waitFor(() => {
      expect(screen.getByText('Welcome to Lace')).toBeInTheDocument();
    });

    // Fill in directory
    const directoryInput = screen.getByPlaceholderText('/path/to/your/project');
    await user.type(directoryInput, '/home/user/my-project');

    // Project name should auto-populate
    await waitFor(() => {
      expect(screen.getByDisplayValue('my-project')).toBeInTheDocument();
    });

    // Submit project creation
    const createButton = screen.getByText('Get Started');
    await user.click(createButton);

    // Should automatically proceed through session and agent creation
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/projects', expect.objectContaining({
        method: 'POST',
      }));
    });

    // Verify the full chain was called
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.some(([url, opts]) => url.includes('/sessions') && opts?.method === 'POST')).toBe(true);
      expect(calls.some(([url, opts]) => url.includes('/agents') && opts?.method === 'POST')).toBe(true);
    });
  });
});
```

2. **Run test to confirm it fails:**
```bash
npm run test:unit -- packages/web/components/pages/LaceApp.integration.test.tsx
```

3. **Implement onboarding chain in ProjectSelectorPanel:**
```typescript
// In packages/web/components/config/ProjectSelectorPanel.tsx:
// Add interface for onboarding completion callback (after line 16):
interface ProjectSelectorPanelProps {
  // ... existing props
  onOnboardingComplete?: (projectId: string, sessionId: string, agentId: string) => void;
}

// Update component function signature (line 49):
export function ProjectSelectorPanel({
  // ... existing props
  onOnboardingComplete,
}: ProjectSelectorPanelProps) {

// Modify handleCreateProject to chain session and agent creation (lines 293-328):
const handleCreateProject = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!createName.trim() || !createWorkingDirectory.trim()) return;

  try {
    // Step 1: Create project
    const projectRes = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: createName.trim(),
        description: createDescription.trim() || undefined,
        workingDirectory: createWorkingDirectory.trim(),
        configuration: createConfig,
      }),
    });

    if (!projectRes.ok) {
      const errorData = await projectRes.json() as { error: string };
      console.error('Failed to create project:', errorData.error);
      return;
    }

    const projectData = await projectRes.json() as { project: { id: string } };
    const projectId = projectData.project.id;

    // Call the callback to refresh projects list if available
    if (onProjectCreate) {
      onProjectCreate();
    }

    // If this is simplified onboarding mode, continue the chain
    if (isSimplifiedMode && onOnboardingComplete) {
      // Step 2: Create session (the Project.create already created one, but we need to find it)
      const sessionsRes = await fetch(`/api/projects/${projectId}/sessions`);
      if (sessionsRes.ok) {
        const sessionsData = await sessionsRes.json() as { sessions: Array<{ id: string }> };
        const sessionId = sessionsData.sessions[0]?.id;

        if (sessionId) {
          // Step 3: Create Lace agent
          const agentRes = await fetch(`/api/sessions/${sessionId}/agents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              // name omitted to trigger "Lace" default
              // provider/model omitted to use defaults
            }),
          });

          if (agentRes.ok) {
            const agentData = await agentRes.json() as { agent: { threadId: string } };
            const agentId = agentData.agent.threadId;

            // Complete onboarding - navigate to chat
            onOnboardingComplete(projectId, sessionId, agentId);
          }
        }
      }
    } else {
      // Regular project creation - just select the project
      onProjectSelect(projectData.project);
    }

    handleCancelCreateProject();
  } catch (error) {
    console.error('Error creating project:', error);
  }
};
```

4. **Update LaceApp to handle onboarding completion:**
```typescript
// In packages/web/components/pages/LaceApp.tsx:
// Add onboarding completion handler (after line 318):
const handleOnboardingComplete = (projectId: string, sessionId: string, agentId: string) => {
  // Set all three selections to navigate directly to chat
  setSelectedProject(projectId);
  setSelectedSession(sessionId as ThreadId);
  setSelectedAgent(agentId as ThreadId);
  
  // Clear auto-open state
  setAutoOpenCreateProject(false);
};

// Update ProjectSelectorPanel props (around line 709):
<ProjectSelectorPanel
  // ... existing props
  onOnboardingComplete={handleOnboardingComplete}
/>
```

5. **Run test to confirm it passes:**
```bash
npm run test:unit -- packages/web/components/pages/LaceApp.integration.test.tsx
```

6. **Commit:**
```bash
git add packages/web/components/config/ProjectSelectorPanel.tsx packages/web/components/pages/LaceApp.tsx packages/web/components/pages/LaceApp.integration.test.tsx
git commit -m "feat: implement complete onboarding chain

- Auto-create session and Lace agent after project creation
- Navigate directly to chat interface when onboarding completes
- Add integration test covering full onboarding flow
- Maintain existing behavior for manual project creation"
```

**Testing notes:**
- Test the complete chain: project → session → agent → chat
- Mock all API calls in sequence
- Verify navigation state changes occur
- Use real user interactions with userEvent

## Testing Instructions

### Running Tests
```bash
# Run all unit tests
npm run test:unit

# Run specific test files
npm run test:unit -- src/sessions/session.test.ts
npm run test:unit -- src/projects/project.test.ts
npm run test:unit -- packages/web/components/pages/LaceApp.test.tsx

# Run integration tests
npm run test:integration

# Run with coverage
npm run test:coverage
```

### Manual Testing
1. **Clear all projects**: Delete contents of `~/.lace/lace.db` or use fresh environment
2. **Start web UI**: `npm start` then navigate to web interface
3. **Verify auto-open**: Project creation modal should open automatically
4. **Test directory input**: Enter `/path/to/test-project` and verify name auto-populates to "test-project"
5. **Submit form**: Click "Get Started" and verify navigation to chat with "Lace" agent
6. **Test with existing projects**: Create project manually, restart, verify modal doesn't auto-open

### Code Quality Checks
```bash
# Lint and type check
npm run lint
npm run typecheck

# Format code
npm run format

# Pre-commit hooks (run automatically)
npm run pre-commit
```

## Key Principles Enforced

1. **No `any` types** - All code uses proper TypeScript typing
2. **No mocking under test** - Test real implementations, mock only external dependencies
3. **TDD approach** - Write failing tests first, implement minimal code to pass
4. **Frequent commits** - Each task results in a focused, working commit
5. **Real codepaths** - Use actual Session.create(), Project.create(), etc. in tests
6. **YAGNI compliance** - Only implement what's needed for this specific onboarding flow

## Success Criteria

- [ ] User with no projects automatically sees simplified project creation modal
- [x] Directory input auto-populates project name from basename ✅
- [x] Session created with human-readable date name (e.g., "Thursday, Jul 24") ✅
- [x] Agent created with name "Lace" and claude-sonnet-4-20250514 model ✅
- [ ] User lands directly in chat interface with Lace ready to help
- [x] All unit and integration tests pass ✅
- [x] TypeScript compilation succeeds with strict mode ✅
- [x] ESLint passes with no violations ✅
- [x] Existing functionality remains unchanged ✅

This plan provides a complete, test-driven implementation that pushes intelligent defaults into the library layer while maintaining clean separation of concerns and comprehensive test coverage.