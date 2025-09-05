# Agent Personas Implementation Plan

## Overview

This plan implements a configurable agent persona system for Lace. Currently, all agents use a single hardcoded system prompt. This feature allows different agents to have distinct personalities/capabilities by using different system prompts (personas).

## Key Concepts

- **Persona**: A system prompt template that defines an agent's behavior/capabilities
- **Template System**: Personas use `{{include:sections/...}}` to reuse shared prompt sections
- **Override System**: User-defined personas (in `~/.lace/`) override built-in ones by name
- **NewAgentSpec**: Format for specifying new agents: `new:persona:provider/model`

## Architecture Changes

### File Structure
```
# Before
packages/core/src/config/prompts/
├── system.md                    # Single system prompt
└── sections/                    # Shared sections
    ├── agent-personality.md
    └── ...

# After  
packages/core/config/agent-personas/
├── lace.md                      # Default persona (renamed from system.md)
├── coding-agent.md              # Example specialized persona
├── helper-agent.md              # Example specialized persona
└── sections/                    # Shared sections (unchanged)
    ├── agent-personality.md
    └── ...

# User overrides
~/.lace/agent-personas/
├── my-custom-persona.md         # User-defined persona
├── lace.md                      # User override of default
└── sections/                    # User section overrides
    └── agent-personality.md     # User override
```

### Data Flow Changes
```
# Before
Agent creation → loadPromptConfig() → system.md → Agent

# After  
Agent creation → PersonaRegistry.validate(persona) → 
PromptManager.generateSystemPrompt(persona) → persona.md → Agent
```

## Implementation Tasks

### Task 1: File System Reorganization

**Objective**: Move prompts out of `src/` and rename `system.md` to `lace.md`

**Files to modify:**
- `packages/core/src/config/prompts/` → `packages/core/config/agent-personas/`
- `packages/core/src/config/prompts/system.md` → `packages/core/config/agent-personas/lace.md`

**Steps:**
1. Create new directory structure:
   ```bash
   mkdir -p packages/core/config/agent-personas/sections
   ```

2. Move all files:
   ```bash
   # Move sections (unchanged)
   mv packages/core/src/config/prompts/sections/* packages/core/config/agent-personas/sections/
   
   # Rename and move system.md to lace.md
   mv packages/core/src/config/prompts/system.md packages/core/config/agent-personas/lace.md
   
   # Remove old directory
   rm -rf packages/core/src/config/prompts/
   ```

3. Update all hardcoded paths in code:
   ```bash
   # Find files referencing old path
   grep -r "src/config/prompts" packages/core/src/
   ```

**Files likely needing updates:**
- `packages/core/src/config/prompt-manager.ts` - Update `PROMPTS_DIR` constant
- `packages/core/src/config/prompts.ts` - Update any hardcoded paths
- Any test files importing prompt fixtures

**Testing:**
```bash
# Verify no broken imports
npm run build

# Run existing prompt tests
npm test -- --grep "prompt"
```

**Commit Message:** "refactor: move prompts to config/agent-personas and rename system.md to lace.md"

### Task 2: Create PersonaRegistry Service

**Objective**: Create service to discover and validate available personas

**Create new file:** `packages/core/src/config/persona-registry.ts`

**Implementation:**
```typescript
// ABOUTME: Service for discovering and validating agent personas
// ABOUTME: Handles both built-in (bundled) and user-defined persona files

import * as fs from 'fs';
import * as path from 'path';
import { getLaceDir } from '~/config/lace-dir';

export interface PersonaInfo {
  name: string;
  isUserDefined: boolean;
  path: string;
}

export class PersonaRegistry {
  private bundledPersonasCache: Set<string> = new Set();
  private userPersonasCache: Map<string, string> = new Map(); // name -> path
  private userCacheExpiry = 0;
  private readonly USER_CACHE_TTL = 5000; // 5 seconds

  constructor(private readonly bundledPersonasPath: string) {
    this.loadBundledPersonas();
  }

  private loadBundledPersonas(): void {
    try {
      const files = fs.readdirSync(this.bundledPersonasPath);
      for (const file of files) {
        if (file.endsWith('.md')) {
          this.bundledPersonasCache.add(file.slice(0, -3)); // Remove .md extension
        }
      }
    } catch (error) {
      // Bundled personas should always exist, but handle gracefully
      console.warn('Failed to load bundled personas:', error);
    }
  }

  private loadUserPersonas(): void {
    const now = Date.now();
    if (now < this.userCacheExpiry) {
      return; // Cache still valid
    }

    this.userPersonasCache.clear();
    
    try {
      const userPersonasPath = path.join(getLaceDir(), 'agent-personas');
      if (!fs.existsSync(userPersonasPath)) {
        this.userCacheExpiry = now + this.USER_CACHE_TTL;
        return;
      }

      const files = fs.readdirSync(userPersonasPath);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const name = file.slice(0, -3); // Remove .md extension
          this.userPersonasCache.set(name, path.join(userPersonasPath, file));
        }
      }
      
      this.userCacheExpiry = now + this.USER_CACHE_TTL;
    } catch (error) {
      // User directory may not exist, that's ok
      this.userCacheExpiry = now + this.USER_CACHE_TTL;
    }
  }

  /**
   * Get all available personas (user personas override built-in ones)
   */
  listAvailablePersonas(): PersonaInfo[] {
    this.loadUserPersonas();
    
    const personas: PersonaInfo[] = [];
    const seen = new Set<string>();

    // User personas first (they override built-ins)
    for (const [name, filePath] of this.userPersonasCache) {
      personas.push({ name, isUserDefined: true, path: filePath });
      seen.add(name);
    }

    // Built-in personas (only if not overridden)
    for (const name of this.bundledPersonasCache) {
      if (!seen.has(name)) {
        const filePath = path.join(this.bundledPersonasPath, `${name}.md`);
        personas.push({ name, isUserDefined: false, path: filePath });
      }
    }

    return personas.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Check if a persona exists
   */
  hasPersona(name: string): boolean {
    this.loadUserPersonas();
    return this.userPersonasCache.has(name) || this.bundledPersonasCache.has(name);
  }

  /**
   * Get path to a persona file (user overrides built-in)
   */
  getPersonaPath(name: string): string | null {
    this.loadUserPersonas();
    
    // Check user personas first
    if (this.userPersonasCache.has(name)) {
      return this.userPersonasCache.get(name)!;
    }

    // Check built-in personas
    if (this.bundledPersonasCache.has(name)) {
      return path.join(this.bundledPersonasPath, `${name}.md`);
    }

    return null;
  }

  /**
   * Validate persona exists, throw helpful error if not
   */
  validatePersona(name: string): void {
    if (!this.hasPersona(name)) {
      const available = this.listAvailablePersonas().map(p => p.name);
      throw new Error(
        `Persona '${name}' not found. Available personas: ${available.join(', ')}`
      );
    }
  }
}

// Singleton instance
export const personaRegistry = new PersonaRegistry(
  path.resolve(__dirname, '../../config/agent-personas')
);
```

