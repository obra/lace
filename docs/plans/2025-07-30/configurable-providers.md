# Configurable Providers Implementation Plan

## Overview

This plan implements a flexible provider system with three key components: provider catalogs (available models/metadata), provider instances (connection configs), and agent-level model selection. The system uses Catwalk's provider data as a baseline catalog while supporting user extensions and multiple instance configurations.

## Key Concepts for the Engineer

### Three-Tier Architecture
1. **Provider Catalogs**: Available models and metadata (shipped Catwalk data + user extensions)
2. **Provider Instances**: Connection configurations (credentials, endpoints, timeouts)
3. **Agent/Session Model Selection**: Users pick specific models from available catalogs when creating agents

### Current System
- Providers are created based on environment variables
- Only one instance per provider type is possible
- Limited model metadata
- No UI for configuration

### New System
- Rich provider/model catalogs with costs and capabilities
- Multiple instances of each provider type with custom configurations
- User-extensible catalogs for local/custom providers
- Model selection happens at agent creation time
- Web UI for catalog browsing and instance management

## Architecture Guidelines

### TypeScript Rules
- **NEVER use `any` type** - use `unknown` and type guards instead
- All types must be explicit
- Use Zod schemas for runtime validation
- Interfaces for data shapes, not classes

### Testing Rules
- **Write tests FIRST** (TDD)
- **NEVER mock the functionality you're testing**
- Use real implementations, not mocks
- Test files live next to source files (e.g., `provider-config.ts` → `provider-config.test.ts`)
- Run tests with `npm test` (watch mode) or `npm run test:run` (single run)

### Code Style
- YAGNI - only implement what's needed
- DRY - no code duplication
- Small, focused functions
- Commit after each small task

## Implementation Tasks

### Task 1: Create Provider Catalog and Instance Types

**Files to create:**
- `src/providers/catalog/catalog-types.ts`
- `src/providers/catalog/catalog-types.test.ts`

**What to implement:**

```typescript
// src/providers/catalog/catalog-types.ts
// ABOUTME: Types and schemas for provider catalogs and instances
// ABOUTME: Defines Catwalk catalog format and user instance configuration

import { z } from 'zod';

// Catwalk catalog model schema
export const CatalogModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  cost_per_1m_in: z.number(),
  cost_per_1m_out: z.number(),
  cost_per_1m_in_cached: z.number().optional(),
  cost_per_1m_out_cached: z.number().optional(),
  context_window: z.number(),
  default_max_tokens: z.number(),
  can_reason: z.boolean().optional(),
  has_reasoning_effort: z.boolean().optional(),
  supports_attachments: z.boolean().optional()
});

// Catwalk catalog provider schema
export const CatalogProviderSchema = z.object({
  name: z.string(),
  id: z.string(),
  type: z.string(),
  api_key: z.string().optional(),
  api_endpoint: z.string().optional(),
  default_large_model_id: z.string(),
  default_small_model_id: z.string(),
  models: z.array(CatalogModelSchema)
});

// User provider instance schema (connection config only)
export const ProviderInstanceSchema = z.object({
  displayName: z.string().min(1),
  catalogProviderId: z.string().min(1),
  endpoint: z.string().url().optional(),
  timeout: z.number().int().positive().optional(),
  retryPolicy: z.string().optional()
});

// User instances configuration file
export const ProviderInstancesConfigSchema = z.object({
  version: z.literal('1.0'),
  instances: z.record(ProviderInstanceSchema)
});

// Credential schema (unchanged)
export const CredentialSchema = z.object({
  apiKey: z.string().min(1),
  additionalAuth: z.record(z.unknown()).optional()
});

export type CatalogModel = z.infer<typeof CatalogModelSchema>;
export type CatalogProvider = z.infer<typeof CatalogProviderSchema>;
export type ProviderInstance = z.infer<typeof ProviderInstanceSchema>;
export type ProviderInstancesConfig = z.infer<typeof ProviderInstancesConfigSchema>;
export type Credential = z.infer<typeof CredentialSchema>;
```

