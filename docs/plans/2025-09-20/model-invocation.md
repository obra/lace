# Model Invocation Refactoring Plan

## Overview

This plan refactors how Lace resolves model specifications when spawning agents for tasks. Currently, when creating a task with an agent assignment, you must specify the full provider instance ID and model. This change allows more flexible specifications: just a persona (using defaults), a speed preference (fast/smart), or explicit provider/model.

## Background Context

### Key Concepts
- **Provider Instance**: A configured connection to an AI provider (e.g., "anthropic-prod", "openai-dev")
- **Model**: The specific AI model to use (e.g., "claude-3-5-haiku-20241022", "gpt-4")
- **NewAgentSpec**: A string format for specifying that a new agent should be created for a task
- **Persona**: The system prompt/personality for an agent (e.g., "lace", "coding-agent")

### Current Format
```
new:persona:providerInstanceId/modelId
Example: "new:lace:anthropic-prod/claude-3-5-haiku-20241022"
```

### New Formats (what we're building)
```
new:persona                           -> Use session defaults
new:persona;fast                      -> Use system "fast" model
new:persona;smart                     -> Use system "smart" model
new:persona;instanceId:modelId        -> Explicit specification
```

## Implementation Tasks

### Task 1: Create Model Resolution Function

**Goal**: Create a single function that resolves any model specification to concrete provider and model IDs.

**Files to modify**:
- `packages/core/src/providers/provider-utils.ts`

**Implementation**:

```typescript
// Add to provider-utils.ts, after the existing parseProviderModel function

import { UserSettingsManager } from '@lace/core/config/user-settings';

export interface ResolvedModel {
  providerInstanceId: string;
  modelId: string;
}

export interface ModelResolutionContext {
  providerInstanceId?: string;
  modelId?: string;
}

/**
 * Resolves a model specification to concrete provider instance and model IDs.
 *
 * @param spec - The model specification:
 *   - undefined: Use context defaults
 *   - 'fast' | 'smart': Use system-configured fast/smart model
 *   - 'instanceId:modelId': Direct specification
 * @param context - Optional context with default provider/model
 * @returns Resolved provider instance and model IDs
 * @throws Error if unable to resolve
 */
export function resolveModelSpec(
  spec?: string,
  context?: ModelResolutionContext
): ResolvedModel {
  // No spec - use context defaults
  if (!spec) {
    if (!context?.providerInstanceId || !context?.modelId) {
      throw new Error('No model spec provided and context has no defaults');
    }
    return {
      providerInstanceId: context.providerInstanceId,
      modelId: context.modelId
    };
  }

  // Speed tier - lookup from user settings
  if (spec === 'fast' || spec === 'smart') {
    const modelString = UserSettingsManager.getDefaultModel(spec);
    const parsed = parseProviderModel(modelString);
    return {
      providerInstanceId: parsed.instanceId,
      modelId: parsed.modelId
    };
  }

  // Direct specification - must contain colon
  if (spec.includes(':')) {
    const parsed = parseProviderModel(spec);
    return {
      providerInstanceId: parsed.instanceId,
      modelId: parsed.modelId
    };
  }

  throw new Error(
    `Invalid model spec: '${spec}'. Expected 'fast', 'smart', or 'instanceId:modelId'`
  );
}
```

**Test first** (`packages/core/src/providers/provider-utils.test.ts`):

