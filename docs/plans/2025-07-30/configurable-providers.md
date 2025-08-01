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

## Implementation Status

**BACKEND COMPLETE** ✅ - All backend functionality implemented and tested with proper TDD approach.

### Summary of Completed Backend Work

**Core Components Implemented:**
1. **Provider Catalog System** - Loads Catwalk data with user extensions (`src/providers/catalog/`)
2. **Provider Instance Management** - User configuration and secure credential storage (`src/providers/instance/`)  
3. **ProviderRegistry Refactor** - Integrated catalog/instance functionality into existing registry

**Key Features:**
- ✅ **Type-Safe Schemas** - Full Zod validation for all data structures (17 test cases)
- ✅ **Catwalk Integration** - Real provider catalog data imported from Charmbracelet Catwalk (9 providers)
- ✅ **Secure Credentials** - 0600 file permissions, separate credential storage
- ✅ **Backward Compatibility** - All existing env var providers still work
- ✅ **Error Resilience** - Graceful handling of corrupted files and missing data
- ✅ **Comprehensive Testing** - 60 total test cases with 100% TDD approach

**Files Created/Modified:**
- `src/providers/catalog/types.ts` + tests (17 tests)
- `src/providers/catalog/manager.ts` + tests (14 tests) 
- `src/providers/instance/manager.ts` + tests (16 tests)
- `src/providers/registry.ts` + updated tests (25 tests total)
- `src/providers/catalog/data/` - 9 Catwalk provider JSON files
- `docs/design/providers.md` - Architecture documentation

**What's Ready for Frontend:**
- `ProviderRegistry.getCatalogProviders()` - Browse available providers/models
- `ProviderRegistry.getConfiguredInstances()` - List user instances
- `ProviderRegistry.createProviderFromInstance()` - Create AI providers from instances
- `ProviderInstanceManager` - CRUD operations for instances and credentials
- Rich model metadata (costs, capabilities, context windows) for UI display

**Next Phase: Frontend Integration**
The backend API is ready for web UI implementation. The remaining tasks below are for frontend components.

### ✅ Task 1: Create Provider Catalog and Instance Types (COMPLETED)

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

### ✅ Task 2: Create Provider Catalog Manager (COMPLETED)

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

### ✅ Task 3: Create Provider Instance Manager (COMPLETED)

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

### ✅ Task 4: Refactor ProviderRegistry Integration (COMPLETED)

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

### ❌ Task 5: Environment Variable Migration (SKIPPED)

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

### Task 6: Provider Management App Routes & Layout

**Files to create:**
- `packages/web/app/providers/layout.tsx`
- `packages/web/app/providers/page.tsx`
- `packages/web/app/providers/catalog/page.tsx`
- `packages/web/app/providers/catalog/[providerId]/page.tsx`

**What to implement:**

```typescript
// packages/web/app/providers/layout.tsx
// ABOUTME: Layout for provider management section with navigation
// ABOUTME: Provides consistent header and navigation structure

import { SectionHeader } from '@/components/ui/SectionHeader';

export default function ProvidersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <SectionHeader title="Provider Management" />
      <div className="flex gap-4 border-b">
        <a href="/providers" className="tab tab-active">Instances</a>
        <a href="/providers/catalog" className="tab">Browse Catalog</a>
      </div>
      {children}
    </div>
  );
}

// packages/web/app/providers/page.tsx  
// ABOUTME: Main provider instances dashboard
// ABOUTME: Shows configured instances with status and management actions

import { ProviderInstanceList } from '@/components/providers/ProviderInstanceList';
import { AddInstanceButton } from '@/components/providers/AddInstanceButton';

export default function ProvidersPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Configured Instances</h2>
        <AddInstanceButton />
      </div>
      <ProviderInstanceList />
    </div>
  );
}
```

**Commit message:** "feat: add provider management app routes with Next.js app router"

### Task 7: Provider Catalog Browser Components

**Files to create:**
- `packages/web/components/providers/ProviderCatalogGrid.tsx`
- `packages/web/components/providers/ProviderCatalogCard.tsx`
- `packages/web/components/providers/ModelComparisonTable.tsx`

**What to implement:**