**How to test:**
```typescript
// src/providers/catalog/catalog-types.test.ts
import { describe, it, expect } from 'vitest';
import { CatalogProviderSchema, ProviderInstanceSchema } from './catalog-types';

describe('CatalogProviderSchema', () => {
  it('validates Catwalk provider format', () => {
    const valid = {
      name: 'OpenAI',
      id: 'openai',
      type: 'openai',
      default_large_model_id: 'gpt-4o',
      default_small_model_id: 'gpt-4o-mini',
      models: [{
        id: 'gpt-4o',
        name: 'GPT-4o',
        cost_per_1m_in: 2.5,
        cost_per_1m_out: 10.0,
        context_window: 128000,
        default_max_tokens: 4096
      }]
    };
    
    const result = CatalogProviderSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });
});

describe('ProviderInstanceSchema', () => {
  it('validates provider instance connection config', () => {
    const valid = {
      displayName: 'OpenAI Production',
      catalogProviderId: 'openai',
      timeout: 30000
    };
    
    const result = ProviderInstanceSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });
});
```

**Commit message:** "feat: add provider catalog and instance types with Catwalk schema support"

### Task 2: Create Provider Catalog Manager

**Files to create:**
- `src/providers/catalog/catalog-manager.ts`
- `src/providers/catalog/catalog-manager.test.ts`
- Copy Catwalk JSON files to `src/providers/catalog/data/`

**What to implement:**

```typescript
// src/providers/catalog/catalog-manager.ts
// ABOUTME: Manages provider catalogs from shipped data and user extensions
// ABOUTME: Provides unified interface for browsing available providers and models

import fs from 'fs';
import path from 'path';
import { getLaceDir } from '~/config/lace-dir';
import { CatalogProvider, CatalogProviderSchema, CatalogModel } from './catalog-types';

export class ProviderCatalogManager {
  private shippedCatalogDir: string;
  private userCatalogDir: string;
  private catalogCache: Map<string, CatalogProvider> = new Map();

  constructor() {
    this.shippedCatalogDir = path.join(__dirname, 'data');
    this.userCatalogDir = path.join(getLaceDir(), 'user-catalog');
  }

  async loadCatalogs(): Promise<void> {
    this.catalogCache.clear();
    
    // Load shipped catalogs
    await this.loadCatalogDirectory(this.shippedCatalogDir);
    
    // Load user catalog extensions (override shipped if same ID)
    if (await this.directoryExists(this.userCatalogDir)) {
      await this.loadCatalogDirectory(this.userCatalogDir);
    }
  }

  private async loadCatalogDirectory(dirPath: string): Promise<void> {
    const files = await fs.promises.readdir(dirPath);
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const filePath = path.join(dirPath, file);
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const provider = CatalogProviderSchema.parse(JSON.parse(content));
          this.catalogCache.set(provider.id, provider);
        } catch (error) {
          console.warn(`Failed to load catalog file ${file}:`, error);
        }
      }
    }
  }

  getAvailableProviders(): CatalogProvider[] {
    return Array.from(this.catalogCache.values());
  }

  getProvider(providerId: string): CatalogProvider | null {
    return this.catalogCache.get(providerId) || null;
  }

  getProviderModels(providerId: string): CatalogModel[] {
    const provider = this.getProvider(providerId);
    return provider?.models || [];
  }

  getModel(providerId: string, modelId: string): CatalogModel | null {
    const models = this.getProviderModels(providerId);
    return models.find(m => m.id === modelId) || null;
  }

  async saveUserCatalog(providerId: string, provider: CatalogProvider): Promise<void> {
    await fs.promises.mkdir(this.userCatalogDir, { recursive: true });
    const filePath = path.join(this.userCatalogDir, `${providerId}.json`);
    await fs.promises.writeFile(
      filePath,
      JSON.stringify(provider, null, 2)
    );
    
    // Update cache
    this.catalogCache.set(provider.id, provider);
  }

  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
}
```

