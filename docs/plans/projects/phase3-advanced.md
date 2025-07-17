# Phase 3: Advanced Features

## Task 3.1: Token Budget Management

**Goal**: Implement per-project token budget tracking and enforcement

**Test First** (`src/projects/token-budget.test.ts`):
```typescript
describe('Token budget management', () => {
  let budgetManager: TokenBudgetManager;
  let projectId: string;

  beforeEach(() => {
    budgetManager = new TokenBudgetManager();
    projectId = 'project1';
  });

  it('should track token usage per project', () => {
    budgetManager.recordUsage(projectId, 'session1', {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150
    });

    const usage = budgetManager.getProjectUsage(projectId);
    expect(usage.totalTokens).toBe(150);
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(50);
  });

  it('should enforce project token limits', () => {
    const budget = new TokenBudget({
      projectId,
      maxTokensPerProject: 1000,
      maxTokensPerSession: 500,
      resetPeriod: 'daily'
    });

    budgetManager.setBudget(projectId, budget);

    // Use tokens within session limit
    budgetManager.recordUsage(projectId, 'session1', {
      inputTokens: 400,
      outputTokens: 100,
      totalTokens: 500
    });

    expect(budgetManager.canMakeRequest(projectId, 'session1', 400)).toBe(false); // Would exceed session limit
    expect(budgetManager.canMakeRequest(projectId, 'session2', 400)).toBe(true); // New session
  });

  it('should reset usage based on time period', () => {
    const budget = new TokenBudget({
      projectId,
      maxTokensPerProject: 1000,
      maxTokensPerSession: 500,
      resetPeriod: 'daily'
    });

    budgetManager.setBudget(projectId, budget);

    // Record usage
    budgetManager.recordUsage(projectId, 'session1', {
      inputTokens: 500,
      outputTokens: 0,
      totalTokens: 500
    });

    expect(budgetManager.getProjectUsage(projectId).totalTokens).toBe(500);

    // Simulate time passing (mock Date)
    const nextDay = new Date();
    nextDay.setDate(nextDay.getDate() + 1);
    vi.setSystemTime(nextDay);

    // Usage should reset
    expect(budgetManager.getProjectUsage(projectId).totalTokens).toBe(0);
  });

  it('should aggregate usage across sessions', () => {
    budgetManager.recordUsage(projectId, 'session1', {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150
    });

    budgetManager.recordUsage(projectId, 'session2', {
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300
    });

    const usage = budgetManager.getProjectUsage(projectId);
    expect(usage.totalTokens).toBe(450);
    expect(usage.inputTokens).toBe(300);
    expect(usage.outputTokens).toBe(150);
  });

  it('should provide usage breakdown by session', () => {
    budgetManager.recordUsage(projectId, 'session1', {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150
    });

    budgetManager.recordUsage(projectId, 'session2', {
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300
    });

    const sessions = budgetManager.getSessionUsage(projectId);
    expect(sessions).toHaveLength(2);
    expect(sessions.find(s => s.sessionId === 'session1')?.totalTokens).toBe(150);
    expect(sessions.find(s => s.sessionId === 'session2')?.totalTokens).toBe(300);
  });
});
```