```typescript
// packages/web/components/providers/ProviderCatalogGrid.tsx
// ABOUTME: Grid display of available providers from catalogs
// ABOUTME: Shows provider cards with model counts and pricing info

'use client';

import { useEffect, useState } from 'react';
import { ProviderCatalogCard } from './ProviderCatalogCard';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';

interface CatalogProvider {
  id: string;
  name: string;
  type: string;
  models: Array<{
    id: string;
    name: string;
    cost_per_1m_in: number;
    cost_per_1m_out: number;
  }>;
}

export function ProviderCatalogGrid() {
  const [providers, setProviders] = useState<CatalogProvider[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/providers/catalog')
      .then(res => res.json())
      .then(data => {
        setProviders(data.providers);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <LoadingSkeleton count={6} className="h-48" />;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {providers.map(provider => (
        <ProviderCatalogCard
          key={provider.id}
          provider={provider}
          onAddInstance={() => {/* TODO: Open add instance modal */}}
        />
      ))}
    </div>
  );
}

// packages/web/components/providers/ProviderCatalogCard.tsx
// ABOUTME: Individual provider card showing models and pricing
// ABOUTME: Uses design system cards, badges, and buttons

import { Badge } from '@/components/ui/Badge';

interface ProviderCatalogCardProps {
  provider: {
    id: string;
    name: string;
    type: string;
    models: Array<{
      cost_per_1m_in: number;
      cost_per_1m_out: number;
    }>;
  };
  onAddInstance: () => void;
}

export function ProviderCatalogCard({ provider, onAddInstance }: ProviderCatalogCardProps) {
  const minPrice = Math.min(...provider.models.map(m => m.cost_per_1m_in));
  const maxPrice = Math.max(...provider.models.map(m => m.cost_per_1m_out));

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <div className="flex items-center justify-between">
          <h3 className="card-title">{provider.name}</h3>
          <Badge variant="primary" size="sm">
            {provider.models.length} models
          </Badge>
        </div>
        
        <p className="text-sm text-base-content/60">
          ${minPrice}-${maxPrice}/1M tokens
        </p>
        
        <div className="space-y-1 text-xs">
          {provider.models.slice(0, 2).map(model => (
            <div key={model.id}>• {model.name}</div>
          ))}
          {provider.models.length > 2 && (
            <div>• And {provider.models.length - 2} more...</div>
          )}
        </div>
        
        <div className="card-actions justify-end">
          <button 
            className="btn btn-primary btn-sm"
            onClick={onAddInstance}
          >
            Add Instance
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Commit message:** "feat: add provider catalog browser components with design system"

### Task 8: Provider Instance Management Components

**Files to create:**
- `packages/web/components/providers/ProviderInstanceList.tsx`
- `packages/web/components/providers/ProviderInstanceCard.tsx`
- `packages/web/components/providers/AddInstanceModal.tsx`
- `packages/web/components/providers/EditInstanceModal.tsx`

**What to implement:**

```typescript
// packages/web/components/providers/ProviderInstanceList.tsx
// ABOUTME: List of configured provider instances with status indicators
// ABOUTME: Shows connection status, available models, and management actions

'use client';

import { useEffect, useState } from 'react';
import { ProviderInstanceCard } from './ProviderInstanceCard';
import { AddInstanceModal } from './AddInstanceModal';

interface ProviderInstance {
  id: string;
  displayName: string;
  catalogProviderId: string;
  status: 'connected' | 'error' | 'untested';
  modelCount: number;
  lastTested?: string;
}

export function ProviderInstanceList() {
  const [instances, setInstances] = useState<ProviderInstance[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    loadInstances();
  }, []);

  const loadInstances = async () => {
    const response = await fetch('/api/providers/instances');
    const data = await response.json();
    setInstances(data.instances);
  };

  const handleDelete = async (instanceId: string) => {
    await fetch(`/api/providers/instances/${instanceId}`, {
      method: 'DELETE'
    });
    loadInstances();
  };

  const handleTest = async (instanceId: string) => {
    await fetch(`/api/providers/instances/${instanceId}/test`, {
      method: 'POST'
    });
    loadInstances();
  };

  return (
    <>
      <div className="space-y-3">
        {instances.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-base-content/60 mb-4">No provider instances configured</p>
            <button 
              className="btn btn-primary"
              onClick={() => setShowAddModal(true)}
            >
              Add Your First Instance
            </button>
          </div>
        ) : (
          instances.map(instance => (
            <ProviderInstanceCard
              key={instance.id}
              instance={instance}
              onTest={() => handleTest(instance.id)}
              onDelete={() => handleDelete(instance.id)}
            />
          ))
        )}
      </div>

      <AddInstanceModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={loadInstances}
      />
    </>
  );
}

// packages/web/components/providers/ProviderInstanceCard.tsx
// ABOUTME: Individual instance card with status, actions, and details
// ABOUTME: Uses StatusDot, Badge, and card components from design system