**How to test:**
```typescript
// src/providers/provider-config-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProviderConfigManager } from './provider-config-manager';
import { tempLaceDir } from '~/test-utils/temp-lace-dir';

describe('ProviderConfigManager', () => {
  let manager: ProviderConfigManager;
  let cleanup: () => void;

  beforeEach(() => {
    const { cleanup: cleanupFn } = tempLaceDir();
    cleanup = cleanupFn;
    manager = new ProviderConfigManager();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns empty config when file does not exist', async () => {
    const config = await manager.loadConfig();
    expect(config.version).toBe('1.0');
    expect(config.providers).toEqual({});
  });

  it('saves and loads config', async () => {
    const config = {
      version: '1.0' as const,
      providers: {
        'openai-prod': {
          name: 'OpenAI Production',
          type: 'openai-api' as const,
          config: { baseUrl: 'https://api.openai.com/v1' }
        }
      }
    };

    await manager.saveConfig(config);
    const loaded = await manager.loadConfig();
    expect(loaded).toEqual(config);
  });
});
```

**Commit message:** "feat: add provider catalog manager with Catwalk data support"

### Task 3: Create Provider Instance Manager

**Files to create:**
- `src/providers/instance/instance-manager.ts`
- `src/providers/instance/instance-manager.test.ts`

**What to implement:**

```typescript
// src/providers/instance/instance-manager.ts
// ABOUTME: Manages user provider instances and credential storage
// ABOUTME: Handles provider-instances.json and credentials directory

import fs from 'fs';
import path from 'path';
import { getLaceDir } from '~/config/lace-dir';
import { ProviderInstancesConfig, ProviderInstancesConfigSchema, ProviderInstance, Credential, CredentialSchema } from '../catalog/catalog-types';

export class ProviderInstanceManager {
  private configPath: string;
  private credentialsDir: string;

  constructor() {
    const laceDir = getLaceDir();
    this.configPath = path.join(laceDir, 'provider-instances.json');
    this.credentialsDir = path.join(laceDir, 'credentials');
  }

  async loadInstances(): Promise<ProviderInstancesConfig> {
    try {
      const content = await fs.promises.readFile(this.configPath, 'utf-8');
      return ProviderInstancesConfigSchema.parse(JSON.parse(content));
    } catch (error) {
      return {
        version: '1.0',
        instances: {}
      };
    }
  }

  async saveInstances(config: ProviderInstancesConfig): Promise<void> {
    await fs.promises.writeFile(
      this.configPath,
      JSON.stringify(config, null, 2)
    );
  }

  async loadCredential(instanceId: string): Promise<Credential | null> {
    try {
      const credPath = path.join(this.credentialsDir, `${instanceId}.json`);
      const content = await fs.promises.readFile(credPath, 'utf-8');
      return CredentialSchema.parse(JSON.parse(content));
    } catch (error) {
      return null;
    }
  }

  async saveCredential(instanceId: string, credential: Credential): Promise<void> {
    await fs.promises.mkdir(this.credentialsDir, { recursive: true });
    const credPath = path.join(this.credentialsDir, `${instanceId}.json`);
    await fs.promises.writeFile(
      credPath,
      JSON.stringify(credential, null, 2),
      { mode: 0o600 }
    );
  }

  async deleteInstance(instanceId: string): Promise<void> {
    // Remove from instances config
    const config = await this.loadInstances();
    delete config.instances[instanceId];
    await this.saveInstances(config);

    // Remove credential file
    try {
      const credPath = path.join(this.credentialsDir, `${instanceId}.json`);
      await fs.promises.unlink(credPath);
    } catch {
      // Ignore if credential file doesn't exist
    }
  }
}
```

**Commit message:** "feat: add provider instance manager for connection configuration"

### Task 3: Create Provider Factory Updates

**Files to modify:**
- `src/providers/registry.ts`
- `src/providers/registry.test.ts`

**Current code to understand:**
The registry currently creates providers from environment variables. Look at:
- How `ProviderRegistry.getAllProviders()` works
- How providers are instantiated

**What to add:**