```typescript
// Add these tests to the existing test file

import { vi } from 'vitest';
import { UserSettingsManager } from '@lace/core/config/user-settings';

vi.mock('~/config/user-settings');

describe('resolveModelSpec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use context defaults when no spec provided', () => {
    const context = {
      providerInstanceId: 'anthropic-prod',
      modelId: 'claude-3-5-haiku-20241022'
    };

    const result = resolveModelSpec(undefined, context);

    expect(result).toEqual({
      providerInstanceId: 'anthropic-prod',
      modelId: 'claude-3-5-haiku-20241022'
    });
  });

  it('should throw when no spec and no context', () => {
    expect(() => resolveModelSpec()).toThrow('No model spec provided');
  });

  it('should resolve fast model from user settings', () => {
    vi.mocked(UserSettingsManager.getDefaultModel).mockReturnValue('instance-fast:model-fast');

    const result = resolveModelSpec('fast');

    expect(UserSettingsManager.getDefaultModel).toHaveBeenCalledWith('fast');
    expect(result).toEqual({
      providerInstanceId: 'instance-fast',
      modelId: 'model-fast'
    });
  });

  it('should resolve smart model from user settings', () => {
    vi.mocked(UserSettingsManager.getDefaultModel).mockReturnValue('instance-smart:model-smart');

    const result = resolveModelSpec('smart');

    expect(UserSettingsManager.getDefaultModel).toHaveBeenCalledWith('smart');
    expect(result).toEqual({
      providerInstanceId: 'instance-smart',
      modelId: 'model-smart'
    });
  });

  it('should parse direct instance:model specification', () => {
    const result = resolveModelSpec('my-instance:my-model');

    expect(result).toEqual({
      providerInstanceId: 'my-instance',
      modelId: 'my-model'
    });
  });

  it('should throw for invalid spec format', () => {
    expect(() => resolveModelSpec('invalid')).toThrow('Invalid model spec');
  });
});
```

**How to test**:
```bash
# Run the test in watch mode
npx vitest packages/core/src/providers/provider-utils.test.ts

# Run once to verify
npx vitest run packages/core/src/providers/provider-utils.test.ts
```

**Commit**: `feat: add resolveModelSpec function for flexible model resolution`

---

### Task 2: Update NewAgentSpec Format

**Goal**: Update the NewAgentSpec type to support the new flexible format.

**Files to modify**:
- `packages/core/src/threads/types.ts`

**Implementation**:

Replace the existing NewAgentSpec implementation (lines 531-602) with:

```typescript
// For new agent specifications
// Format: "new:persona" | "new:persona;fast" | "new:persona;smart" | "new:persona;provider:model"
export type NewAgentSpec = string & { readonly __brand: 'NewAgentSpec' };

export function isNewAgentSpec(value: string): value is NewAgentSpec {
  // Must start with "new:" followed by persona, optionally followed by ;modelSpec
  return /^new:[^;]+(;.*)?$/.test(value);
}

export function createNewAgentSpec(
  persona: string,
  modelSpec?: string
): NewAgentSpec {
  if (!modelSpec) {
    return `new:${persona}` as NewAgentSpec;
  }
  return `new:${persona};${modelSpec}` as NewAgentSpec;
}

export interface ParsedNewAgentSpec {
  persona: string;
  modelSpec?: string;  // undefined | 'fast' | 'smart' | 'instanceId:modelId'
}

export function parseNewAgentSpec(spec: NewAgentSpec): ParsedNewAgentSpec {
  const match = spec.match(/^new:([^;]+)(;(.*))?$/);
  if (!match) {
    throw new Error(
      `Invalid NewAgentSpec format: ${spec}. Expected format: new:persona[;modelSpec]`
    );
  }

  const persona = match[1];
  const modelSpec = match[3]; // The part after semicolon, if any

  return {
    persona,
    modelSpec
  };
}
```

**Test updates** (`packages/core/src/threads/new-agent-spec.test.ts`):