**Implementation** (`src/projects/token-budget.ts`):
```typescript
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  timestamp: Date;
}

export interface TokenBudgetConfig {
  projectId: string;
  maxTokensPerProject?: number;
  maxTokensPerSession?: number;
  resetPeriod: 'hourly' | 'daily' | 'weekly' | 'monthly';
  warningThreshold?: number; // Percentage of budget to trigger warning
}

export class TokenBudget {
  private config: TokenBudgetConfig;

  constructor(config: TokenBudgetConfig) {
    this.config = config;
  }

  getMaxTokensPerProject(): number {
    return this.config.maxTokensPerProject || Infinity;
  }

  getMaxTokensPerSession(): number {
    return this.config.maxTokensPerSession || Infinity;
  }

  getResetPeriod(): 'hourly' | 'daily' | 'weekly' | 'monthly' {
    return this.config.resetPeriod;
  }

  getWarningThreshold(): number {
    return this.config.warningThreshold || 0.8;
  }

  shouldResetUsage(lastReset: Date): boolean {
    const now = new Date();
    const timeDiff = now.getTime() - lastReset.getTime();

    switch (this.config.resetPeriod) {
      case 'hourly':
        return timeDiff > 60 * 60 * 1000;
      case 'daily':
        return timeDiff > 24 * 60 * 60 * 1000;
      case 'weekly':
        return timeDiff > 7 * 24 * 60 * 60 * 1000;
      case 'monthly':
        return timeDiff > 30 * 24 * 60 * 60 * 1000;
      default:
        return false;
    }
  }
}

export interface ProjectUsage {
  projectId: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  sessionCount: number;
  lastReset: Date;
}

export interface SessionUsage {
  sessionId: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  lastUsed: Date;
}

export class TokenBudgetManager {
  private projectUsage = new Map<string, ProjectUsage>();
  private sessionUsage = new Map<string, Map<string, SessionUsage>>();
  private budgets = new Map<string, TokenBudget>();

  setBudget(projectId: string, budget: TokenBudget): void {
    this.budgets.set(projectId, budget);
  }

  recordUsage(projectId: string, sessionId: string, usage: Omit<TokenUsage, 'timestamp'>): void {
    this.recordProjectUsage(projectId, usage);
    this.recordSessionUsage(projectId, sessionId, usage);
  }

  private recordProjectUsage(projectId: string, usage: Omit<TokenUsage, 'timestamp'>): void {
    const budget = this.budgets.get(projectId);
    let projectUsage = this.projectUsage.get(projectId);

    // Check if we need to reset usage
    if (projectUsage && budget?.shouldResetUsage(projectUsage.lastReset)) {
      projectUsage = {
        projectId,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        sessionCount: 0,
        lastReset: new Date()
      };
    }

    if (!projectUsage) {
      projectUsage = {
        projectId,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        sessionCount: 0,
        lastReset: new Date()
      };
    }

    projectUsage.totalTokens += usage.totalTokens;
    projectUsage.inputTokens += usage.inputTokens;
    projectUsage.outputTokens += usage.outputTokens;

    this.projectUsage.set(projectId, projectUsage);
  }

  private recordSessionUsage(projectId: string, sessionId: string, usage: Omit<TokenUsage, 'timestamp'>): void {
    let sessions = this.sessionUsage.get(projectId);
    if (!sessions) {
      sessions = new Map();
      this.sessionUsage.set(projectId, sessions);
    }

    let sessionUsage = sessions.get(sessionId);
    if (!sessionUsage) {
      sessionUsage = {
        sessionId,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        requestCount: 0,
        lastUsed: new Date()
      };
    }

    sessionUsage.totalTokens += usage.totalTokens;
    sessionUsage.inputTokens += usage.inputTokens;
    sessionUsage.outputTokens += usage.outputTokens;
    sessionUsage.requestCount += 1;
    sessionUsage.lastUsed = new Date();

    sessions.set(sessionId, sessionUsage);
  }

  canMakeRequest(projectId: string, sessionId: string, estimatedTokens: number): boolean {
    const budget = this.budgets.get(projectId);
    if (!budget) return true; // No budget set

    const projectUsage = this.getProjectUsage(projectId);
    const sessionUsage = this.getSessionUsage(projectId).find(s => s.sessionId === sessionId);

    // Check project limit
    if (projectUsage.totalTokens + estimatedTokens > budget.getMaxTokensPerProject()) {
      return false;
    }

    // Check session limit
    const currentSessionTokens = sessionUsage?.totalTokens || 0;
    if (currentSessionTokens + estimatedTokens > budget.getMaxTokensPerSession()) {
      return false;
    }

    return true;
  }

  getProjectUsage(projectId: string): ProjectUsage {
    const usage = this.projectUsage.get(projectId);
    if (!usage) {
      return {
        projectId,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        sessionCount: 0,
        lastReset: new Date()
      };
    }

    // Check if we need to reset usage
    const budget = this.budgets.get(projectId);
    if (budget?.shouldResetUsage(usage.lastReset)) {
      const resetUsage = {
        projectId,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        sessionCount: 0,
        lastReset: new Date()
      };
      this.projectUsage.set(projectId, resetUsage);
      return resetUsage;
    }

    return usage;
  }

  getSessionUsage(projectId: string): SessionUsage[] {
    const sessions = this.sessionUsage.get(projectId);
    if (!sessions) return [];

    return Array.from(sessions.values());
  }

  getBudget(projectId: string): TokenBudget | undefined {
    return this.budgets.get(projectId);
  }

  isApproachingLimit(projectId: string): boolean {
    const budget = this.budgets.get(projectId);
    if (!budget) return false;

    const usage = this.getProjectUsage(projectId);
    const threshold = budget.getWarningThreshold();
    const limit = budget.getMaxTokensPerProject();

    return usage.totalTokens / limit > threshold;
  }
}
```

**Commit**: "feat: implement token budget management"

## Task 3.2: Custom Prompt Templates

**Goal**: Allow projects to define custom prompt templates

**Test First** (`src/projects/prompt-templates.test.ts`):
```typescript
describe('Custom prompt templates', () => {
  let templateManager: PromptTemplateManager;
  let projectId: string;

  beforeEach(() => {
    templateManager = new PromptTemplateManager();
    projectId = 'project1';
  });

  it('should store and retrieve custom templates', () => {
    const template = new PromptTemplate({
      id: 'custom-template',
      name: 'Custom Code Review',
      description: 'Template for code review sessions',
      content: 'You are a senior software engineer reviewing code. Focus on: {{focus_areas}}',
      variables: ['focus_areas'],
      projectId
    });

    templateManager.saveTemplate(template);
    const retrieved = templateManager.getTemplate(projectId, 'custom-template');

    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('Custom Code Review');
    expect(retrieved?.variables).toEqual(['focus_areas']);
  });

  it('should render template with variables', () => {
    const template = new PromptTemplate({
      id: 'custom-template',
      name: 'Custom Code Review',
      description: 'Template for code review sessions',
      content: 'You are a {{role}} reviewing {{type}}. Focus on: {{focus_areas}}',
      variables: ['role', 'type', 'focus_areas'],
      projectId
    });

    templateManager.saveTemplate(template);

    const rendered = templateManager.renderTemplate(projectId, 'custom-template', {
      role: 'senior software engineer',
      type: 'TypeScript code',
      focus_areas: 'type safety, performance, maintainability'
    });

    expect(rendered).toBe('You are a senior software engineer reviewing TypeScript code. Focus on: type safety, performance, maintainability');
  });

  it('should validate required variables', () => {
    const template = new PromptTemplate({
      id: 'custom-template',
      name: 'Custom Template',
      description: 'A template with required variables',
      content: 'Hello {{name}}, you are working on {{project}}',
      variables: ['name', 'project'],
      projectId
    });

    templateManager.saveTemplate(template);

    expect(() => {
      templateManager.renderTemplate(projectId, 'custom-template', {
        name: 'John'
        // missing 'project' variable
      });
    }).toThrow('Missing required variable: project');
  });

  it('should list templates for project', () => {
    const template1 = new PromptTemplate({
      id: 'template1',
      name: 'Template 1',
      description: 'First template',
      content: 'Content 1',
      variables: [],
      projectId
    });

    const template2 = new PromptTemplate({
      id: 'template2',
      name: 'Template 2',
      description: 'Second template',
      content: 'Content 2',
      variables: [],
      projectId
    });

    templateManager.saveTemplate(template1);
    templateManager.saveTemplate(template2);

    const templates = templateManager.getTemplatesForProject(projectId);
    expect(templates).toHaveLength(2);
    expect(templates.map(t => t.id)).toContain('template1');
    expect(templates.map(t => t.id)).toContain('template2');
  });

  it('should inherit from parent templates', () => {
    const parentTemplate = new PromptTemplate({
      id: 'parent-template',
      name: 'Parent Template',
      description: 'Base template',
      content: 'Base instructions: {{base_instructions}}',
      variables: ['base_instructions'],
      projectId
    });

    const childTemplate = new PromptTemplate({
      id: 'child-template',
      name: 'Child Template',
      description: 'Extended template',
      content: '{{parent}} Additional instructions: {{additional_instructions}}',
      variables: ['additional_instructions'],
      parentTemplateId: 'parent-template',
      projectId
    });

    templateManager.saveTemplate(parentTemplate);
    templateManager.saveTemplate(childTemplate);

    const rendered = templateManager.renderTemplate(projectId, 'child-template', {
      base_instructions: 'Be helpful and accurate',
      additional_instructions: 'Focus on TypeScript best practices'
    });

    expect(rendered).toBe('Base instructions: Be helpful and accurate Additional instructions: Focus on TypeScript best practices');
  });
});
```