```typescript
// Add to src/providers/registry.ts

import { ProviderConfigManager } from './provider-config-manager';

export class ProviderRegistry {
  private configManager = new ProviderConfigManager();

  // Add new method to load configured providers
  async loadConfiguredProviders(): Promise<void> {
    const config = await this.configManager.loadConfig();
    
    for (const [id, instance] of Object.entries(config.providers)) {
      const credential = await this.configManager.loadCredential(id);
      if (!credential) continue;

      // Create provider based on type
      switch (instance.type) {
        case 'anthropic-api':
          // Create AnthropicProvider with custom config
          this.registerProvider(id, new AnthropicProvider({
            apiKey: credential.apiKey,
            baseUrl: instance.config.baseUrl as string
          }));
          break;
        case 'openai-api':
          // Create OpenAIProvider with custom config
          this.registerProvider(id, new OpenAIProvider({
            apiKey: credential.apiKey,
            baseUrl: instance.config.baseUrl as string
          }));
          break;
      }
    }
  }

  // Add method to register a provider instance
  private registerProvider(id: string, provider: BaseProvider): void {
    // Implementation depends on current registry structure
  }
}
```

**How to test:**
Write tests that create a config file, then verify providers are loaded correctly.

**Commit message:** "feat: add configured provider loading to registry"

### Task 4: Add Migration from Environment Variables

**Files to create:**
- `src/providers/provider-migration.ts`
- `src/providers/provider-migration.test.ts`

**What to implement:**

```typescript
// src/providers/provider-migration.ts
// ABOUTME: Migrates existing environment variable providers to new config system
// ABOUTME: Runs on first startup to preserve existing provider setup

import { ProviderConfigManager } from './provider-config-manager';
import { ProvidersConfig } from './provider-config';

export class ProviderMigration {
  constructor(private configManager: ProviderConfigManager) {}

  async migrateFromEnv(): Promise<boolean> {
    const config = await this.configManager.loadConfig();
    
    // Don't migrate if already has providers
    if (Object.keys(config.providers).length > 0) {
      return false;
    }

    let migrated = false;

    // Check for Anthropic
    if (process.env.ANTHROPIC_API_KEY) {
      config.providers['anthropic-default'] = {
        name: 'Anthropic (Migrated)',
        type: 'anthropic-api',
        config: {
          baseUrl: 'https://api.anthropic.com/v1'
        }
      };

      await this.configManager.saveCredential('anthropic-default', {
        apiKey: process.env.ANTHROPIC_API_KEY
      });

      migrated = true;
    }

    // Check for OpenAI
    if (process.env.OPENAI_API_KEY) {
      config.providers['openai-default'] = {
        name: 'OpenAI (Migrated)',
        type: 'openai-api',
        config: {
          baseUrl: 'https://api.openai.com/v1'
        }
      };

      await this.configManager.saveCredential('openai-default', {
        apiKey: process.env.OPENAI_API_KEY
      });

      migrated = true;
    }

    if (migrated) {
      await this.configManager.saveConfig(config);
    }

    return migrated;
  }
}
```

**How to test:**
Set environment variables in test, run migration, verify files created.

**Commit message:** "feat: add environment variable migration"

### Task 5: Create Web API Endpoints

**Files to create:**
- `src/interfaces/web/app/api/providers/route.ts`
- `src/interfaces/web/app/api/providers/[id]/route.ts`
- `src/interfaces/web/app/api/providers/[id]/test/route.ts`

**What to implement:**

```typescript
// src/interfaces/web/app/api/providers/route.ts
// List providers and create new ones

import { NextRequest, NextResponse } from 'next/server';
import { ProviderConfigManager } from '~/providers/provider-config-manager';
import { z } from 'zod';

const CreateProviderSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  type: z.enum(['anthropic-api', 'openai-api']),
  config: z.record(z.unknown()),
  credential: z.object({
    apiKey: z.string().min(1)
  })
});

export async function GET() {
  const manager = new ProviderConfigManager();
  const config = await manager.loadConfig();
  
  // Never return credentials
  const providers = Object.entries(config.providers).map(([id, instance]) => ({
    id,
    ...instance,
    hasCredential: !!(await manager.loadCredential(id))
  }));

  return NextResponse.json({ providers });
}

export async function POST(request: NextRequest) {
  const body = await request.json() as unknown;
  const parsed = CreateProviderSchema.safeParse(body);
  
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.message },
      { status: 400 }
    );
  }

  const manager = new ProviderConfigManager();
  const config = await manager.loadConfig();
  
  // Add provider
  config.providers[parsed.data.id] = {
    name: parsed.data.name,
    type: parsed.data.type,
    config: parsed.data.config
  };

  // Save credential separately
  await manager.saveCredential(parsed.data.id, {
    apiKey: parsed.data.credential.apiKey
  });

  await manager.saveConfig(config);

  return NextResponse.json({ success: true });
}
```