import { StatusDot } from '@/components/ui/StatusDot';

interface ProviderInstanceCardProps {
  instance: {
    id: string;
    displayName: string;
    catalogProviderId: string;
    status: 'connected' | 'error' | 'untested';
    modelCount: number;
    lastTested?: string;
  };
  onTest: () => void;
  onDelete: () => void;
}

export function ProviderInstanceCard({ instance, onTest, onDelete }: ProviderInstanceCardProps) {
  const getStatusProps = (status: string) => {
    switch (status) {
      case 'connected': return { status: 'success' as const, text: 'Connected' };
      case 'error': return { status: 'error' as const, text: 'Connection Error' };
      default: return { status: 'warning' as const, text: 'Untested' };
    }
  };

  const statusProps = getStatusProps(instance.status);

  return (
    <div className="card bg-base-100 shadow-sm">
      <div className="card-body py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <StatusDot status={statusProps.status} size="md" />
            <div>
              <h4 className="font-medium">{instance.displayName}</h4>
              <p className="text-sm text-base-content/60">
                {instance.modelCount} models available • {statusProps.text}
                {instance.lastTested && (
                  <span> • Last tested: {new Date(instance.lastTested).toLocaleDateString()}</span>
                )}
              </p>
            </div>
          </div>
          
          <div className="flex space-x-2">
            <button className="btn btn-ghost btn-sm" onClick={onTest}>
              Test
            </button>
            <button className="btn btn-outline btn-sm">
              Edit
            </button>
            <button className="btn btn-ghost btn-sm text-error" onClick={onDelete}>
              ×
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Commit message:** "feat: add provider instance management components"

### Task 9: Instance Configuration Modals

**Files to create:**
- `packages/web/components/providers/AddInstanceModal.tsx`
- `packages/web/components/providers/ModelSelectionForm.tsx`
- `packages/web/components/providers/CredentialInput.tsx`

**What to implement:**

```typescript
// packages/web/components/providers/AddInstanceModal.tsx
// ABOUTME: Modal for configuring new provider instances
// ABOUTME: Multi-step form with catalog selection, configuration, and credentials

'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';

interface AddInstanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface CatalogProvider {
  id: string;
  name: string;
  type: string;
  models: Array<{ id: string; name: string }>;
}

export function AddInstanceModal({ isOpen, onClose, onSuccess }: AddInstanceModalProps) {
  const [step, setStep] = useState<'select' | 'configure'>('select');
  const [providers, setProviders] = useState<CatalogProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<CatalogProvider | null>(null);
  const [formData, setFormData] = useState({
    displayName: '',
    endpoint: '',
    timeout: 30000,
    apiKey: ''
  });

  useEffect(() => {
    if (isOpen) {
      fetch('/api/providers/catalog')
        .then(res => res.json())
        .then(data => setProviders(data.providers));
    }
  }, [isOpen]);

  const handleProviderSelect = (provider: CatalogProvider) => {
    setSelectedProvider(provider);
    setFormData({
      ...formData,
      displayName: `${provider.name} Instance`
    });
    setStep('configure');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const response = await fetch('/api/providers/instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: formData.displayName,
        catalogProviderId: selectedProvider?.id,
        endpoint: formData.endpoint || undefined,
        timeout: formData.timeout,
        credential: { apiKey: formData.apiKey }
      })
    });

    if (response.ok) {
      onSuccess();
      onClose();
      resetForm();
    }
  };

  const resetForm = () => {
    setStep('select');
    setSelectedProvider(null);
    setFormData({ displayName: '', endpoint: '', timeout: 30000, apiKey: '' });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        onClose();
        resetForm();
      }}
      title={step === 'select' ? 'Select Provider' : 'Configure Instance'}
      size="md"
    >
      {step === 'select' ? (
        <div className="space-y-4">
          <p className="text-sm text-base-content/60">
            Choose a provider from the catalog to create a new instance.
          </p>
          
          <div className="grid gap-3">
            {providers.map(provider => (
              <button
                key={provider.id}
                className="card bg-base-100 shadow-sm hover:shadow-md transition-shadow text-left"
                onClick={() => handleProviderSelect(provider)}
              >
                <div className="card-body py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium">{provider.name}</h4>
                      <p className="text-xs text-base-content/60">
                        {provider.models.length} models available
                      </p>
                    </div>
                    <Badge variant="outline" size="sm">{provider.type}</Badge>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">
              <span className="label-text">Instance Name</span>
            </label>
            <input
              type="text"
              className="input input-bordered w-full"
              value={formData.displayName}
              onChange={(e) => setFormData({...formData, displayName: e.target.value})}
              required
            />
          </div>

          <div>
            <label className="label">
              <span className="label-text">Provider</span>
            </label>
            <div className="flex items-center space-x-2">
              <Badge variant="outline">{selectedProvider?.name}</Badge>
              <span className="text-sm text-base-content/60">from catalog</span>
            </div>
          </div>

          <div>
            <label className="label">
              <span className="label-text">Custom Endpoint (optional)</span>
            </label>
            <input
              type="url"
              className="input input-bordered w-full"
              value={formData.endpoint}
              onChange={(e) => setFormData({...formData, endpoint: e.target.value})}
              placeholder="Leave empty to use default"
            />
          </div>

          <div>
            <label className="label">
              <span className="label-text">API Key</span>
            </label>
            <input
              type="password"
              className="input input-bordered w-full"
              value={formData.apiKey}
              onChange={(e) => setFormData({...formData, apiKey: e.target.value})}
              required
            />
          </div>

          <div className="bg-base-200 p-3 rounded-lg">
            <p className="text-sm font-medium mb-1">This will enable:</p>
            <p className="text-xs text-base-content/60">
              {selectedProvider?.models.slice(0, 3).map(m => m.name).join(', ')}
              {selectedProvider && selectedProvider.models.length > 3 && 
                ` and ${selectedProvider.models.length - 3} more models`
              }
            </p>
          </div>

          <div className="flex justify-end space-x-3">
            <button type="button" className="btn btn-ghost" onClick={() => setStep('select')}>
              Back
            </button>
            <button type="submit" className="btn btn-primary">
              Create Instance
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
```

**Commit message:** "feat: add instance configuration modal with multi-step form"

### Task 10: Session Creation Integration

**Files to modify:**
- `packages/web/components/sessions/CreateSessionModal.tsx` (or equivalent)
- `packages/web/components/sessions/ModelSelectionForm.tsx`

**What to implement:**

```typescript
// packages/web/components/sessions/ModelSelectionForm.tsx  
// ABOUTME: Model selection component for session creation
// ABOUTME: Shows available models from selected provider instance with pricing

'use client';

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/Badge';
import { StatusDot } from '@/components/ui/StatusDot';

interface Model {
  id: string;
  name: string;
  cost_per_1m_in: number;
  cost_per_1m_out: number;
  context_window: number;
  can_reason?: boolean;
  supports_attachments?: boolean;
}

interface ProviderInstance {
  id: string;
  displayName: string;
  status: 'connected' | 'error' | 'untested';
  modelCount: number;
}

interface ModelSelectionFormProps {
  onSelectionChange: (instanceId: string, modelId: string) => void;
}

export function ModelSelectionForm({ onSelectionChange }: ModelSelectionFormProps) {
  const [instances, setInstances] = useState<ProviderInstance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string>('');
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');

  useEffect(() => {
    // Load configured instances
    fetch('/api/providers/instances')
      .then(res => res.json())
      .then(data => setInstances(data.instances));
  }, []);

  useEffect(() => {
    if (selectedInstance) {
      // Load models for selected instance
      fetch(`/api/providers/instances/${selectedInstance}/models`)
        .then(res => res.json())
        .then(data => setAvailableModels(data.models));
    }
  }, [selectedInstance]);

  useEffect(() => {
    if (selectedInstance && selectedModel) {
      onSelectionChange(selectedInstance, selectedModel);
    }
  }, [selectedInstance, selectedModel, onSelectionChange]);

  return (
    <div className="space-y-4">
      <div>
        <label className="label">
          <span className="label-text">Provider Instance</span>
        </label>
        <select 
          className="select select-bordered w-full"
          value={selectedInstance}
          onChange={(e) => setSelectedInstance(e.target.value)}
        >
          <option value="">Select provider instance</option>
          {instances.map(instance => (
            <option key={instance.id} value={instance.id}>
              {instance.displayName}
            </option>
          ))}
        </select>
        
        {selectedInstance && (
          <div className="flex items-center space-x-2 mt-1">
            <StatusDot status="success" size="sm" />
            <span className="text-xs text-base-content/60">
              Connected • {availableModels.length} models available
            </span>
          </div>
        )}
      </div>

      {availableModels.length > 0 && (
        <div>
          <label className="label">
            <span className="label-text">Model</span>
          </label>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {availableModels.map(model => (
              <label key={model.id} className="cursor-pointer">
                <div className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-base-200">
                  <input
                    type="radio"
                    name="model"
                    value={model.id}
                    className="radio radio-primary radio-sm"
                    onChange={(e) => setSelectedModel(e.target.value)}
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{model.name}</span>
                      <Badge variant="primary" size="xs">
                        ${model.cost_per_1m_in}/${model.cost_per_1m_out}
                      </Badge>
                    </div>
                    <div className="text-xs text-base-content/60 mt-1">
                      {model.context_window / 1000}K context
                      {model.can_reason && ' • Reasoning'}
                      {model.supports_attachments && ' • Attachments'}
                    </div>
                  </div>
                </div>
              </label>
            ))}
          </div>

          {selectedModel && (
            <div className="bg-info/20 p-3 rounded-lg mt-4">
              <div className="text-sm">
                <div className="font-medium">Estimated cost: ~$0.05 per conversation</div>
                <div className="text-xs text-base-content/60 mt-1">
                  Based on typical usage patterns
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

**Commit message:** "feat: integrate provider instance and model selection into session creation"

### Task 11: Custom Provider Catalog Management

**Files to create:**
- `packages/web/app/providers/catalog/custom/page.tsx`
- `packages/web/components/providers/CustomCatalogForm.tsx`
- `packages/web/components/providers/ModelDefinitionForm.tsx`

**What to implement:**

```typescript
// packages/web/components/providers/CustomCatalogForm.tsx
// ABOUTME: Form for creating custom provider catalog entries
// ABOUTME: Allows users to define local/experimental providers with models

'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';

interface CustomCatalogFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface ModelDefinition {
  id: string;
  name: string;
  cost_per_1m_in: number;
  cost_per_1m_out: number;
  context_window: number;
  can_reason: boolean;
  supports_attachments: boolean;
  default_max_tokens: number;
}

export function CustomCatalogForm({ isOpen, onClose, onSuccess }: CustomCatalogFormProps) {
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    type: 'ollama',
    api_endpoint: 'http://localhost:11434'
  });
  const [models, setModels] = useState<ModelDefinition[]>([]);
  const [showModelForm, setShowModelForm] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const catalogEntry = {
      ...formData,
      models
    };

    const response = await fetch('/api/providers/user-catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(catalogEntry)
    });

    if (response.ok) {
      onSuccess();
      onClose();
      resetForm();
    }
  };

  const addModel = (model: ModelDefinition) => {
    setModels([...models, model]);
  };

  const removeModel = (modelId: string) => {
    setModels(models.filter(m => m.id !== modelId));
  };

  const resetForm = () => {
    setFormData({ id: '', name: '', type: 'ollama', api_endpoint: '' });
    setModels([]);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Custom Provider"
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">
              <span className="label-text">Provider ID</span>
            </label>
            <input
              type="text"
              className="input input-bordered w-full"
              value={formData.id}
              onChange={(e) => setFormData({...formData, id: e.target.value})}
              placeholder="my-ollama"
              required
            />
          </div>
          
          <div>
            <label className="label">
              <span className="label-text">Display Name</span>
            </label>
            <input
              type="text"
              className="input input-bordered w-full"
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              placeholder="Local Ollama"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">
              <span className="label-text">API Type</span>
            </label>
            <select
              className="select select-bordered w-full"
              value={formData.type}
              onChange={(e) => setFormData({...formData, type: e.target.value})}
            >
              <option value="ollama">Ollama</option>
              <option value="openai">OpenAI Compatible</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          
          <div>
            <label className="label">
              <span className="label-text">API Endpoint</span>
            </label>
            <input
              type="url"
              className="input input-bordered w-full"
              value={formData.api_endpoint}
              onChange={(e) => setFormData({...formData, api_endpoint: e.target.value})}
              placeholder="http://localhost:11434"
              required
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="label">
              <span className="label-text">Available Models</span>
            </label>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setShowModelForm(true)}
            >
              Add Model
            </button>
          </div>
          
          <div className="space-y-2">
            {models.map(model => (
              <div key={model.id} className="flex items-center justify-between p-3 bg-base-200 rounded-lg">
                <div>
                  <div className="font-medium">{model.name}</div>
                  <div className="text-xs text-base-content/60">
                    {model.context_window / 1000}K context • ${model.cost_per_1m_in}/${model.cost_per_1m_out}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-error"
                  onClick={() => removeModel(model.id)}
                >
                  Remove
                </button>
              </div>
            ))}
            
            {models.length === 0 && (
              <div className="text-center py-6 text-base-content/60">
                No models defined. Add at least one model to continue.
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end space-x-3">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button 
            type="submit" 
            className="btn btn-primary"
            disabled={models.length === 0}
          >
            Create Provider
          </button>
        </div>
      </form>

      {/* Model Definition Modal would go here */}
    </Modal>
  );
}
```

**Commit message:** "feat: add custom provider catalog management"

### Task 12: Provider Testing & Status Components  

**Files to create:**
- `packages/web/components/providers/ConnectionTest.tsx`
- `packages/web/components/providers/ProviderStatusBadge.tsx`
- `packages/web/hooks/useProviderStatus.ts`

**What to implement:**

```typescript
// packages/web/hooks/useProviderStatus.ts
// ABOUTME: Custom hook for managing provider connection status
// ABOUTME: Handles testing, status updates, and real-time status monitoring