```typescript
// Update the existing tests to match the new format

describe('NewAgentSpec', () => {
  describe('isNewAgentSpec', () => {
    it('accepts valid formats', () => {
      // Just persona
      expect(isNewAgentSpec('new:lace')).toBe(true);
      expect(isNewAgentSpec('new:coding-agent')).toBe(true);

      // With speed preference
      expect(isNewAgentSpec('new:lace;fast')).toBe(true);
      expect(isNewAgentSpec('new:lace;smart')).toBe(true);

      // With explicit model
      expect(isNewAgentSpec('new:lace;anthropic:claude-3')).toBe(true);
      expect(isNewAgentSpec('new:helper;openai:gpt-4')).toBe(true);
    });

    it('rejects invalid formats', () => {
      expect(isNewAgentSpec('lace')).toBe(false);
      expect(isNewAgentSpec('new:')).toBe(false);
      expect(isNewAgentSpec('new')).toBe(false);
      expect(isNewAgentSpec('')).toBe(false);
    });
  });

  describe('parseNewAgentSpec', () => {
    it('parses persona-only format', () => {
      const spec = asNewAgentSpec('new:lace');
      const parsed = parseNewAgentSpec(spec);

      expect(parsed.persona).toBe('lace');
      expect(parsed.modelSpec).toBeUndefined();
    });

    it('parses with fast preference', () => {
      const spec = asNewAgentSpec('new:coding-agent;fast');
      const parsed = parseNewAgentSpec(spec);

      expect(parsed.persona).toBe('coding-agent');
      expect(parsed.modelSpec).toBe('fast');
    });

    it('parses with smart preference', () => {
      const spec = asNewAgentSpec('new:helper;smart');
      const parsed = parseNewAgentSpec(spec);

      expect(parsed.persona).toBe('helper');
      expect(parsed.modelSpec).toBe('smart');
    });

    it('parses with explicit model', () => {
      const spec = asNewAgentSpec('new:lace;anthropic-prod:claude-3-haiku');
      const parsed = parseNewAgentSpec(spec);

      expect(parsed.persona).toBe('lace');
      expect(parsed.modelSpec).toBe('anthropic-prod:claude-3-haiku');
    });

    it('handles complex persona names', () => {
      const spec = asNewAgentSpec('new:my-custom-agent_v2');
      const parsed = parseNewAgentSpec(spec);

      expect(parsed.persona).toBe('my-custom-agent_v2');
    });

    it('throws on invalid format', () => {
      const spec = asNewAgentSpec('invalid');
      expect(() => parseNewAgentSpec(spec)).toThrow('Invalid NewAgentSpec format');
    });
  });

  describe('createNewAgentSpec', () => {
    it('creates persona-only spec', () => {
      const spec = createNewAgentSpec('lace');
      expect(spec).toBe('new:lace');
      expect(isNewAgentSpec(spec)).toBe(true);
    });

    it('creates spec with model', () => {
      const spec = createNewAgentSpec('lace', 'fast');
      expect(spec).toBe('new:lace;fast');

      const spec2 = createNewAgentSpec('helper', 'anthropic:claude');
      expect(spec2).toBe('new:helper;anthropic:claude');
    });

    it('round-trips correctly', () => {
      const specs = [
        { persona: 'lace', modelSpec: undefined },
        { persona: 'helper', modelSpec: 'fast' },
        { persona: 'coder', modelSpec: 'smart' },
        { persona: 'analyst', modelSpec: 'prod:gpt-4' }
      ];

      for (const original of specs) {
        const spec = createNewAgentSpec(original.persona, original.modelSpec);
        const parsed = parseNewAgentSpec(spec);

        expect(parsed.persona).toBe(original.persona);
        expect(parsed.modelSpec).toBe(original.modelSpec);
      }
    });
  });
});
```

**How to test**:
```bash
npx vitest run packages/core/src/threads/new-agent-spec.test.ts
```

**Commit**: `feat: update NewAgentSpec to support flexible model specifications`

---

### Task 3: Update TaskManager to Use New Resolution

**Goal**: Update TaskManager to use the new model resolution when spawning agents.

**Files to modify**:
- `packages/core/src/tasks/task-manager.ts`

**Changes needed**:

1. Update imports (add at top):
```typescript
import { resolveModelSpec, type ModelResolutionContext } from '@lace/core/providers/provider-utils';
```