**Create test file:** `packages/core/src/config/persona-registry.test.ts`

**Test implementation:**
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PersonaRegistry } from './persona-registry';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync, rmSync } from 'fs';

describe('PersonaRegistry', () => {
  let tempBundledDir: string;
  let tempUserDir: string;
  let registry: PersonaRegistry;

  beforeEach(() => {
    // Create temp directories for testing
    tempBundledDir = fs.mkdtempSync(path.join(tmpdir(), 'bundled-personas-'));
    tempUserDir = fs.mkdtempSync(path.join(tmpdir(), 'user-personas-'));
    
    // Mock getLaceDir to return our temp directory
    const originalGetLaceDir = require('~/config/lace-dir').getLaceDir;
    jest.doMock('~/config/lace-dir', () => ({
      getLaceDir: () => path.dirname(tempUserDir),
    }));

    registry = new PersonaRegistry(tempBundledDir);
  });

  afterEach(() => {
    rmSync(tempBundledDir, { recursive: true, force: true });
    rmSync(tempUserDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('loads bundled personas from directory', () => {
    // Create test personas
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default persona');
    writeFileSync(path.join(tempBundledDir, 'coding-agent.md'), 'Coding persona');
    
    // Create new registry to trigger loading
    registry = new PersonaRegistry(tempBundledDir);
    
    const personas = registry.listAvailablePersonas();
    expect(personas).toHaveLength(2);
    expect(personas.map(p => p.name)).toContain('lace');
    expect(personas.map(p => p.name)).toContain('coding-agent');
    expect(personas.every(p => !p.isUserDefined)).toBe(true);
  });

  it('user personas override built-in ones', () => {
    // Create built-in personas
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default persona');
    
    // Create user override
    mkdirSync(path.join(tempUserDir, 'agent-personas'), { recursive: true });
    writeFileSync(path.join(tempUserDir, 'agent-personas', 'lace.md'), 'User override');
    
    registry = new PersonaRegistry(tempBundledDir);
    
    const personas = registry.listAvailablePersonas();
    const lacePersona = personas.find(p => p.name === 'lace');
    
    expect(lacePersona?.isUserDefined).toBe(true);
    expect(lacePersona?.path).toContain('user-personas');
  });

  it('validates persona existence', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default persona');
    registry = new PersonaRegistry(tempBundledDir);
    
    expect(() => registry.validatePersona('lace')).not.toThrow();
    expect(() => registry.validatePersona('nonexistent')).toThrow('Persona \'nonexistent\' not found');
  });

  it('error message lists available personas', () => {
    writeFileSync(path.join(tempBundledDir, 'lace.md'), 'Default');
    writeFileSync(path.join(tempBundledDir, 'coding-agent.md'), 'Coding');
    registry = new PersonaRegistry(tempBundledDir);
    
    expect(() => registry.validatePersona('bad-name')).toThrow('Available personas: coding-agent, lace');
  });
});
```

**How to test:**
```bash
# Run the new test
npm test persona-registry.test.ts

# Verify integration doesn't break existing functionality  
npm test -- --grep "prompt"
npm run build
```

**Commit Message:** "feat: add PersonaRegistry for discovering and validating agent personas"

### Task 3: Update NewAgentSpec Format and Parsing

**Objective**: Change NewAgentSpec from `new:provider/model` to `new:persona:provider/model`

**Files to modify:**
- `packages/core/src/threads/types.ts` - Update regex and parsing functions

**Implementation in `packages/core/src/threads/types.ts`:**

Find the current regex pattern and update it:
```typescript
// Old regex: /^new:([^/]+)\/(.+)$/
// New regex: /^new:([^:]+):([^/]+)\/(.+)$/

export function isNewAgentSpec(value: string): value is NewAgentSpec {
  return /^new:([^:]+):([^/]+)\/(.+)$/.test(value);
}

// Add new parsing function
export interface ParsedNewAgentSpec {
  persona: string;
  provider: string; 
  model: string;
}

export function parseNewAgentSpec(spec: NewAgentSpec): ParsedNewAgentSpec {
  const match = spec.match(/^new:([^:]+):([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid NewAgentSpec format: ${spec}. Expected format: new:persona:provider/model`);
  }
  
  return {
    persona: match[1],
    provider: match[2], 
    model: match[3],
  };
}

// Update helper function
export function createNewAgentSpec(persona: string, provider: string, model: string): NewAgentSpec {
  return `new:${persona}:${provider}/${model}` as NewAgentSpec;
}
```

**Create test file:** `packages/core/src/threads/new-agent-spec.test.ts`

**Test implementation:**
```typescript
import { describe, it, expect } from 'vitest';
import { 
  isNewAgentSpec, 
  parseNewAgentSpec, 
  createNewAgentSpec,
  asNewAgentSpec 
} from './types';

describe('NewAgentSpec', () => {
  describe('isNewAgentSpec', () => {
    it('accepts valid new format', () => {
      expect(isNewAgentSpec('new:lace:anthropic/claude-3-sonnet')).toBe(true);
      expect(isNewAgentSpec('new:coding-agent:openai/gpt-4')).toBe(true);
      expect(isNewAgentSpec('new:helper:ollama/llama2')).toBe(true);
    });

    it('rejects old format', () => {
      expect(isNewAgentSpec('new:anthropic/claude-3-sonnet')).toBe(false);
      expect(isNewAgentSpec('new:openai/gpt-4')).toBe(false);
    });

    it('rejects invalid formats', () => {
      expect(isNewAgentSpec('anthropic/claude-3-sonnet')).toBe(false);
      expect(isNewAgentSpec('new:lace')).toBe(false);
      expect(isNewAgentSpec('new:lace:anthropic')).toBe(false);
      expect(isNewAgentSpec('')).toBe(false);
    });
  });

  describe('parseNewAgentSpec', () => {
    it('parses valid specs correctly', () => {
      const spec = asNewAgentSpec('new:coding-agent:anthropic/claude-3-sonnet');
      const parsed = parseNewAgentSpec(spec);
      
      expect(parsed.persona).toBe('coding-agent');
      expect(parsed.provider).toBe('anthropic'); 
      expect(parsed.model).toBe('claude-3-sonnet');
    });

    it('handles complex model names', () => {
      const spec = asNewAgentSpec('new:lace:openai/gpt-4-turbo-preview');
      const parsed = parseNewAgentSpec(spec);
      
      expect(parsed.model).toBe('gpt-4-turbo-preview');
    });

    it('throws on invalid format', () => {
      const spec = asNewAgentSpec('new:anthropic/claude-3-sonnet'); // Old format
      expect(() => parseNewAgentSpec(spec)).toThrow('Invalid NewAgentSpec format');
      expect(() => parseNewAgentSpec(spec)).toThrow('Expected format: new:persona:provider/model');
    });
  });

  describe('createNewAgentSpec', () => {
    it('creates valid specs', () => {
      const spec = createNewAgentSpec('lace', 'anthropic', 'claude-3-sonnet');
      expect(spec).toBe('new:lace:anthropic/claude-3-sonnet');
      expect(isNewAgentSpec(spec)).toBe(true);
    });

    it('handles special characters in names', () => {
      const spec = createNewAgentSpec('my-custom-agent', 'provider-x', 'model-v2.1');
      expect(spec).toBe('new:my-custom-agent:provider-x/model-v2.1');
      expect(isNewAgentSpec(spec)).toBe(true);
    });
  });
});
```

**Find and update all existing usage:**
```bash
# Find files using old format
grep -r "new:" packages/core/src/ --include="*.ts" --include="*.test.ts"

# Look for createNewAgentSpec calls  
grep -r "createNewAgentSpec" packages/core/src/
```

**Files likely needing updates:**
- Any test files creating NewAgentSpec instances
- Task system files that parse NewAgentSpec
- Agent spawning logic

**Testing:**
```bash
# Run new tests
npm test new-agent-spec.test.ts

# Run all tests to catch breaking changes
npm test

# If tests fail due to old format usage, update them to new format
```

**Commit Message:** "feat: update NewAgentSpec format to new:persona:provider/model"

### Task 4: Enhance PromptManager with Persona Support

**Objective**: Add persona parameter to `generateSystemPrompt()` method

**Files to modify:**
- `packages/core/src/config/prompt-manager.ts` - Add persona parameter
- `packages/core/src/config/prompts.ts` - Update `loadPromptConfig()` to pass persona

**Implementation in `packages/core/src/config/prompt-manager.ts`:**

Find the `generateSystemPrompt()` method and modify it:
```typescript
// Add import at top
import { personaRegistry } from './persona-registry';

export class PromptManager {
  // ... existing code ...

  /**
   * Generate system prompt for specified persona (defaults to 'lace')
   */
  async generateSystemPrompt(persona: string = 'lace'): Promise<string> {
    // Validate persona exists
    personaRegistry.validatePersona(persona);
    
    // Get persona template path
    const personaPath = personaRegistry.getPersonaPath(persona);
    if (!personaPath) {
      throw new Error(`Persona '${persona}' not found`);
    }
    
    // Load and process the persona template
    const template = await this.loadTemplate(personaPath);
    return await this.processTemplate(template);
  }

  private async loadTemplate(templatePath: string): Promise<string> {
    try {
      return await fs.readFile(templatePath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to load persona template: ${templatePath}`);
    }
  }

  // Modify processIncludes to support user overrides
  private async processIncludes(content: string, basePath: string): Promise<string> {
    const includeRegex = /\{\{include:([^}]+)\}\}/g;
    let result = content;
    let match;

    while ((match = includeRegex.exec(content)) !== null) {
      const includePath = match[1];
      const includeContent = await this.loadIncludeFile(includePath, basePath);
      result = result.replace(match[0], includeContent);
    }

    return result;
  }

  private async loadIncludeFile(includePath: string, basePath: string): Promise<string> {
    // Check user overrides first
    const userBasePath = path.join(getLaceDir(), 'agent-personas');
    const userIncludePath = path.join(userBasePath, includePath);
    
    if (fs.existsSync(userIncludePath)) {
      return await fs.readFile(userIncludePath, 'utf-8');
    }

    // Fall back to bundled include
    const bundledIncludePath = path.join(basePath, '..', includePath);
    if (fs.existsSync(bundledIncludePath)) {
      return await fs.readFile(bundledIncludePath, 'utf-8'); 
    }

    throw new Error(`Include file not found: ${includePath}`);
  }
}
```

**Update `packages/core/src/config/prompts.ts`:**

Modify `loadPromptConfig()` to accept persona parameter:
```typescript
export async function loadPromptConfig(
  options: PromptOptions & { persona?: string } = {}
): Promise<PromptConfig> {
  logger.debug('Loading prompt config using template system', { persona: options.persona });

  const promptManager = new PromptManager({
    tools: options.tools,
    session: options.session,
    project: options.project,
  });
  
  const systemPrompt = await promptManager.generateSystemPrompt(options.persona);
  const userInstructions = loadUserInstructions();

  logger.info('Loaded prompt config using template system', { persona: options.persona });
  return {
    systemPrompt,
    userInstructions: userInstructions.content.trim(),
    filesCreated: userInstructions.wasCreated ? [getUserInstructionsPath()] : [],
  };
}
```

**Create test file:** `packages/core/src/config/prompt-manager.test.ts`

**Test implementation:**
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PromptManager } from './prompt-manager';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

describe('PromptManager', () => {
  let tempPersonasDir: string;
  let promptManager: PromptManager;

  beforeEach(() => {
    tempPersonasDir = fs.mkdtempSync(path.join(tmpdir(), 'personas-'));
    
    // Create test persona files
    fs.writeFileSync(
      path.join(tempPersonasDir, 'lace.md'),
      '# Lace Default\n{{include:sections/core.md}}'
    );
    
    fs.writeFileSync(
      path.join(tempPersonasDir, 'coding-agent.md'), 
      '# Coding Agent\n{{include:sections/core.md}}\n{{include:sections/coding.md}}'
    );

    // Create sections directory
    fs.mkdirSync(path.join(tempPersonasDir, 'sections'));
    fs.writeFileSync(
      path.join(tempPersonasDir, 'sections', 'core.md'),
      'Core functionality'
    );
    fs.writeFileSync(
      path.join(tempPersonasDir, 'sections', 'coding.md'),
      'Coding specific behavior'
    );

    // Mock persona registry
    jest.doMock('./persona-registry', () => ({
      personaRegistry: {
        validatePersona: jest.fn(),
        getPersonaPath: (name: string) => path.join(tempPersonasDir, `${name}.md`),
      },
    }));

    promptManager = new PromptManager({});
  });

  afterEach(() => {
    fs.rmSync(tempPersonasDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('generates system prompt for default persona', async () => {
    const prompt = await promptManager.generateSystemPrompt();
    
    expect(prompt).toContain('# Lace Default');
    expect(prompt).toContain('Core functionality');
    expect(prompt).not.toContain('{{include:');
  });

  it('generates system prompt for specified persona', async () => {
    const prompt = await promptManager.generateSystemPrompt('coding-agent');
    
    expect(prompt).toContain('# Coding Agent');
    expect(prompt).toContain('Core functionality');
    expect(prompt).toContain('Coding specific behavior');
  });

  it('validates persona before loading', async () => {
    const mockValidate = jest.fn().mockImplementation(() => {
      throw new Error('Persona not found');
    });
    
    jest.doMock('./persona-registry', () => ({
      personaRegistry: { 
        validatePersona: mockValidate,
        getPersonaPath: () => null,
      },
    }));

    const manager = new PromptManager({});
    
    await expect(manager.generateSystemPrompt('nonexistent')).rejects.toThrow('Persona not found');
    expect(mockValidate).toHaveBeenCalledWith('nonexistent');
  });
});
```

**Testing:**
```bash
# Run new tests
npm test prompt-manager.test.ts

# Run existing prompt tests to ensure no regression
npm test -- --grep "prompt"

# Test integration
npm run build
```

**Commit Message:** "feat: add persona parameter to PromptManager.generateSystemPrompt()"

### Task 5: Update Agent Constructor and Configuration

**Objective**: Add persona support to Agent class and configuration

**Files to modify:**
- `packages/core/src/agents/agent.ts` - Add persona to AgentConfig and AgentInfo
- Update anywhere agents are created to pass persona

**Implementation in `packages/core/src/agents/agent.ts`:**

Find the interfaces and update them:
```typescript
export interface AgentConfig {
  toolExecutor: ToolExecutor;
  threadManager: ThreadManager;
  threadId: string;
  tools: Tool[];
  persona?: string; // Add this line
  metadata?: {
    name: string;
    modelId: string;
    providerInstanceId: string;
  };
}

export interface AgentInfo {
  threadId: ThreadId;
  name: string;
  providerInstanceId: string;
  modelId: string;
  status: AgentState;
  persona: string; // Add this line
}

// In the Agent class constructor, store the persona
export class Agent extends EventEmitter<AgentEvents> {
  private persona: string;
  
  constructor(private config: AgentConfig, private provider: AIProvider) {
    super();
    this.persona = config.persona || 'lace'; // Default to 'lace'
    // ... rest of constructor
  }

  // Update getInfo() method
  getInfo(): AgentInfo {
    return {
      threadId: asThreadId(this.config.threadId),
      name: this.config.metadata?.name || 'Unnamed Agent',
      providerInstanceId: this.config.metadata?.providerInstanceId || 'unknown',
      modelId: this.config.metadata?.modelId || 'unknown',
      status: this.state,
      persona: this.persona, // Add this line
    };
  }

  // Update sendMessage method to use persona when loading prompts
  private async sendMessage(message: string): Promise<void> {
    // ... existing code ...
    
    // When loading prompt config, pass the persona
    const promptConfig = await loadPromptConfig({
      persona: this.persona, // Add this line
      tools: this.config.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
      })),
      // ... rest of options
    });
    
    // ... rest of method
  }
}
```

**Create test file:** `packages/core/src/agents/agent-persona.test.ts`

**Test implementation:**
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Agent, AgentConfig } from './agent';
import { createMockToolExecutor, createMockThreadManager, createMockProvider } from '../test-utils';