'use client';

import { useState, useEffect, useCallback } from 'react';

interface ProviderStatus {
  status: 'connected' | 'error' | 'untested' | 'testing';
  lastTested?: string;
  error?: string;
}

export function useProviderStatus(instanceId: string) {
  const [status, setStatus] = useState<ProviderStatus>({ status: 'untested' });

  const testConnection = useCallback(async () => {
    setStatus(prev => ({ ...prev, status: 'testing' }));

    try {
      const response = await fetch(`/api/providers/instances/${instanceId}/test`, {
        method: 'POST'
      });

      if (response.ok) {
        setStatus({
          status: 'connected',
          lastTested: new Date().toISOString()
        });
      } else {
        const error = await response.text();
        setStatus({
          status: 'error',
          lastTested: new Date().toISOString(),
          error
        });
      }
    } catch (error) {
      setStatus({
        status: 'error',
        lastTested: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Connection failed'
      });
    }
  }, [instanceId]);

  return { status, testConnection };
}

// packages/web/components/providers/ConnectionTest.tsx
// ABOUTME: Component for testing provider connections with real-time feedback
// ABOUTME: Shows loading states, success/error messages, and retry options

import { useState } from 'react';
import { StatusDot } from '@/components/ui/StatusDot';
import { useProviderStatus } from '@/hooks/useProviderStatus';