**Implementation** (`src/projects/prompt-templates.ts`):
```typescript
export interface PromptTemplateConfig {
  id: string;
  name: string;
  description: string;
  content: string;
  variables: string[];
  projectId: string;
  parentTemplateId?: string;
  isDefault?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export class PromptTemplate {
  private config: PromptTemplateConfig;

  constructor(config: PromptTemplateConfig) {
    this.config = {
      ...config,
      createdAt: config.createdAt || new Date(),
      updatedAt: config.updatedAt || new Date()
    };
  }

  getId(): string {
    return this.config.id;
  }

  getName(): string {
    return this.config.name;
  }

  getDescription(): string {
    return this.config.description;
  }

  getContent(): string {
    return this.config.content;
  }

  getVariables(): string[] {
    return this.config.variables;
  }

  getProjectId(): string {
    return this.config.projectId;
  }

  getParentTemplateId(): string | undefined {
    return this.config.parentTemplateId;
  }

  isDefault(): boolean {
    return this.config.isDefault || false;
  }

  render(variables: Record<string, string>): string {
    let content = this.config.content;

    // Replace variables in content
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      content = content.replace(regex, value);
    }

    // Check for unresolved variables
    const unresolvedVariables = content.match(/\{\{[^}]+\}\}/g);
    if (unresolvedVariables) {
      throw new Error(`Unresolved variables: ${unresolvedVariables.join(', ')}`);
    }

    return content;
  }

  validateVariables(variables: Record<string, string>): void {
    for (const requiredVar of this.config.variables) {
      if (!(requiredVar in variables)) {
        throw new Error(`Missing required variable: ${requiredVar}`);
      }
    }
  }

  update(updates: Partial<PromptTemplateConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
      updatedAt: new Date()
    };
  }

  toJSON(): PromptTemplateConfig {
    return { ...this.config };
  }
}

export class PromptTemplateManager {
  private templates = new Map<string, Map<string, PromptTemplate>>();

  saveTemplate(template: PromptTemplate): void {
    const projectId = template.getProjectId();
    let projectTemplates = this.templates.get(projectId);

    if (!projectTemplates) {
      projectTemplates = new Map();
      this.templates.set(projectId, projectTemplates);
    }

    projectTemplates.set(template.getId(), template);
  }

  getTemplate(projectId: string, templateId: string): PromptTemplate | undefined {
    const projectTemplates = this.templates.get(projectId);
    return projectTemplates?.get(templateId);
  }

  getTemplatesForProject(projectId: string): PromptTemplate[] {
    const projectTemplates = this.templates.get(projectId);
    if (!projectTemplates) return [];

    return Array.from(projectTemplates.values());
  }

  renderTemplate(projectId: string, templateId: string, variables: Record<string, string>): string {
    const template = this.getTemplate(projectId, templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Handle parent template inheritance
    let renderedContent = template.getContent();
    
    if (template.getParentTemplateId()) {
      const parentTemplate = this.getTemplate(projectId, template.getParentTemplateId()!);
      if (parentTemplate) {
        const parentContent = parentTemplate.render(variables);
        renderedContent = renderedContent.replace(/\{\{parent\}\}/g, parentContent);
      }
    }

    // Validate all required variables are provided
    template.validateVariables(variables);

    // Create temporary template for rendering
    const tempTemplate = new PromptTemplate({
      ...template.toJSON(),
      content: renderedContent
    });

    return tempTemplate.render(variables);
  }

  deleteTemplate(projectId: string, templateId: string): boolean {
    const projectTemplates = this.templates.get(projectId);
    if (!projectTemplates) return false;

    return projectTemplates.delete(templateId);
  }

  getDefaultTemplate(projectId: string): PromptTemplate | undefined {
    const projectTemplates = this.templates.get(projectId);
    if (!projectTemplates) return undefined;

    return Array.from(projectTemplates.values()).find(t => t.isDefault());
  }
}
```

**Commit**: "feat: implement custom prompt templates"

## Task 3.3: Environment Variables per Project

**Goal**: Allow projects to define environment variables for tool execution