describe('Agent Personas', () => {
  let baseConfig: AgentConfig;

  beforeEach(() => {
    baseConfig = {
      toolExecutor: createMockToolExecutor(),
      threadManager: createMockThreadManager(), 
      threadId: 'test-thread',
      tools: [],
    };
  });

  it('defaults to lace persona when none specified', () => {
    const agent = new Agent(baseConfig, createMockProvider());
    
    expect(agent.getInfo().persona).toBe('lace');
  });

  it('uses specified persona from config', () => {
    const config = { ...baseConfig, persona: 'coding-agent' };
    const agent = new Agent(config, createMockProvider());
    
    expect(agent.getInfo().persona).toBe('coding-agent');
  });

  it('includes persona in agent info', () => {
    const config = { ...baseConfig, persona: 'helper-agent' };
    const agent = new Agent(config, createMockProvider());
    
    const info = agent.getInfo();
    expect(info).toHaveProperty('persona');
    expect(info.persona).toBe('helper-agent');
  });

  // Integration test - requires mocking loadPromptConfig
  it('passes persona to prompt loading', async () => {
    const mockLoadPromptConfig = jest.fn().mockResolvedValue({
      systemPrompt: 'Test prompt',
      userInstructions: '',
      filesCreated: [],
    });
    
    jest.doMock('~/config/prompts', () => ({
      loadPromptConfig: mockLoadPromptConfig,
    }));

    const config = { ...baseConfig, persona: 'coding-agent' };
    const agent = new Agent(config, createMockProvider());
    
    // Trigger prompt loading by sending a message
    await agent.sendMessage('test');
    
    expect(mockLoadPromptConfig).toHaveBeenCalledWith(
      expect.objectContaining({ persona: 'coding-agent' })
    );
  });
});
```

**Testing:**
```bash
# Run new agent persona tests
npm test agent-persona.test.ts