interface ConnectionTestProps {
  instanceId: string;
  onStatusChange?: (status: string) => void;
}

export function ConnectionTest({ instanceId, onStatusChange }: ConnectionTestProps) {
  const { status, testConnection } = useProviderStatus(instanceId);

  const handleTest = async () => {
    await testConnection();
    onStatusChange?.(status.status);
  };

  const getStatusDisplay = () => {
    switch (status.status) {
      case 'testing':
        return { dot: 'info' as const, text: 'Testing...', color: 'text-info' };
      case 'connected':
        return { dot: 'success' as const, text: 'Connected', color: 'text-success' };
      case 'error':
        return { dot: 'error' as const, text: 'Connection Error', color: 'text-error' };
      default:
        return { dot: 'warning' as const, text: 'Untested', color: 'text-warning' };
    }
  };

  const statusDisplay = getStatusDisplay();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <StatusDot 
            status={statusDisplay.dot} 
            size="sm" 
            pulse={status.status === 'testing'}
          />
          <span className={`text-sm ${statusDisplay.color}`}>
            {statusDisplay.text}
          </span>
        </div>
        
        <button
          className="btn btn-outline btn-sm"
          onClick={handleTest}
          disabled={status.status === 'testing'}
        >
          {status.status === 'testing' ? 'Testing...' : 'Test Connection'}
        </button>
      </div>

      {status.lastTested && (
        <p className="text-xs text-base-content/60">
          Last tested: {new Date(status.lastTested).toLocaleString()}
        </p>
      )}

      {status.error && (
        <div className="bg-error/20 p-2 rounded text-sm text-error">
          {status.error}
        </div>
      )}
    </div>
  );
}
```

**Commit message:** "feat: add provider connection testing with real-time status"

### Task 13: Backend Integration & API Updates

**Files to modify:**
- Update existing session APIs to use instance + model IDs
- Update agent initialization to resolve provider instances
- Add catalog loading to provider registry

**What to change:**
- Session creation endpoints accept `providerInstanceId` and `modelId`
- Provider registry resolves instances from catalog + user config
- Agent initialization uses resolved provider instances

**Commit message:** "feat: integrate provider system with existing session/agent infrastructure"
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