**Test First** (`src/projects/environment-variables.test.ts`):
```typescript
describe('Project environment variables', () => {
  let envManager: ProjectEnvironmentManager;
  let projectId: string;

  beforeEach(() => {
    envManager = new ProjectEnvironmentManager();
    projectId = 'project1';
  });

  it('should store and retrieve environment variables', () => {
    const envVars = {
      API_KEY: 'test-api-key',
      DEBUG: 'true',
      NODE_ENV: 'development'
    };

    envManager.setEnvironmentVariables(projectId, envVars);
    const retrieved = envManager.getEnvironmentVariables(projectId);

    expect(retrieved).toEqual(envVars);
  });

  it('should merge with system environment variables', () => {
    // Mock system environment
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      SYSTEM_VAR: 'system-value',
      OVERRIDE_VAR: 'system-override'
    };

    const projectEnvVars = {
      PROJECT_VAR: 'project-value',
      OVERRIDE_VAR: 'project-override'
    };

    envManager.setEnvironmentVariables(projectId, projectEnvVars);
    const merged = envManager.getMergedEnvironment(projectId);

    expect(merged.SYSTEM_VAR).toBe('system-value');
    expect(merged.PROJECT_VAR).toBe('project-value');
    expect(merged.OVERRIDE_VAR).toBe('project-override'); // Project overrides system

    // Restore original environment
    process.env = originalEnv;
  });

  it('should validate environment variable names', () => {
    expect(() => {
      envManager.setEnvironmentVariables(projectId, {
        '123INVALID': 'value'
      });
    }).toThrow('Invalid environment variable name: 123INVALID');

    expect(() => {
      envManager.setEnvironmentVariables(projectId, {
        'VALID_VAR': 'value'
      });
    }).not.toThrow();
  });

  it('should support environment variable encryption', () => {
    const secretValue = 'super-secret-api-key';
    const envVars = {
      API_KEY: secretValue
    };

    envManager.setEnvironmentVariables(projectId, envVars, { encrypt: ['API_KEY'] });
    
    // Stored value should be encrypted
    const stored = envManager.getStoredEnvironmentVariables(projectId);
    expect(stored.API_KEY).not.toBe(secretValue);
    expect(stored.API_KEY).toMatch(/^encrypted:/);

    // Retrieved value should be decrypted
    const retrieved = envManager.getEnvironmentVariables(projectId);
    expect(retrieved.API_KEY).toBe(secretValue);
  });

  it('should support environment variable inheritance', () => {
    const parentProjectId = 'parent-project';
    const childProjectId = 'child-project';

    // Set parent environment variables
    envManager.setEnvironmentVariables(parentProjectId, {
      PARENT_VAR: 'parent-value',
      SHARED_VAR: 'parent-shared'
    });

    // Set child environment variables with inheritance
    envManager.setEnvironmentVariables(childProjectId, {
      CHILD_VAR: 'child-value',
      SHARED_VAR: 'child-shared'
    }, { inheritFrom: parentProjectId });

    const childEnv = envManager.getEnvironmentVariables(childProjectId);

    expect(childEnv.PARENT_VAR).toBe('parent-value');
    expect(childEnv.CHILD_VAR).toBe('child-value');
    expect(childEnv.SHARED_VAR).toBe('child-shared'); // Child overrides parent
  });
});
```

**Implementation** (`src/projects/environment-variables.ts`):
```typescript
import crypto from 'crypto';

export interface EnvironmentOptions {
  encrypt?: string[];
  inheritFrom?: string;
}

export class ProjectEnvironmentManager {
  private environments = new Map<string, Record<string, string>>();
  private encryptedKeys = new Map<string, Set<string>>();
  private inheritanceChain = new Map<string, string>();
  private encryptionKey: string;

  constructor() {
    // In production, this should come from secure key management
    this.encryptionKey = process.env.LACE_ENCRYPTION_KEY || 'default-dev-key-change-in-production';
  }

  setEnvironmentVariables(
    projectId: string,
    variables: Record<string, string>,
    options: EnvironmentOptions = {}
  ): void {
    // Validate variable names
    for (const key of Object.keys(variables)) {
      if (!this.isValidEnvironmentVariableName(key)) {
        throw new Error(`Invalid environment variable name: ${key}`);
      }
    }

    // Handle encryption
    const processedVariables = { ...variables };
    const encryptedKeySet = new Set<string>();

    if (options.encrypt) {
      for (const key of options.encrypt) {
        if (key in processedVariables) {
          processedVariables[key] = this.encryptValue(processedVariables[key]);
          encryptedKeySet.add(key);
        }
      }
    }

    // Store variables and encryption metadata
    this.environments.set(projectId, processedVariables);
    this.encryptedKeys.set(projectId, encryptedKeySet);

    // Handle inheritance
    if (options.inheritFrom) {
      this.inheritanceChain.set(projectId, options.inheritFrom);
    }
  }

  getEnvironmentVariables(projectId: string): Record<string, string> {
    const variables = this.getStoredEnvironmentVariables(projectId);
    const encryptedKeys = this.encryptedKeys.get(projectId) || new Set();
    const result: Record<string, string> = {};

    // Decrypt encrypted variables
    for (const [key, value] of Object.entries(variables)) {
      if (encryptedKeys.has(key)) {
        result[key] = this.decryptValue(value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  getStoredEnvironmentVariables(projectId: string): Record<string, string> {
    const directVariables = this.environments.get(projectId) || {};
    
    // Handle inheritance
    const parentProjectId = this.inheritanceChain.get(projectId);
    if (parentProjectId) {
      const parentVariables = this.getStoredEnvironmentVariables(parentProjectId);
      return { ...parentVariables, ...directVariables };
    }

    return directVariables;
  }

  getMergedEnvironment(projectId: string): Record<string, string> {
    const systemEnv = process.env;
    const projectEnv = this.getEnvironmentVariables(projectId);
    
    // Project environment overrides system environment
    return { ...systemEnv, ...projectEnv } as Record<string, string>;
  }

  deleteEnvironmentVariable(projectId: string, key: string): void {
    const variables = this.environments.get(projectId);
    if (variables) {
      delete variables[key];
      this.environments.set(projectId, variables);
    }

    const encryptedKeys = this.encryptedKeys.get(projectId);
    if (encryptedKeys) {
      encryptedKeys.delete(key);
    }
  }

  clearEnvironmentVariables(projectId: string): void {
    this.environments.delete(projectId);
    this.encryptedKeys.delete(projectId);
    this.inheritanceChain.delete(projectId);
  }

  private isValidEnvironmentVariableName(name: string): boolean {
    // Environment variable names should start with a letter or underscore
    // and contain only letters, numbers, and underscores
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
  }

  private encryptValue(value: string): string {
    const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `encrypted:${encrypted}`;
  }

  private decryptValue(encryptedValue: string): string {
    if (!encryptedValue.startsWith('encrypted:')) {
      return encryptedValue;
    }

    const encrypted = encryptedValue.substring('encrypted:'.length);
    const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKey);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
```