# Run existing agent tests to ensure no regression
npm test agent.test.ts

# Check overall agent functionality
npm test -- --grep "agent"
```

**Commit Message:** "feat: add persona support to Agent class and configuration"

### Task 6: Update Task System for New NewAgentSpec Format

**Objective**: Update task system to parse and handle new `new:persona:provider/model` format

**Files to modify:**
- `packages/core/src/tasks/task-manager.ts` - Update agent spawning logic
- Any files that create or parse NewAgentSpec for tasks

**Find current agent spawning code:**
```bash
# Find task-related agent spawning
grep -r "new:" packages/core/src/tasks/
grep -r "createNewAgentSpec\|parseNewAgentSpec" packages/core/src/tasks/
```

**Implementation in task management files:**

Update agent spawning logic to handle persona:
```typescript
// In task-manager.ts or similar files

import { parseNewAgentSpec, isNewAgentSpec } from '~/threads/types';
import { personaRegistry } from '~/config/persona-registry';

// When creating agents from tasks
private async spawnAgentForTask(assignedTo: AssigneeId): Promise<ThreadId> {
  if (!isNewAgentSpec(assignedTo)) {
    throw new Error(`Invalid agent spec: ${assignedTo}`);
  }

  try {
    const parsed = parseNewAgentSpec(assignedTo);
    
    // Validate persona exists before creating agent
    personaRegistry.validatePersona(parsed.persona);
    
    // Create agent with persona
    const agentConfig: AgentConfig = {
      toolExecutor: this.toolExecutor,
      threadManager: this.threadManager,
      threadId: newThreadId,
      tools: this.tools,
      persona: parsed.persona, // Add this line
      metadata: {
        name: `Task Agent (${parsed.persona})`,
        modelId: parsed.model,
        providerInstanceId: parsed.provider,
      },
    };

    const provider = await this.getProvider(parsed.provider, parsed.model);
    const agent = new Agent(agentConfig, provider);
    
    // ... rest of spawning logic
    
  } catch (error) {
    throw new Error(`Failed to spawn agent: ${error.message}`);
  }
}