**API Testing approach:**
Use Playwright for E2E tests or create integration tests that start the Next.js server.

**Commit message:** "feat: add provider management API endpoints"

### Task 6: Create Web UI Components

**Files to create:**
- `src/interfaces/web/components/providers/provider-list.tsx`
- `src/interfaces/web/components/providers/provider-form.tsx`
- `src/interfaces/web/app/providers/page.tsx`

**What to implement:**

```typescript
// src/interfaces/web/components/providers/provider-list.tsx
// List of configured providers with actions

import { useEffect, useState } from 'react';

interface Provider {
  id: string;
  name: string;
  type: string;
  hasCredential: boolean;
}

export function ProviderList() {
  const [providers, setProviders] = useState<Provider[]>([]);

  useEffect(() => {
    fetch('/api/providers')
      .then(res => res.json())
      .then(data => setProviders(data.providers));
  }, []);

  return (
    <div>
      <h2>Configured Providers</h2>
      <ul>
        {providers.map(provider => (
          <li key={provider.id}>
            {provider.name} ({provider.type})
            {!provider.hasCredential && <span> - No credential</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

**UI Testing approach:**
- Unit tests with Vitest for components
- E2E tests with Playwright for full flow

**Commit message:** "feat: add provider management UI"

### Task 7: Add Provider Selection to Sessions

**Files to modify:**
- `src/sessions/session-config.ts`
- `src/agents/agent.ts`

**What to change:**
Update session creation to accept a provider instance ID instead of provider type.

**Commit message:** "feat: integrate configured providers with sessions"

### Task 8: Add Default Provider Configuration

**Files to create:**
- `src/providers/default-providers.json`

**What to implement:**

```json
{
  "version": "1.0",
  "providers": {
    "anthropic-main": {
      "name": "Anthropic",
      "type": "anthropic-api",
      "config": {
        "baseUrl": "https://api.anthropic.com/v1",
        "timeout": 30000
      }
    },
    "openai-main": {
      "name": "OpenAI",
      "type": "openai-api",
      "config": {
        "baseUrl": "https://api.openai.com/v1",
        "timeout": 30000
      }
    },
    "openrouter": {
      "name": "OpenRouter",
      "type": "openai-api",
      "config": {
        "baseUrl": "https://openrouter.ai/api/v1",
        "timeout": 60000
      }
    }
  }
}
```

**Commit message:** "feat: add default provider configurations"

## Testing Strategy

### Unit Tests
- Test each class/function in isolation
- Use real implementations, not mocks
- Test error cases and edge conditions

### Integration Tests
- Test provider loading from files
- Test API endpoints with real file system
- Test migration scenarios

### E2E Tests
- Test full UI flow: add provider, enter credentials, test connection
- Test provider selection in session creation

## Common Pitfalls to Avoid

### TypeScript
- Don't use `any` - use `unknown` with type guards
- Don't use `as` type assertions - use type guards
- Always handle null/undefined cases

### Testing
- Don't mock the code you're testing
- Don't test implementation details
- Do test behavior and outcomes

### Security
- Never log credentials
- Always use 0600 permissions for credential files
- Never return credentials in API responses

## Development Workflow

1. Read the spec: `provider-config-spec.md`
2. Start with Task 1, write failing tests
3. Implement until tests pass
4. Run `npm run lint` and fix issues
5. Commit with descriptive message
6. Move to next task

## Key Files to Study

Before starting, read these files to understand the codebase:

1. `src/providers/base-provider.ts` - Base class for providers
2. `src/providers/registry.ts` - Current provider management
3. `src/config/lace-dir.ts` - Where configuration files go
4. `src/sessions/session.ts` - How sessions use providers
5. `docs/design/terminology.md` - System concepts

## Success Criteria

The implementation is complete when:
1. Users can add multiple provider instances via web UI
2. Credentials are stored securely
3. Existing env-based providers still work
4. Sessions can use any configured provider
5. All tests pass
6. No TypeScript errors or linting issues