**Update ToolExecutor to use project environment** (`src/tools/tool-executor.ts`):
```typescript
export class ToolExecutor {
  private envManager: ProjectEnvironmentManager;

  constructor() {
    this.envManager = new ProjectEnvironmentManager();
    // ... other initialization
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context?: ToolContext
  ): Promise<ToolResult> {
    // ... existing validation logic ...

    // Set up environment for tool execution
    const originalEnv = process.env;
    if (context?.projectId) {
      const projectEnv = this.envManager.getMergedEnvironment(context.projectId);
      process.env = projectEnv;
    }

    try {
      const result = await tool.execute(args, context);
      return result;
    } finally {
      // Restore original environment
      process.env = originalEnv;
    }
  }
}
```

**Commit**: "feat: add project-level environment variables"

## Task 3.4: Session/Agent Configuration

**Goal**: Rich configuration for sessions and agents with validation

**Test First** (`src/sessions/session-config.test.ts`):
```typescript
describe('Session configuration', () => {
  let threadManager: ThreadManager;
  let projectId: string;

  beforeEach(() => {
    threadManager = new ThreadManager(':memory:');
    projectId = 'project1';
    
    const project = {
      id: projectId,
      name: 'Test Project',
      description: 'A test project',
      workingDirectory: '/project/path',
      configuration: {
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        maxTokens: 4000
      },
      isArchived: false,
      createdAt: new Date(),
      lastUsedAt: new Date()
    };
    
    threadManager.createProject(project);
  });

  it('should store session configuration in metadata', () => {
    const session = Session.create({
      id: 'session1',
      projectId,
      name: 'Test Session',
      configuration: {
        provider: 'openai',
        model: 'gpt-4',
        maxTokens: 8000,
        temperature: 0.7,
        systemPrompt: 'You are a helpful assistant specialized in TypeScript development.'
      },
      threadManager
    });

    const config = session.getConfiguration();
    expect(config.provider).toBe('openai');
    expect(config.model).toBe('gpt-4');
    expect(config.maxTokens).toBe(8000);
    expect(config.temperature).toBe(0.7);
    expect(config.systemPrompt).toBe('You are a helpful assistant specialized in TypeScript development.');
  });

  it('should validate configuration schema', () => {
    expect(() => {
      Session.create({
        id: 'session1',
        projectId,
        name: 'Test Session',
        configuration: {
          maxTokens: -100, // Invalid: negative
          temperature: 2.5 // Invalid: too high
        },
        threadManager
      });
    }).toThrow('Configuration validation failed');
  });

  it('should support agent-specific configuration', () => {
    const session = Session.create({
      id: 'session1',
      projectId,
      name: 'Test Session',
      threadManager
    });

    const agent = session.createAgent({
      role: 'code-reviewer',
      configuration: {
        model: 'claude-3-haiku',
        temperature: 0.1,
        systemPrompt: 'You are a senior code reviewer. Focus on security and performance.',
        specialInstructions: 'Always suggest improvements for type safety.'
      }
    });

    const agentConfig = agent.getConfiguration();
    expect(agentConfig.role).toBe('code-reviewer');
    expect(agentConfig.model).toBe('claude-3-haiku');
    expect(agentConfig.temperature).toBe(0.1);
    expect(agentConfig.specialInstructions).toBe('Always suggest improvements for type safety.');
  });

  it('should inherit configuration from session to agent', () => {
    const session = Session.create({
      id: 'session1',
      projectId,
      name: 'Test Session',
      configuration: {
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        maxTokens: 4000,
        temperature: 0.5
      },
      threadManager
    });

    const agent = session.createAgent({
      role: 'assistant',
      configuration: {
        temperature: 0.8 // Override session temperature
      }
    });

    const effectiveConfig = agent.getEffectiveConfiguration();
    expect(effectiveConfig.provider).toBe('anthropic'); // From session
    expect(effectiveConfig.model).toBe('claude-3-sonnet'); // From session
    expect(effectiveConfig.maxTokens).toBe(4000); // From session
    expect(effectiveConfig.temperature).toBe(0.8); // Overridden by agent
  });

  it('should support configuration presets', () => {
    const presetManager = new ConfigurationPresetManager();
    
    presetManager.savePreset('code-review', {
      model: 'claude-3-sonnet',
      temperature: 0.2,
      maxTokens: 8000,
      systemPrompt: 'You are a senior software engineer conducting code reviews.',
      tools: ['file-read', 'file-write', 'bash'],
      toolPolicies: {
        'file-write': 'require-approval',
        'bash': 'require-approval'
      }
    });

    const session = Session.create({
      id: 'session1',
      projectId,
      name: 'Code Review Session',
      configurationPreset: 'code-review',
      threadManager
    });

    const config = session.getEffectiveConfiguration();
    expect(config.model).toBe('claude-3-sonnet');
    expect(config.temperature).toBe(0.2);
    expect(config.systemPrompt).toBe('You are a senior software engineer conducting code reviews.');
  });
});
```