2. Update the `handleAgentSpawning` method (around line 296):
```typescript
private async handleAgentSpawning(task: Task): Promise<void> {
  if (!task.assignedTo || !isNewAgentSpec(task.assignedTo)) {
    return;
  }

  if (!this.createAgent) {
    throw new Error('Agent creation callback not provided - cannot spawn agents');
  }

  // Parse the new agent spec
  const parsed = parseNewAgentSpec(task.assignedTo);

  // Build resolution context from session config if available
  const context: ModelResolutionContext | undefined = this.sessionConfig ? {
    providerInstanceId: this.sessionConfig.providerInstanceId,
    modelId: this.sessionConfig.modelId
  } : undefined;

  // Resolve the model specification
  const { providerInstanceId, modelId } = resolveModelSpec(parsed.modelSpec, context);

  try {
    // Create the agent with resolved values
    const agentThreadId = await this.createAgent(
      parsed.persona,
      providerInstanceId,
      modelId,
      task
    );

    // Update the task assignment to the actual thread ID
    task.assignedTo = agentThreadId;

    // Update status to in_progress since we now have an assigned agent
    task.status = 'in_progress';
    task.updatedAt = new Date();

    // Continue with existing event emission...
  } catch (error) {
    // Keep existing error handling...
  }
}
```

3. Add sessionConfig property to TaskManager:
```typescript
export class TaskManager extends EventEmitter {
  private instanceId: string;
  private persistence: DatabasePersistence;
  private createAgent?: AgentCreationCallback;
  private sessionConfig?: ModelResolutionContext;  // Add this

  // Add method to set session config
  setSessionConfig(config: ModelResolutionContext): void {
    this.sessionConfig = config;
  }
```

**Test updates** (`packages/core/src/tasks/task-manager.test.ts`):

Add tests for the new format support:

```typescript
describe('agent spawning with flexible model specs', () => {
  let mockAgentCallback: vi.Mock;

  beforeEach(() => {
    mockAgentCallback = vi.fn().mockResolvedValue(asThreadId('agent_123'));
    taskManager.setAgentCreationCallback(mockAgentCallback);
  });

  it('should use session defaults when no model spec provided', async () => {
    taskManager.setSessionConfig({
      providerInstanceId: 'session-provider',
      modelId: 'session-model'
    });

    const task = await taskManager.createTask({
      title: 'Test',
      prompt: 'Test',
      assignedTo: createNewAgentSpec('lace')  // No model spec
    }, context);

    expect(mockAgentCallback).toHaveBeenCalledWith(
      'lace',
      'session-provider',
      'session-model',
      expect.any(Object)
    );
  });

  it('should resolve fast model from user settings', async () => {
    vi.mocked(UserSettingsManager.getDefaultModel).mockReturnValue('fast-provider:fast-model');

    const task = await taskManager.createTask({
      title: 'Test',
      prompt: 'Test',
      assignedTo: createNewAgentSpec('lace', 'fast')
    }, context);

    expect(mockAgentCallback).toHaveBeenCalledWith(
      'lace',
      'fast-provider',
      'fast-model',
      expect.any(Object)
    );
  });

  it('should use explicit model spec', async () => {
    const task = await taskManager.createTask({
      title: 'Test',
      prompt: 'Test',
      assignedTo: createNewAgentSpec('lace', 'my-provider:my-model')
    }, context);

    expect(mockAgentCallback).toHaveBeenCalledWith(
      'lace',
      'my-provider',
      'my-model',
      expect.any(Object)
    );
  });
});
```

**How to test**:
```bash
npx vitest run packages/core/src/tasks/task-manager.test.ts
```

**Commit**: `feat: update TaskManager to use flexible model resolution`

---

### Task 4: Update Session to Provide Config to TaskManager

**Goal**: Make Session pass its configuration to TaskManager for default model resolution.

**Files to modify**:
- `packages/core/src/sessions/session.ts`

**Changes needed**:

1. Update TaskManager initialization (around line 230):
```typescript
// After creating the TaskManager
session._taskManager = taskManager;

// Set session configuration for model resolution
const effectiveConfig = session.getEffectiveConfiguration();
if (effectiveConfig.providerInstanceId && effectiveConfig.modelId) {
  taskManager.setSessionConfig({
    providerInstanceId: effectiveConfig.providerInstanceId,
    modelId: effectiveConfig.modelId
  });
}

// Set up agent creation callback...
session.setupAgentCreationCallback();
```

2. Also update in the `getById` method where TaskManager is reconstructed (around line 512):
```typescript
// After setting session._taskManager
const effectiveConfig = session.getEffectiveConfiguration();
if (effectiveConfig.providerInstanceId && effectiveConfig.modelId) {
  session._taskManager.setSessionConfig({
    providerInstanceId: effectiveConfig.providerInstanceId,
    modelId: effectiveConfig.modelId
  });
}
```