// Helper method to get provider instance
private async getProvider(providerName: string, modelId: string): Promise<AIProvider> {
  // Implementation depends on existing provider registry
  // This is just an example structure
  const provider = await this.providerRegistry.getProvider(providerName);
  return provider.withModel(modelId);
}
```

**Create comprehensive tests:** `packages/core/src/tasks/agent-spawning-personas.test.ts`

**Test implementation:**
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { TaskManager } from './task-manager';
import { createNewAgentSpec, asNewAgentSpec } from '~/threads/types';
import { createMockToolExecutor, createMockThreadManager } from '../test-utils';

describe('Task Agent Spawning with Personas', () => {
  let taskManager: TaskManager;
  
  beforeEach(() => {
    taskManager = new TaskManager({
      toolExecutor: createMockToolExecutor(),
      threadManager: createMockThreadManager(),
      tools: [],
    });
    
    // Mock persona registry
    jest.doMock('~/config/persona-registry', () => ({
      personaRegistry: {
        validatePersona: jest.fn().mockImplementation((name: string) => {
          if (!['lace', 'coding-agent', 'helper-agent'].includes(name)) {
            throw new Error(`Persona '${name}' not found`);
          }
        }),
      },
    }));
  });

  it('spawns agent with correct persona from NewAgentSpec', async () => {
    const agentSpec = createNewAgentSpec('coding-agent', 'anthropic', 'claude-3-sonnet');
    
    const taskId = await taskManager.createTask({
      title: 'Test Task',
      prompt: 'Do something',
      assignedTo: agentSpec,
    });
    
    // Verify agent was created with correct persona
    const task = await taskManager.getTask(taskId);
    expect(task.assignedTo).toBe(agentSpec);
    
    // If you have access to the created agent, verify its persona
    // This depends on your task manager implementation
  });

  it('validates persona before spawning agent', async () => {
    const invalidSpec = asNewAgentSpec('new:nonexistent:anthropic/claude-3-sonnet');
    
    await expect(
      taskManager.createTask({
        title: 'Test Task',
        prompt: 'Do something',
        assignedTo: invalidSpec,
      })
    ).rejects.toThrow('Persona \'nonexistent\' not found');
  });

  it('includes persona in agent metadata name', async () => {
    const agentSpec = createNewAgentSpec('helper-agent', 'openai', 'gpt-4');
    
    const taskId = await taskManager.createTask({
      title: 'Test Task',
      prompt: 'Do something',
      assignedTo: agentSpec,
    });
    
    // This test depends on your ability to inspect created agents
    // Adjust based on your task manager implementation
    const createdAgent = await taskManager.getAgentForTask(taskId);
    expect(createdAgent.getInfo().name).toContain('helper-agent');
  });

  it('rejects old format NewAgentSpec', async () => {
    const oldFormatSpec = asNewAgentSpec('new:anthropic/claude-3-sonnet'); // Old format
    
    await expect(
      taskManager.createTask({
        title: 'Test Task', 
        prompt: 'Do something',
        assignedTo: oldFormatSpec,
      })
    ).rejects.toThrow('Invalid NewAgentSpec format');
  });
});
```