**Implementation** (`src/sessions/session-config.ts`):
```typescript
import { z } from 'zod';

export const SessionConfigurationSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'lmstudio', 'ollama']).optional(),
  model: z.string().optional(),
  maxTokens: z.number().positive().max(100000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  systemPrompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  toolPolicies: z.record(z.enum(['allow', 'require-approval', 'deny'])).optional(),
  workingDirectory: z.string().optional(),
  environmentVariables: z.record(z.string()).optional(),
  promptTemplate: z.string().optional(),
  specialInstructions: z.string().optional()
});

export const AgentConfigurationSchema = SessionConfigurationSchema.extend({
  role: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  restrictions: z.array(z.string()).optional(),
  memorySize: z.number().positive().optional(),
  conversationHistory: z.number().positive().optional()
});

export type SessionConfiguration = z.infer<typeof SessionConfigurationSchema>;
export type AgentConfiguration = z.infer<typeof AgentConfigurationSchema>;

export interface ConfigurationPreset {
  id: string;
  name: string;
  description: string;
  configuration: SessionConfiguration;
  isDefault?: boolean;
}

export class ConfigurationPresetManager {
  private presets = new Map<string, ConfigurationPreset>();

  savePreset(id: string, config: Partial<SessionConfiguration>, metadata?: {
    name?: string;
    description?: string;
    isDefault?: boolean;
  }): void {
    const preset: ConfigurationPreset = {
      id,
      name: metadata?.name || id,
      description: metadata?.description || '',
      configuration: SessionConfigurationSchema.parse(config),
      isDefault: metadata?.isDefault || false
    };

    this.presets.set(id, preset);
  }

  getPreset(id: string): ConfigurationPreset | undefined {
    return this.presets.get(id);
  }

  getPresets(): ConfigurationPreset[] {
    return Array.from(this.presets.values());
  }

  getDefaultPreset(): ConfigurationPreset | undefined {
    return Array.from(this.presets.values()).find(p => p.isDefault);
  }

  deletePreset(id: string): boolean {
    return this.presets.delete(id);
  }
}

export class ConfigurationValidator {
  static validateSessionConfiguration(config: unknown): SessionConfiguration {
    try {
      return SessionConfigurationSchema.parse(config);
    } catch (error) {
      throw new Error(`Configuration validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  static validateAgentConfiguration(config: unknown): AgentConfiguration {
    try {
      return AgentConfigurationSchema.parse(config);
    } catch (error) {
      throw new Error(`Agent configuration validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  static mergeConfigurations(
    base: SessionConfiguration,
    override: Partial<SessionConfiguration>
  ): SessionConfiguration {
    const merged = { ...base, ...override };
    
    // Special handling for nested objects
    if (base.toolPolicies || override.toolPolicies) {
      merged.toolPolicies = { ...base.toolPolicies, ...override.toolPolicies };
    }
    
    if (base.environmentVariables || override.environmentVariables) {
      merged.environmentVariables = { ...base.environmentVariables, ...override.environmentVariables };
    }
    
    return SessionConfigurationSchema.parse(merged);
  }
}
```

**Update Session class** (`src/sessions/session.ts`):
```typescript
export interface SessionConfig {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  workingDirectory?: string;
  configuration?: SessionConfiguration;
  configurationPreset?: string;
  threadManager: ThreadManager;
}

export class Session {
  // ... existing properties ...
  private presetManager: ConfigurationPresetManager;

  constructor(sessionData: SessionData, threadManager: ThreadManager) {
    this.sessionData = sessionData;
    this.threadManager = threadManager;
    this.presetManager = new ConfigurationPresetManager();
  }

  static create(config: SessionConfig): Session {
    let configuration = config.configuration || {};
    
    // Apply preset if specified
    if (config.configurationPreset) {
      const presetManager = new ConfigurationPresetManager();
      const preset = presetManager.getPreset(config.configurationPreset);
      if (preset) {
        configuration = ConfigurationValidator.mergeConfigurations(
          preset.configuration,
          configuration
        );
      }
    }

    // Validate configuration
    const validatedConfig = ConfigurationValidator.validateSessionConfiguration(configuration);

    const sessionData: SessionData = {
      id: config.id,
      projectId: config.projectId,
      name: config.name,
      description: config.description || '',
      configuration: {
        ...validatedConfig,
        ...(config.workingDirectory && { workingDirectoryOverride: config.workingDirectory })
      },
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    config.threadManager.createSession(sessionData);
    return new Session(sessionData, config.threadManager);
  }

  getEffectiveConfiguration(): SessionConfiguration {
    const project = this.threadManager.getProject(this.sessionData.projectId);
    const projectConfig = project?.configuration || {};
    const sessionConfig = this.sessionData.configuration || {};
    
    return ConfigurationValidator.mergeConfigurations(
      projectConfig as SessionConfiguration,
      sessionConfig as SessionConfiguration
    );
  }

  createAgent(config?: {
    role?: string;
    configuration?: Partial<AgentConfiguration>;
  }): Agent {
    const agentConfig = config?.configuration || {};
    
    // Validate agent configuration
    const validatedConfig = ConfigurationValidator.validateAgentConfiguration({
      ...agentConfig,
      role: config?.role
    });

    const threadId = this.threadManager.createThread(this.sessionData.id, this.sessionData.projectId);
    
    const agent = new Agent({
      threadId,
      sessionId: this.sessionData.id,
      projectId: this.sessionData.projectId,
      configuration: validatedConfig,
      threadManager: this.threadManager
    });

    return agent;
  }
}
```

**Update Agent class** (`src/agents/agent.ts`):
```typescript
export interface AgentConfig {
  threadId: string;
  sessionId?: string;
  projectId?: string;
  configuration?: AgentConfiguration;
  threadManager: ThreadManager;
}

export class Agent {
  // ... existing properties ...
  private agentConfiguration?: AgentConfiguration;

  constructor(config: AgentConfig) {
    this.threadId = config.threadId;
    this.sessionId = config.sessionId;
    this.projectId = config.projectId;
    this.agentConfiguration = config.configuration;
    this.threadManager = config.threadManager;
  }

  getConfiguration(): AgentConfiguration {
    return this.agentConfiguration || {};
  }

  getEffectiveConfiguration(): AgentConfiguration {
    let baseConfig: SessionConfiguration = {};
    
    // Start with project configuration
    if (this.projectId) {
      const project = this.threadManager.getProject(this.projectId);
      baseConfig = project?.configuration || {};
    }
    
    // Layer session configuration
    if (this.sessionId) {
      const session = Session.load(this.sessionId, this.threadManager);
      if (session) {
        baseConfig = ConfigurationValidator.mergeConfigurations(
          baseConfig,
          session.getConfiguration()
        );
      }
    }
    
    // Layer agent configuration
    const agentConfig = this.agentConfiguration || {};
    
    return ConfigurationValidator.mergeConfigurations(
      baseConfig,
      agentConfig
    ) as AgentConfiguration;
  }

  updateConfiguration(updates: Partial<AgentConfiguration>): void {
    const currentConfig = this.agentConfiguration || {};
    const newConfig = ConfigurationValidator.validateAgentConfiguration({
      ...currentConfig,
      ...updates
    });
    
    this.agentConfiguration = newConfig;
    
    // Update thread metadata to persist agent configuration
    this.threadManager.updateThreadMetadata(this.threadId, {
      agentConfiguration: newConfig
    });
  }

  getRole(): string {
    return this.agentConfiguration?.role || 'assistant';
  }

  getCapabilities(): string[] {
    return this.agentConfiguration?.capabilities || [];
  }

  getRestrictions(): string[] {
    return this.agentConfiguration?.restrictions || [];
  }
}
```

**Commit**: "feat: add rich configuration for sessions and agents"

## Task 3.5: Project Settings UI

**Goal**: Add comprehensive UI for managing project settings

**Test First** (`packages/web/components/ProjectSettings.test.tsx`):
```typescript
describe('ProjectSettings', () => {
  const mockProject = {
    id: 'project1',
    name: 'Test Project',
    description: 'A test project',
    workingDirectory: '/project/path',
    configuration: {
      provider: 'anthropic',
      model: 'claude-3-sonnet',
      maxTokens: 4000,
      tools: ['file-read', 'file-write', 'bash'],
      toolPolicies: {
        'file-write': 'require-approval',
        'bash': 'require-approval'
      }
    },
    isArchived: false
  };

  it('should render project settings form', () => {
    render(<ProjectSettings project={mockProject} onSave={vi.fn()} />);
    
    expect(screen.getByDisplayValue('Test Project')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A test project')).toBeInTheDocument();
    expect(screen.getByDisplayValue('/project/path')).toBeInTheDocument();
    expect(screen.getByDisplayValue('anthropic')).toBeInTheDocument();
    expect(screen.getByDisplayValue('claude-3-sonnet')).toBeInTheDocument();
  });

  it('should handle configuration updates', async () => {
    const onSave = vi.fn();
    render(<ProjectSettings project={mockProject} onSave={onSave} />);
    
    const modelSelect = screen.getByDisplayValue('claude-3-sonnet');
    await userEvent.selectOptions(modelSelect, 'claude-3-haiku');
    
    const maxTokensInput = screen.getByDisplayValue('4000');
    await userEvent.clear(maxTokensInput);
    await userEvent.type(maxTokensInput, '8000');
    
    const saveButton = screen.getByText('Save Settings');
    await userEvent.click(saveButton);
    
    expect(onSave).toHaveBeenCalledWith({
      ...mockProject,
      configuration: {
        ...mockProject.configuration,
        model: 'claude-3-haiku',
        maxTokens: 8000
      }
    });
  });

  it('should handle tool policy changes', async () => {
    const onSave = vi.fn();
    render(<ProjectSettings project={mockProject} onSave={onSave} />);
    
    const bashPolicySelect = screen.getByTestId('tool-policy-bash');
    await userEvent.selectOptions(bashPolicySelect, 'allow');
    
    const saveButton = screen.getByText('Save Settings');
    await userEvent.click(saveButton);
    
    expect(onSave).toHaveBeenCalledWith({
      ...mockProject,
      configuration: {
        ...mockProject.configuration,
        toolPolicies: {
          'file-write': 'require-approval',
          'bash': 'allow'
        }
      }
    });
  });

  it('should validate form inputs', async () => {
    const onSave = vi.fn();
    render(<ProjectSettings project={mockProject} onSave={onSave} />);
    
    const nameInput = screen.getByDisplayValue('Test Project');
    await userEvent.clear(nameInput);
    
    const saveButton = screen.getByText('Save Settings');
    await userEvent.click(saveButton);
    
    expect(screen.getByText('Project name is required')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
```

**Implementation** (`packages/web/components/ProjectSettings.tsx`):
```typescript
import { useState, useEffect } from 'react';
import { z } from 'zod';

interface Project {
  id: string;
  name: string;
  description: string;
  workingDirectory: string;
  configuration: {
    provider?: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
    tools?: string[];
    toolPolicies?: Record<string, string>;
    environmentVariables?: Record<string, string>;
  };
  isArchived: boolean;
}

interface ProjectSettingsProps {
  project: Project;
  onSave: (project: Project) => void;
  onCancel?: () => void;
}

const ProjectSettingsSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  description: z.string(),
  workingDirectory: z.string().min(1, 'Working directory is required'),
  configuration: z.object({
    provider: z.enum(['anthropic', 'openai', 'lmstudio', 'ollama']).optional(),
    model: z.string().optional(),
    maxTokens: z.number().positive().max(100000).optional(),
    temperature: z.number().min(0).max(2).optional(),
    tools: z.array(z.string()).optional(),
    toolPolicies: z.record(z.enum(['allow', 'require-approval', 'deny'])).optional(),
    environmentVariables: z.record(z.string()).optional()
  })
});

export function ProjectSettings({ project, onSave, onCancel }: ProjectSettingsProps) {
  const [formData, setFormData] = useState(project);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<'general' | 'configuration' | 'tools' | 'environment'>('general');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const validatedData = ProjectSettingsSchema.parse(formData);
      setErrors({});
      onSave(validatedData);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {};
        error.errors.forEach(err => {
          const path = err.path.join('.');
          fieldErrors[path] = err.message;
        });
        setErrors(fieldErrors);
      }
    }
  };

  const updateField = (path: string, value: any) => {
    setFormData(prev => {
      const updated = { ...prev };
      const keys = path.split('.');
      let current = updated;
      
      for (let i = 0; i < keys.length - 1; i++) {
        current = current[keys[i]];
      }
      
      current[keys[keys.length - 1]] = value;
      return updated;
    });
  };

  const addEnvironmentVariable = () => {
    const key = prompt('Environment variable name:');
    const value = prompt('Environment variable value:');
    
    if (key && value) {
      updateField('configuration.environmentVariables', {
        ...formData.configuration.environmentVariables,
        [key]: value
      });
    }
  };

  const removeEnvironmentVariable = (key: string) => {
    const envVars = { ...formData.configuration.environmentVariables };
    delete envVars[key];
    updateField('configuration.environmentVariables', envVars);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow">
      <h1 className="text-2xl font-bold mb-6">Project Settings</h1>
      
      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex space-x-8">
          {[
            { id: 'general', label: 'General' },
            { id: 'configuration', label: 'AI Configuration' },
            { id: 'tools', label: 'Tools & Policies' },
            { id: 'environment', label: 'Environment Variables' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* General Settings */}
        {activeTab === 'general' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Project Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => updateField('name', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => updateField('description', e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Working Directory
              </label>
              <input
                type="text"
                value={formData.workingDirectory}
                onChange={(e) => updateField('workingDirectory', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {errors.workingDirectory && <p className="text-red-500 text-sm mt-1">{errors.workingDirectory}</p>}
            </div>
          </div>
        )}

        {/* AI Configuration */}
        {activeTab === 'configuration' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Provider
                </label>
                <select
                  value={formData.configuration.provider || ''}
                  onChange={(e) => updateField('configuration.provider', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select Provider</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                  <option value="lmstudio">LM Studio</option>
                  <option value="ollama">Ollama</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Model
                </label>
                <select
                  value={formData.configuration.model || ''}
                  onChange={(e) => updateField('configuration.model', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select Model</option>
                  {formData.configuration.provider === 'anthropic' && (
                    <>
                      <option value="claude-3-sonnet">Claude 3 Sonnet</option>
                      <option value="claude-3-haiku">Claude 3 Haiku</option>
                      <option value="claude-3-opus">Claude 3 Opus</option>
                    </>
                  )}
                  {formData.configuration.provider === 'openai' && (
                    <>
                      <option value="gpt-4">GPT-4</option>
                      <option value="gpt-4-turbo">GPT-4 Turbo</option>
                      <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Tokens
                </label>
                <input
                  type="number"
                  value={formData.configuration.maxTokens || ''}
                  onChange={(e) => updateField('configuration.maxTokens', parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Temperature
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={formData.configuration.temperature || ''}
                  onChange={(e) => updateField('configuration.temperature', parseFloat(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* Tools & Policies */}
        {activeTab === 'tools' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Available Tools
              </label>
              <div className="grid grid-cols-3 gap-2">
                {['file-read', 'file-write', 'file-edit', 'file-list', 'bash', 'url-fetch', 'search'].map(tool => (
                  <label key={tool} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.configuration.tools?.includes(tool) || false}
                      onChange={(e) => {
                        const tools = formData.configuration.tools || [];
                        if (e.target.checked) {
                          updateField('configuration.tools', [...tools, tool]);
                        } else {
                          updateField('configuration.tools', tools.filter(t => t !== tool));
                        }
                      }}
                      className="mr-2"
                    />
                    {tool}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tool Policies
              </label>
              <div className="space-y-2">
                {(formData.configuration.tools || []).map(tool => (
                  <div key={tool} className="flex items-center justify-between">
                    <span className="text-sm">{tool}</span>
                    <select
                      data-testid={`tool-policy-${tool}`}
                      value={formData.configuration.toolPolicies?.[tool] || 'require-approval'}
                      onChange={(e) => {
                        const policies = formData.configuration.toolPolicies || {};
                        updateField('configuration.toolPolicies', {
                          ...policies,
                          [tool]: e.target.value
                        });
                      }}
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      <option value="allow">Allow</option>
                      <option value="require-approval">Require Approval</option>
                      <option value="deny">Deny</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Environment Variables */}
        {activeTab === 'environment' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">
                Environment Variables
              </label>
              <button
                type="button"
                onClick={addEnvironmentVariable}
                className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Add Variable
              </button>
            </div>

            <div className="space-y-2">
              {Object.entries(formData.configuration.environmentVariables || {}).map(([key, value]) => (
                <div key={key} className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={key}
                    readOnly
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-gray-50"
                  />
                  <span>=</span>
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => {
                      const envVars = { ...formData.configuration.environmentVariables };
                      envVars[key] = e.target.value;
                      updateField('configuration.environmentVariables', envVars);
                    }}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
                  />
                  <button
                    type="button"
                    onClick={() => removeEnvironmentVariable(key)}
                    className="px-2 py-1 text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Form Actions */}
        <div className="flex justify-end space-x-3 pt-6 border-t">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
          >
            Save Settings
          </button>
        </div>
      </form>
    </div>
  );
}
```

**Add to main page** (`packages/web/app/page.tsx`):
```typescript
// Add settings modal to main page
const [showSettings, setShowSettings] = useState(false);

const handleSaveProject = async (updatedProject: Project) => {
  try {
    const response = await fetch(`/api/projects/${updatedProject.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedProject)
    });

    if (response.ok) {
      setProjects(prev => prev.map(p => p.id === updatedProject.id ? updatedProject : p));
      setShowSettings(false);
    }
  } catch (error) {
    console.error('Failed to save project:', error);
  }
};

// Add settings button to project selector
<button
  onClick={() => setShowSettings(true)}
  className="text-gray-500 hover:text-gray-700"
>
  ⚙️ Settings
</button>

// Add settings modal
{showSettings && selectedProject && (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
      <ProjectSettings
        project={projects.find(p => p.id === selectedProject)!}
        onSave={handleSaveProject}
        onCancel={() => setShowSettings(false)}
      />
    </div>
  </div>
)}
```

**Commit**: "feat: add comprehensive project settings UI"

## Phase 3 Summary

Phase 3 adds advanced features for production use:

1. **Token Budget Management**: Per-project token tracking with limits and reset periods
2. **Custom Prompt Templates**: Project-specific prompt templates with variable substitution
3. **Environment Variables**: Secure, encrypted project-level environment variables
4. **Rich Configuration**: Comprehensive session and agent configuration with validation
5. **Project Settings UI**: Complete web interface for managing all project settings

The system now provides:
- Token usage monitoring and budget enforcement
- Flexible prompt templating system
- Secure environment variable management
- Granular configuration at project, session, and agent levels
- Professional UI for all settings management
- Complete validation and error handling

This completes the full multi-project architecture with enterprise-grade features.