**Test**: The existing Session tests should continue to pass. Run:
```bash
npx vitest run packages/core/src/sessions/session.test.ts
```

**Commit**: `feat: connect Session config to TaskManager for model defaults`

---

### Task 5: Update Delegate Tool

**Goal**: Update the delegate tool to use the new simplified format.

**Files to modify**:
- `packages/core/src/tools/implementations/delegate.ts`

**Changes needed**:

1. Update the schema to accept the new format:
```typescript
schema = z.object({
  title: NonEmptyString,
  prompt: NonEmptyString,
  expected_response: NonEmptyString,
  model: z.string().describe('Model spec: "fast", "smart", or "instanceId:modelId"'),
});
```

2. Update `performTaskBasedDelegation` method:
```typescript
private async performTaskBasedDelegation(
  params: {
    title: string;
    prompt: string;
    expected_response: string;
    model: string;
  },
  context?: ToolContext
): Promise<ToolResult> {
  const { title, prompt, expected_response, model } = params;
  const taskManager = await this.getTaskManagerFromContext(context);
  if (!taskManager) {
    throw new Error('TaskManager is required for delegation');
  }

  try {
    // Create assignment spec with the model specification
    // Model can be: 'fast', 'smart', or 'instanceId:modelId'
    const assigneeSpec = createNewAgentSpec('lace', model);

    logger.debug('DelegateTool: Creating task with agent spawning', {
      title,
      assignedTo: assigneeSpec,
      actor: context?.agent?.threadId || 'unknown',
    });

    // Rest of the implementation stays the same...
```

**Test updates** (`packages/core/src/tools/delegate.test.ts`):

Add tests for the new formats:

```typescript
it('should accept fast model specification', async () => {
  const result = await delegateTool.execute({
    name: 'delegate',
    arguments: {
      title: 'Test',
      prompt: 'Test prompt',
      expected_response: 'Test response',
      model: 'fast'  // Just 'fast' instead of 'provider:model'
    }
  }, mockContext);

  expect(result.success).toBe(true);
  // Verify task was created with correct spec
});

it('should accept smart model specification', async () => {
  const result = await delegateTool.execute({
    name: 'delegate',
    arguments: {
      title: 'Test',
      prompt: 'Test prompt',
      expected_response: 'Test response',
      model: 'smart'
    }
  }, mockContext);

  expect(result.success).toBe(true);
});

it('should accept explicit provider:model format', async () => {
  const result = await delegateTool.execute({
    name: 'delegate',
    arguments: {
      title: 'Test',
      prompt: 'Test prompt',
      expected_response: 'Test response',
      model: 'my-provider:my-model'
    }
  }, mockContext);

  expect(result.success).toBe(true);
});
```

**Commit**: `feat: update delegate tool to use flexible model specs`

---

### Task 6: Integration Testing

**Goal**: Create an integration test that verifies the entire flow works end-to-end.