**Update any existing tests using old format:**
```bash
# Find and update tests using old NewAgentSpec format
grep -r "new:.*/" packages/core/src/ --include="*.test.ts"

# Update each found test to use new format:
# OLD: new:anthropic/claude-3-sonnet  
# NEW: new:lace:anthropic/claude-3-sonnet
```

**Testing:**
```bash
# Run new task spawning tests
npm test agent-spawning-personas.test.ts

# Run all task tests
npm test -- --grep "task"

# Update and run existing tests that might use old format
npm test
```

**Commit Message:** "feat: update task system to handle new persona:provider/model format"

### Task 7: Add Example Personas

**Objective**: Create example personas to demonstrate the system

**Create example persona files:**

**File:** `packages/core/config/agent-personas/coding-agent.md`
```markdown
{{include:sections/agent-personality.md}}

You are a specialized coding assistant with deep expertise in software development. Your primary focus is on:

- Writing clean, maintainable, well-tested code
- Following established patterns and best practices  
- Providing detailed technical explanations
- Debugging complex issues systematically
- Suggesting refactoring opportunities

{{include:sections/core-principles.md}}

## Coding-Specific Guidelines

- Always write tests first (TDD approach)
- Prefer composition over inheritance
- Use meaningful variable and function names
- Include proper error handling and edge cases
- Consider performance implications of your suggestions
- Follow the existing codebase patterns and style

{{include:sections/tools.md}}

{{include:sections/workflows.md}}

{{include:sections/code-quality.md}}

{{include:sections/collaboration.md}}

{{include:sections/error-recovery.md}}

{{include:sections/examples.md}}

{{context.disclaimer}}
```

**File:** `packages/core/config/agent-personas/helper-agent.md`
```markdown
{{include:sections/agent-personality.md}}

You are a helpful assistant focused on productivity and task completion. Your role is to:

- Break down complex tasks into manageable steps
- Provide quick, practical solutions
- Offer helpful suggestions and alternatives  
- Maintain a supportive, encouraging tone
- Focus on getting things done efficiently

{{include:sections/core-principles.md}}

## Helper-Specific Guidelines

- Prioritize user's immediate needs
- Suggest time-saving shortcuts and tools
- Ask clarifying questions when requests are unclear
- Provide step-by-step instructions for complex processes
- Offer to handle routine tasks automatically
- Keep responses concise but complete

{{include:sections/interaction-patterns.md}}

{{include:sections/environment.md}}

{{include:sections/tools.md}}

{{include:sections/workflows.md}}

{{include:sections/collaboration.md}}

{{include:sections/error-recovery.md}}

{{context.disclaimer}}
```

**Create test to verify personas load correctly:**

