# Configurable Providers Implementation Plan

## Overview

This plan implements a system for configuring multiple AI provider instances through a web UI. Currently, lace only supports providers configured via environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY). We need to support multiple instances of the same provider type with different endpoints and credentials.

## Key Concepts for the Engineer

### What is a Provider?
- A provider is a service that hosts AI models (like OpenAI, Anthropic)
- Provider **types** are the actual code implementations (src/providers/)
- Provider **instances** are configured uses of those types (what we're adding)

### Current System
- Providers are created based on environment variables
- Only one instance per provider type is possible
- No UI for configuration

### New System
- Multiple instances of each provider type
- Configuration stored in JSON files
- Web UI for management
- Secure credential storage

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

### Task 1: Create Provider Configuration Types

**Files to create:**
- `src/providers/provider-config.ts`
- `src/providers/provider-config.test.ts`

**What to implement:**

```typescript
// src/providers/provider-config.ts
// ABOUTME: Types and schemas for provider instance configuration
// ABOUTME: Defines the shape of provider configs stored in providers.json

import { z } from 'zod';

// Provider instance configuration schema
export const ProviderInstanceSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['anthropic-api', 'openai-api']),
  config: z.record(z.unknown()) // JSONB extensibility
});

export type ProviderInstance = z.infer<typeof ProviderInstanceSchema>;

// Full providers.json schema
export const ProvidersConfigSchema = z.object({
  version: z.literal('1.0'),
  providers: z.record(ProviderInstanceSchema)
});

export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;

// Credential schema
export const CredentialSchema = z.object({
  apiKey: z.string().min(1),
  additionalAuth: z.record(z.unknown()).optional()
});

export type Credential = z.infer<typeof CredentialSchema>;
```

**How to test:**
```typescript
// src/providers/provider-config.test.ts
import { describe, it, expect } from 'vitest';
import { ProviderInstanceSchema, ProvidersConfigSchema } from './provider-config';

describe('ProviderInstanceSchema', () => {
  it('validates valid provider instance', () => {
    const valid = {
      name: 'OpenAI Production',
      type: 'openai-api',
      config: { baseUrl: 'https://api.openai.com/v1' }
    };
    
    const result = ProviderInstanceSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects invalid provider type', () => {
    const invalid = {
      name: 'Invalid',
      type: 'invalid-api',
      config: {}
    };
    
    const result = ProviderInstanceSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
```

**Commit message:** "feat: add provider configuration types and schemas"

### Task 2: Create Provider Configuration Manager

**Files to create:**
- `src/providers/provider-config-manager.ts`
- `src/providers/provider-config-manager.test.ts`

**What to implement:**

```typescript
// src/providers/provider-config-manager.ts
// ABOUTME: Manages loading and saving provider configurations
// ABOUTME: Handles providers.json and credential files in LACE_DIR

import fs from 'fs';
import path from 'path';
import { getLaceDir } from '~/config/lace-dir';
import { ProvidersConfig, ProvidersConfigSchema, Credential, CredentialSchema } from './provider-config';

export class ProviderConfigManager {
  private configPath: string;
  private credentialsDir: string;

  constructor() {
    const laceDir = getLaceDir();
    this.configPath = path.join(laceDir, 'providers.json');
    this.credentialsDir = path.join(laceDir, 'credentials');
  }

  async loadConfig(): Promise<ProvidersConfig> {
    try {
      const content = await fs.promises.readFile(this.configPath, 'utf-8');
      return ProvidersConfigSchema.parse(JSON.parse(content));
    } catch (error) {
      // Return default config if file doesn't exist
      return {
        version: '1.0',
        providers: {}
      };
    }
  }

  async saveConfig(config: ProvidersConfig): Promise<void> {
    await fs.promises.writeFile(
      this.configPath,
      JSON.stringify(config, null, 2)
    );
  }

  async loadCredential(providerId: string): Promise<Credential | null> {
    try {
      const credPath = path.join(this.credentialsDir, `${providerId}.json`);
      const content = await fs.promises.readFile(credPath, 'utf-8');
      return CredentialSchema.parse(JSON.parse(content));
    } catch (error) {
      return null;
    }
  }

  async saveCredential(providerId: string, credential: Credential): Promise<void> {
    await fs.promises.mkdir(this.credentialsDir, { recursive: true });
    const credPath = path.join(this.credentialsDir, `${providerId}.json`);
    await fs.promises.writeFile(
      credPath,
      JSON.stringify(credential, null, 2),
      { mode: 0o600 } // Secure permissions
    );
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

**Commit message:** "feat: add provider configuration manager"

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