**Create new file**: `packages/core/src/tasks/task-assignment-model-resolution.integration.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskManager } from '@lace/core/tasks/task-manager';
import { Session } from '@lace/core/sessions/session';
import { Project } from '@lace/core/projects/project';
import { UserSettingsManager } from '@lace/core/config/user-settings';
import { createNewAgentSpec } from '@lace/core/threads/types';
import { setupCoreTest } from '@lace/core/test-utils/core-test-setup';

vi.mock('~/config/user-settings');

describe('Task Assignment Model Resolution Integration', () => {
  const _tempLaceDir = setupCoreTest();
  let session: Session;
  let taskManager: TaskManager;

  beforeEach(() => {
    // Setup user settings for fast/smart
    vi.mocked(UserSettingsManager.getDefaultModel).mockImplementation((tier) => {
      if (tier === 'fast') return 'fast-instance:fast-model';
      if (tier === 'smart') return 'smart-instance:smart-model';
      throw new Error('Unknown tier');
    });

    // Create project with default provider config
    const project = Project.create(
      'Test Project',
      '/tmp/test',
      'Test project',
      {
        providerInstanceId: 'default-instance',
        modelId: 'default-model'
      }
    );

    session = Session.create({
      name: 'Test Session',
      projectId: project.getId()
    });

    taskManager = session.getTaskManager()!;
  });

  it('should resolve model specs through the full stack', async () => {
    const agentCallback = vi.fn().mockResolvedValue('agent-thread-123');
    taskManager.setAgentCreationCallback(agentCallback);

    // Test 1: Default (no model spec)
    await taskManager.createTask({
      title: 'Test default',
      prompt: 'Test',
      assignedTo: createNewAgentSpec('lace')
    }, { actor: 'test' });

    expect(agentCallback).toHaveBeenCalledWith(
      'lace',
      'default-instance',
      'default-model',
      expect.any(Object)
    );

    // Test 2: Fast
    await taskManager.createTask({
      title: 'Test fast',
      prompt: 'Test',
      assignedTo: createNewAgentSpec('helper', 'fast')
    }, { actor: 'test' });

    expect(agentCallback).toHaveBeenCalledWith(
      'helper',
      'fast-instance',
      'fast-model',
      expect.any(Object)
    );

    // Test 3: Smart
    await taskManager.createTask({
      title: 'Test smart',
      prompt: 'Test',
      assignedTo: createNewAgentSpec('analyst', 'smart')
    }, { actor: 'test' });

    expect(agentCallback).toHaveBeenCalledWith(
      'analyst',
      'smart-instance',
      'smart-model',
      expect.any(Object)
    );

    // Test 4: Explicit
    await taskManager.createTask({
      title: 'Test explicit',
      prompt: 'Test',
      assignedTo: createNewAgentSpec('coder', 'custom:gpt-4')
    }, { actor: 'test' });

    expect(agentCallback).toHaveBeenCalledWith(
      'coder',
      'custom',
      'gpt-4',
      expect.any(Object)
    );
  });
});
```

**How to test**:
```bash
npx vitest run packages/core/src/tasks/task-assignment-model-resolution.integration.test.ts
```

**Commit**: `test: add integration tests for model resolution flow`

---

## Testing Strategy

### Unit Tests
Each function should have isolated unit tests:
1. `resolveModelSpec` - test all input combinations
2. `parseNewAgentSpec` - test parsing logic
3. TaskManager updates - mock dependencies, test resolution

### Integration Tests
Test the full flow from task creation to agent spawning with different specs.

### Manual Testing
1. Start the web UI: `npm run dev`
2. Create a task and assign to new agent with different specs
3. Verify agent is created with correct model

## Rollback Plan

If issues arise:
1. The changes are backward compatible - old format still works
2. Can revert individual commits
3. Main risk is in TaskManager changes - can revert just that file

## Documentation Updates

After implementation, update:
1. `docs/architecture/CODE-MAP.md` - Note the new model resolution
2. `CLAUDE.md` - Add section on model specification formats
3. API documentation for the delegate tool

## Success Criteria

1. All existing tests pass
2. New tests pass for all three format variations
3. Integration test demonstrates full flow
4. Manual testing shows agents spawn with correct models

## Common Pitfalls to Avoid

1. **Don't forget mocking**: When testing, mock `UserSettingsManager.getDefaultModel`
2. **Check for undefined**: Session config might not have provider/model set
3. **Error messages**: Make errors clear about what formats are accepted
4. **Backward compatibility**: Ensure old `provider/model` format still works

## Commit Message Convention

Use conventional commits:
- `feat:` for new features
- `test:` for test additions
- `refactor:` for code restructuring
- `fix:` for bug fixes
- `docs:` for documentation

Example: `feat: add flexible model resolution for agent spawning`

## Final Checklist

- [ ] All tests pass (`npm test`)
- [ ] No linting errors (`npm run lint`)
- [ ] Each commit builds successfully
- [ ] Integration test covers all paths
- [ ] Error messages are helpful
- [ ] Code follows existing patterns (DRY, YAGNI)
- [ ] No console.log statements left in code