**File:** `packages/core/src/config/example-personas.test.ts`
```typescript
import { describe, it, expect } from 'vitest';
import { PromptManager } from './prompt-manager';
import { personaRegistry } from './persona-registry';

describe('Example Personas', () => {
  it('loads all example personas without error', async () => {
    const personas = personaRegistry.listAvailablePersonas();
    const builtInPersonas = personas.filter(p => !p.isUserDefined);
    
    // Should have at least lace, coding-agent, helper-agent
    expect(builtInPersonas.length).toBeGreaterThanOrEqual(3);
    
    const personaNames = builtInPersonas.map(p => p.name);
    expect(personaNames).toContain('lace');
    expect(personaNames).toContain('coding-agent'); 
    expect(personaNames).toContain('helper-agent');
  });

  it('generates valid prompts for all example personas', async () => {
    const promptManager = new PromptManager({});
    const personas = ['lace', 'coding-agent', 'helper-agent'];
    
    for (const persona of personas) {
      const prompt = await promptManager.generateSystemPrompt(persona);
      
      expect(prompt).toBeTruthy();
      expect(prompt.length).toBeGreaterThan(100); // Should be substantial
      expect(prompt).not.toContain('{{include:'); // All includes should be resolved
      expect(prompt).not.toContain('{{context.'); // All context should be resolved
    }
  });

  it('coding-agent persona includes coding-specific content', async () => {
    const promptManager = new PromptManager({});
    const prompt = await promptManager.generateSystemPrompt('coding-agent');
    
    expect(prompt.toLowerCase()).toContain('coding');
    expect(prompt.toLowerCase()).toContain('test'); // TDD focus
    expect(prompt.toLowerCase()).toContain('software');
  });

  it('helper-agent persona includes helper-specific content', async () => {
    const promptManager = new PromptManager({});
    const prompt = await promptManager.generateSystemPrompt('helper-agent');
    
    expect(prompt.toLowerCase()).toContain('helpful');
    expect(prompt.toLowerCase()).toContain('task');
    expect(prompt.toLowerCase()).toContain('productivity');
  });
});
```

**Testing:**
```bash
# Test example personas
npm test example-personas.test.ts

# Verify they work in full integration
npm run build
npm start # Test that app still launches

# Test creating agents with new personas (if you have CLI commands for this)
```

**Commit Message:** "feat: add coding-agent and helper-agent example personas"

### Task 8: Web UI Integration

**Objective**: Update web UI to display persona information and support new format

**Files likely needing updates:**
```bash
# Find web UI files that might need updates
find packages/web -name "*.tsx" -o -name "*.ts" | grep -E "(agent|task)" | head -10
```

**Look for:**
- Agent info displays
- Task assignment forms
- Agent creation interfaces
- Any hardcoded references to old NewAgentSpec format

**Example updates needed (adjust based on actual web UI structure):**

**In agent info component:**
```typescript
// Add persona to agent info display
interface AgentInfoProps {
  agent: AgentInfo; // This now includes persona field
}

function AgentInfo({ agent }: AgentInfoProps) {
  return (
    <div className="agent-info">
      <div>Name: {agent.name}</div>
      <div>Model: {agent.modelId}</div>
      <div>Provider: {agent.providerInstanceId}</div>
      <div>Persona: {agent.persona}</div> {/* Add this line */}
      <div>Status: {agent.status}</div>
    </div>
  );
}
```

**In task assignment form:**
```typescript
// Update form to use new agent spec format
function TaskAssignmentForm() {
  const [persona, setPersona] = useState('lace');
  const [provider, setProvider] = useState('anthropic');
  const [model, setModel] = useState('claude-3-sonnet');
  
  const agentSpec = `new:${persona}:${provider}/${model}`;
  
  return (
    <form>
      <select value={persona} onChange={e => setPersona(e.target.value)}>
        <option value="lace">Lace (Default)</option>
        <option value="coding-agent">Coding Agent</option>
        <option value="helper-agent">Helper Agent</option>
      </select>
      {/* ... other form fields */}
    </form>
  );
}
```

**Create test file:** `packages/web/components/agent-info.test.tsx`
```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentInfo } from './agent-info';
import type { AgentInfo as AgentInfoType } from '@lace/core/agents/agent';

describe('AgentInfo Component', () => {
  const mockAgent: AgentInfoType = {
    threadId: 'test-thread' as any,
    name: 'Test Agent',
    modelId: 'claude-3-sonnet',
    providerInstanceId: 'anthropic',
    status: 'idle',
    persona: 'coding-agent',
  };

  it('displays agent persona', () => {
    render(<AgentInfo agent={mockAgent} />);
    
    expect(screen.getByText(/persona/i)).toBeInTheDocument();
    expect(screen.getByText(/coding-agent/i)).toBeInTheDocument();
  });

  it('displays all agent information', () => {
    render(<AgentInfo agent={mockAgent} />);
    
    expect(screen.getByText(/Test Agent/)).toBeInTheDocument();
    expect(screen.getByText(/claude-3-sonnet/)).toBeInTheDocument();
    expect(screen.getByText(/anthropic/)).toBeInTheDocument();
    expect(screen.getByText(/idle/)).toBeInTheDocument();
  });
});
```

**Testing:**
```bash
# Test web UI components
npm test --workspace=packages/web

# Test full web interface (manual)
npm run dev:web
# Navigate to agent info pages and verify persona displays

# Test task assignment forms work with new format
# Create test tasks with different personas
```

**Commit Message:** "feat: add persona display to web UI agent info and task forms"

### Task 9: Documentation Updates

**Objective**: Update all documentation to reflect new persona system

**Files to update:**

**Update README or main docs:**
```markdown
## Agent Personas

Lace supports multiple agent personas - different system prompts that give agents distinct personalities and capabilities.

### Built-in Personas
- `lace`: Default general-purpose assistant
- `coding-agent`: Specialized for software development
- `helper-agent`: Focused on productivity and task completion

### Using Personas

When creating agents through the task system:
```bash
# Create a coding-focused agent
new:coding-agent:anthropic/claude-3-sonnet

# Create a helpful task-oriented agent  
new:helper-agent:openai/gpt-4
```

### Custom Personas

Create your own personas in `~/.lace/agent-personas/`:

1. Create a new `.md` file (e.g., `my-persona.md`)
2. Use the template system with `{{include:sections/...}}` 
3. Add persona-specific content and guidelines
4. Use in tasks: `new:my-persona:provider/model`

User personas override built-in ones with the same name.
```

**Update API documentation:**
- Document persona parameter in Agent constructor
- Update NewAgentSpec format documentation  
- Add persona examples to task system docs

**Update migration guide:**
```markdown
## Breaking Changes - Persona System

### NewAgentSpec Format Change

**Old Format:** `new:provider/model`
**New Format:** `new:persona:provider/model`

#### Migration Required

Update all agent specifications:

```typescript
// Before
const spec = createNewAgentSpec('anthropic', 'claude-3-sonnet');
// Result: 'new:anthropic/claude-3-sonnet'

// After  
const spec = createNewAgentSpec('lace', 'anthropic', 'claude-3-sonnet');
// Result: 'new:lace:anthropic/claude-3-sonnet'
```

#### Impact

- All existing task assignments using old format will fail
- Update any hardcoded agent specs in your code
- Update any user-facing documentation showing agent creation syntax
```

**Testing:**
```bash
# Verify documentation builds/renders correctly
npm run build:docs # if you have doc building

# Test examples in documentation actually work
# Try the example commands and code snippets
```

**Commit Message:** "docs: update documentation for agent persona system"

### Task 10: Integration Testing and Cleanup

**Objective**: End-to-end testing and final cleanup

**Create comprehensive integration test:** `packages/core/src/integration/persona-system.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { TaskManager } from '~/tasks/task-manager';
import { createNewAgentSpec } from '~/threads/types';
import { personaRegistry } from '~/config/persona-registry';

describe('Persona System Integration', () => {
  it('creates agent with persona and loads correct prompt', async () => {
    // Verify persona exists
    expect(personaRegistry.hasPersona('coding-agent')).toBe(true);
    
    // Create agent with persona
    const agentSpec = createNewAgentSpec('coding-agent', 'anthropic', 'claude-3-sonnet');
    
    // This test requires full integration with your task/agent creation system
    const agent = await createAgentFromSpec(agentSpec);
    
    expect(agent.getInfo().persona).toBe('coding-agent');
    
    // Verify agent actually uses the persona prompt
    // This might require inspecting internal state or mock verification
  });

  it('handles full task workflow with persona agents', async () => {
    const taskManager = new TaskManager({/* config */});
    
    // Create task assigned to coding agent
    const taskId = await taskManager.createTask({
      title: 'Implement feature X',
      prompt: 'Write a function that does Y',
      assignedTo: createNewAgentSpec('coding-agent', 'anthropic', 'claude-3-sonnet'),
    });
    
    // Start task (should spawn agent with correct persona)
    await taskManager.startTask(taskId);
    
    const task = await taskManager.getTask(taskId);
    // Verify agent has correct persona
    // This test structure depends on your task manager implementation
  });

  it('user personas override built-in ones', async () => {
    // This test requires setting up user directory with override files
    // Implementation depends on your test utilities for temp directories
  });
});
```

**Run comprehensive test suite:**
```bash
# Run all tests to ensure nothing is broken
npm test

# Run integration tests specifically  
npm test -- --grep "integration"

# Test build process
npm run build

# Test that bundling includes new persona files
npm run build:bundle # or whatever your bundle command is

# Manual testing
npm start
# Try creating agents with different personas
# Verify they behave differently based on their prompts
```

**Clean up any remaining issues:**
```bash
# Check for any remaining old format usage
grep -r "new:[^:]*/" packages/core/src/ || echo "All converted!"

# Check for TODO comments added during implementation
grep -r "TODO.*persona" packages/core/src/

# Verify all imports are correct
npm run lint
```

**Final testing checklist:**

- [ ] All existing tests pass
- [ ] New persona-specific tests pass  
- [ ] Integration tests pass
- [ ] Build process succeeds
- [ ] Manual testing of different personas works
- [ ] Web UI displays persona information
- [ ] Task system creates agents with correct personas
- [ ] User persona overrides work
- [ ] Error handling for missing personas works
- [ ] Documentation is accurate

**Final Commit Message:** "feat: complete agent personas system implementation"

---

## Testing Best Practices for This Feature

### Test Categories

1. **Unit Tests**: Test individual components in isolation
   - PersonaRegistry persona discovery
   - NewAgentSpec parsing/validation
   - PromptManager persona loading

2. **Integration Tests**: Test component interactions
   - Agent creation with personas
   - Task system with new agent specs
   - Prompt loading with persona parameter

3. **End-to-End Tests**: Test complete user workflows
   - Create agent with specific persona
   - Verify agent behavior matches persona
   - User persona override functionality

### Test Data Management

```typescript
// Use factory functions for consistent test data
export function createTestPersona(name: string, content?: string): string {
  return content || `# ${name} Persona\n{{include:sections/core.md}}`;
}

export function createTestAgentSpec(persona = 'lace', provider = 'anthropic', model = 'claude-3-sonnet') {
  return createNewAgentSpec(persona, provider, model);
}
```

### Mock Strategy

- Mock file system operations for consistent test environment
- Mock PersonaRegistry for unit tests
- Use real PersonaRegistry for integration tests with temp directories
- Mock AI providers to focus on persona logic, not provider interactions

### Error Testing

Test all error conditions:
- Missing persona files
- Invalid NewAgentSpec formats  
- Persona validation failures
- Template parsing errors

This completes the comprehensive implementation plan. Each task builds incrementally on the previous ones, with thorough testing at each step to catch issues early.