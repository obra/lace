# OpenRouter Dynamic Catalogs - Implementation Tasks

## Prerequisites

Before starting, ensure you have:
- Node.js and npm installed
- Access to the Lace codebase
- An OpenRouter API key for testing (get one at https://openrouter.ai)
- Understanding of TypeScript, React, and Test-Driven Development (TDD)

## Development Workflow

For EVERY task:
1. Write failing tests FIRST
2. Implement minimal code to pass tests
3. Refactor if needed
4. Commit with descriptive message
5. Run `npm run lint` and fix issues
6. Push to branch

## Testing Commands

```bash
npm test                 # Run tests in watch mode
npm run test:run        # Run all tests once
npm run test:unit       # Unit tests only
npm run test:integration # Integration tests
npx vitest --run src/path/to/specific.test.ts  # Run specific test
```

## Task Breakdown

### Phase 1: Data Models and Types (2-3 hours)

#### Task 1.1: Extend Provider Instance Types
**Files to modify:**
- `packages/core/src/providers/catalog/types.ts`

**What to do:**
1. Write test file: `packages/core/src/providers/catalog/types.test.ts`
   ```typescript
   import { describe, it, expect } from 'vitest';
   import { ProviderInstanceSchema } from './types';

   describe('ProviderInstance modelConfig', () => {
     it('should accept modelConfig with filters', () => {
       const config = {
         displayName: 'Test',
         catalogProviderId: 'openrouter',
         modelConfig: {
           enableNewModels: true,
           disabledModels: ['model-1'],
           disabledProviders: ['provider-1'],
           filters: {
             requiredParameters: ['tools'],
             maxPromptCostPerMillion: 5.0,
             maxCompletionCostPerMillion: 10.0,
             minContextLength: 32000
           }
         }
       };
       const result = ProviderInstanceSchema.safeParse(config);
       expect(result.success).toBe(true);
     });

     it('should work without modelConfig (backward compat)', () => {
       const config = {
         displayName: 'Test',
         catalogProviderId: 'anthropic'
       };
       const result = ProviderInstanceSchema.safeParse(config);
       expect(result.success).toBe(true);
     });
   });
   ```

2. Add to `types.ts`:
   ```typescript
   // Model configuration schema
   export const ModelConfigSchema = z.object({
     enableNewModels: z.boolean().default(true),
     disabledModels: z.array(z.string()).default([]),
     disabledProviders: z.array(z.string()).default([]),
     filters: z.object({
       requiredParameters: z.array(z.string()).optional(),
       maxPromptCostPerMillion: z.number().positive().optional(),
       maxCompletionCostPerMillion: z.number().positive().optional(),
       minContextLength: z.number().int().positive().optional(),
     }).optional(),
   });

   // Update ProviderInstanceSchema
   export const ProviderInstanceSchema = z.object({
     displayName: z.string().min(1),
     catalogProviderId: z.string().min(1),
     endpoint: z.string().url().optional(),
     timeout: z.number().int().positive().optional(),
     retryPolicy: z.string().optional(),
     modelConfig: ModelConfigSchema.optional(), // ADD THIS
   });

   export type ModelConfig = z.infer<typeof ModelConfigSchema>;
   ```

3. Run tests: `npx vitest --run packages/core/src/providers/catalog/types.test.ts`
4. Commit: `git commit -m "feat: add modelConfig schema to ProviderInstance type"`

#### Task 1.2: Define OpenRouter Response Types
**Files to create:**
- `packages/core/src/providers/openrouter/types.ts`
- `packages/core/src/providers/openrouter/types.test.ts`

**What to do:**
1. Create test file first:
   ```typescript
   import { describe, it, expect } from 'vitest';
   import { OpenRouterModelSchema, OpenRouterResponseSchema } from './types';

   describe('OpenRouter Types', () => {
     it('should parse model response', () => {
       const model = {
         id: 'openai/gpt-4o',
         name: 'GPT-4o',
         context_length: 128000,
         pricing: { prompt: '0.0000025', completion: '0.00001' },
         supported_parameters: ['tools', 'temperature'],
         architecture: { modality: 'text->text' }
       };
       const result = OpenRouterModelSchema.safeParse(model);
       expect(result.success).toBe(true);
     });
   });
   ```

2. Create types file:
   ```typescript
   import { z } from 'zod';

   export const OpenRouterModelSchema = z.object({
     id: z.string(),
     name: z.string(),
     description: z.string().optional(),
     context_length: z.number(),
     pricing: z.object({
       prompt: z.string(),
       completion: z.string(),
       request: z.string().optional(),
       image: z.string().optional(),
     }),
     supported_parameters: z.array(z.string()).optional(),
     architecture: z.object({
       modality: z.string(),
       tokenizer: z.string().optional(),
       instruct_type: z.string().nullable().optional(),
     }).optional(),
     top_provider: z.object({
       context_length: z.number().optional(),
       max_completion_tokens: z.number().nullable().optional(),
       is_moderated: z.boolean().optional(),
     }).optional(),
     per_request_limits: z.any().nullable().optional(),
   });

   export const OpenRouterResponseSchema = z.object({
     data: z.array(OpenRouterModelSchema),
   });

   export type OpenRouterModel = z.infer<typeof OpenRouterModelSchema>;
   export type OpenRouterResponse = z.infer<typeof OpenRouterResponseSchema>;
   ```

3. Run tests and commit

### Phase 2: API Client and Caching (3-4 hours)

#### Task 2.1: Capture Real OpenRouter API Response
**Files to create:**
- `packages/core/src/providers/openrouter/fixtures/models-response.json`
- `packages/core/src/providers/openrouter/capture-fixtures.ts`

**What to do:**
1. First, capture the real API response (run this once):
   ```typescript
   // capture-fixtures.ts
   import * as fs from 'fs';
   import * as path from 'path';

   async function captureOpenRouterResponse() {
     console.log('Fetching OpenRouter models (no API key needed)...');
     
     const response = await fetch('https://openrouter.ai/api/v1/models');
     if (!response.ok) {
       throw new Error(`Failed: ${response.status}`);
     }
     
     const data = await response.json();
     
     // Save to fixtures
     const fixturesDir = path.join(import.meta.dir, 'fixtures');
     await fs.promises.mkdir(fixturesDir, { recursive: true });
     
     await fs.promises.writeFile(
       path.join(fixturesDir, 'models-response.json'),
       JSON.stringify(data, null, 2)
     );
     
     console.log(`Captured ${data.data.length} models`);
     
     // Also save a smaller test fixture with just a few models
     const testFixture = {
       data: data.data.slice(0, 10) // First 10 models for tests
     };
     
     await fs.promises.writeFile(
       path.join(fixturesDir, 'models-response-test.json'),
       JSON.stringify(testFixture, null, 2)
     );
   }

   // Run if called directly
   if (import.meta.url === `file://${process.argv[1]}`) {
     captureOpenRouterResponse().catch(console.error);
   }
   ```

2. Run to capture real data:
   ```bash
   npx tsx packages/core/src/providers/openrouter/capture-fixtures.ts
   ```

3. Verify the response structure and commit the fixtures:
   ```bash
   git add packages/core/src/providers/openrouter/fixtures/
   git commit -m "test: add OpenRouter API response fixtures"
   ```

#### Task 2.2: Create OpenRouter API Client with Real Data Tests
**Files to create:**
- `packages/core/src/providers/openrouter/client.ts`
- `packages/core/src/providers/openrouter/client.test.ts`

**What to do:**
1. Write test using real fixture data:
   ```typescript
   import { describe, it, expect, beforeEach, afterEach } from 'vitest';
   import { OpenRouterClient } from './client';
   import fixtureData from './fixtures/models-response-test.json';

   describe('OpenRouterClient', () => {
     describe('with real API response structure', () => {
       beforeEach(() => {
         // Mock fetch to return our fixture data
         global.fetch = vi.fn().mockResolvedValue({
           ok: true,
           json: async () => fixtureData
         });
       });

       afterEach(() => {
         vi.restoreAllMocks();
       });

       it('should parse real OpenRouter response correctly', async () => {
         const client = new OpenRouterClient();
         const result = await client.fetchModels();
         
         expect(result.data).toHaveLength(10);
         
         // Test actual structure from real data
         const firstModel = result.data[0];
         expect(firstModel).toHaveProperty('id');
         expect(firstModel).toHaveProperty('name');
         expect(firstModel).toHaveProperty('context_length');
         expect(firstModel).toHaveProperty('pricing');
         expect(firstModel.pricing).toHaveProperty('prompt');
         expect(firstModel.pricing).toHaveProperty('completion');
       });

       it('should work without API key', async () => {
         const client = new OpenRouterClient();
         const result = await client.fetchModels(); // No API key
         
         expect(fetch).toHaveBeenCalledWith(
           'https://openrouter.ai/api/v1/models',
           expect.objectContaining({
             headers: {} // No auth header
           })
         );
         expect(result.data.length).toBeGreaterThan(0);
       });

       it('should include API key when provided', async () => {
         const client = new OpenRouterClient();
         await client.fetchModels('test-api-key');
         
         expect(fetch).toHaveBeenCalledWith(
           'https://openrouter.ai/api/v1/models',
           expect.objectContaining({
             headers: { 'Authorization': 'Bearer test-api-key' }
           })
         );
       });
     });

     describe('with live API (integration)', () => {
       it.skipIf(!process.env.TEST_LIVE_API)(
         'should fetch real data from OpenRouter API',
         async () => {
           // This test actually hits the API
           vi.restoreAllMocks(); // Use real fetch
           
           const client = new OpenRouterClient();
           const result = await client.fetchModels();
           
           expect(result.data.length).toBeGreaterThan(100);
           expect(result.data[0]).toHaveProperty('id');
           expect(result.data[0]).toHaveProperty('pricing');
         },
         { timeout: 10000 }
       );
     });
   });
   ```

2. Implement client:
   ```typescript
   import { OpenRouterResponse, OpenRouterResponseSchema } from './types';
   import { logger } from '~/utils/logger';

   export class OpenRouterClient {
     private baseUrl = 'https://openrouter.ai/api/v1';

     async fetchModels(apiKey?: string): Promise<OpenRouterResponse> {
       const headers: HeadersInit = {};
       if (apiKey) {
         headers['Authorization'] = `Bearer ${apiKey}`;
       }

       const response = await fetch(`${this.baseUrl}/models`, { headers });
       
       if (!response.ok) {
         throw new Error(`OpenRouter API error: ${response.status}`);
       }

       const data = await response.json();
       return OpenRouterResponseSchema.parse(data);
     }
   }
   ```

3. Run tests and commit

#### Task 2.2: Implement Cache Manager
**Files to create:**
- `packages/core/src/providers/openrouter/cache-manager.ts`
- `packages/core/src/providers/openrouter/cache-manager.test.ts`

**What to do:**
1. Test file (using temp directory):
   ```typescript
   import { describe, it, expect, beforeEach, afterEach } from 'vitest';
   import { CatalogCacheManager } from './cache-manager';
   import * as fs from 'fs';
   import * as path from 'path';
   import { tmpdir } from 'os';

   describe('CatalogCacheManager', () => {
     let tempDir: string;
     let manager: CatalogCacheManager;

     beforeEach(() => {
       tempDir = fs.mkdtempSync(path.join(tmpdir(), 'lace-test-'));
       manager = new CatalogCacheManager(tempDir);
     });

     afterEach(() => {
       fs.rmSync(tempDir, { recursive: true });
     });

     it('should save and load cache', async () => {
       const catalog = {
         _meta: {
           fetchedAt: new Date().toISOString(),
           version: '1.0',
           modelCount: 2,
           source: 'test'
         },
         provider: {
           name: 'Test',
           id: 'test',
           models: []
         }
       };

       await manager.save('test-instance', catalog);
       const loaded = await manager.load('test-instance');
       
       expect(loaded).toEqual(catalog);
     });

     it('should check if cache is stale', async () => {
       const oldCatalog = {
         _meta: {
           fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
           version: '1.0',
           modelCount: 1,
           source: 'test'
         },
         provider: { name: 'Test', id: 'test', models: [] }
       };

       await manager.save('test-instance', oldCatalog);
       const isStale = await manager.isStale('test-instance');
       
       expect(isStale).toBe(true);
     });

     it('should return null for missing cache', async () => {
       const result = await manager.load('nonexistent');
       expect(result).toBeNull();
     });
   });
   ```

2. Implementation:
   ```typescript
   import * as fs from 'fs';
   import * as path from 'path';
   import { logger } from '~/utils/logger';

   export interface CachedCatalog {
     _meta: {
       fetchedAt: string;
       version: string;
       modelCount: number;
       source: string;
     };
     provider: {
       name: string;
       id: string;
       models: any[];
     };
   }

   export class CatalogCacheManager {
     private cacheDir: string;
     private maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours

     constructor(baseDir: string) {
       this.cacheDir = path.join(baseDir, 'catalogs');
     }

     async save(instanceId: string, catalog: CachedCatalog): Promise<void> {
       await fs.promises.mkdir(this.cacheDir, { recursive: true });
       const filePath = this.getCachePath(instanceId);
       await fs.promises.writeFile(filePath, JSON.stringify(catalog, null, 2));
       logger.info('catalog.cache.saved', { instanceId, modelCount: catalog._meta.modelCount });
     }

     async load(instanceId: string): Promise<CachedCatalog | null> {
       try {
         const filePath = this.getCachePath(instanceId);
         const content = await fs.promises.readFile(filePath, 'utf-8');
         return JSON.parse(content);
       } catch (error) {
         logger.debug('catalog.cache.miss', { instanceId });
         return null;
       }
     }

     async isStale(instanceId: string, maxAgeMs?: number): Promise<boolean> {
       const catalog = await this.load(instanceId);
       if (!catalog) return true;

       const age = Date.now() - new Date(catalog._meta.fetchedAt).getTime();
       return age > (maxAgeMs ?? this.maxAgeMs);
     }

     private getCachePath(instanceId: string): string {
       return path.join(this.cacheDir, `openrouter-${instanceId}.json`);
     }
   }
   ```

3. Run tests and commit

### Phase 3: Model Filtering Logic (2-3 hours)

#### Task 3.1: Extract Provider from Model ID
**Files to create:**
- `packages/core/src/providers/openrouter/utils.ts`
- `packages/core/src/providers/openrouter/utils.test.ts`

**What to do:**
1. Test file:
   ```typescript
   import { describe, it, expect } from 'vitest';
   import { extractProvider, convertPricing } from './utils';

   describe('OpenRouter Utils', () => {
     describe('extractProvider', () => {
       it('should extract provider from model ID', () => {
         expect(extractProvider('openai/gpt-4o')).toBe('openai');
         expect(extractProvider('anthropic/claude-3')).toBe('anthropic');
         expect(extractProvider('meta-llama/llama-3')).toBe('meta-llama');
       });

       it('should handle IDs without slash', () => {
         expect(extractProvider('gpt-4')).toBe('unknown');
       });
     });

     describe('convertPricing', () => {
       it('should convert string pricing to cost per million', () => {
         expect(convertPricing('0.0000025')).toBe(2.5);
         expect(convertPricing('0.00001')).toBe(10);
       });

       it('should handle zero pricing', () => {
         expect(convertPricing('0')).toBe(0);
       });
     });
   });
   ```

2. Implementation:
   ```typescript
   export function extractProvider(modelId: string): string {
     const parts = modelId.split('/');
     return parts.length > 1 ? parts[0] : 'unknown';
   }

   export function convertPricing(priceString: string): number {
     return parseFloat(priceString) * 1000000;
   }

   export function hasCapability(
     supportedParams: string[] | undefined,
     capability: string
   ): boolean {
     return supportedParams?.includes(capability) ?? false;
   }
   ```

3. Run tests and commit

#### Task 3.2: Implement Model Filter Service
**Files to create:**
- `packages/core/src/providers/openrouter/filter-service.ts`
- `packages/core/src/providers/openrouter/filter-service.test.ts`

**What to do:**
1. Comprehensive test file:
   ```typescript
   import { describe, it, expect } from 'vitest';
   import { ModelFilterService } from './filter-service';
   import type { OpenRouterModel } from './types';
   import type { ModelConfig } from '../catalog/types';

   describe('ModelFilterService', () => {
     const createModel = (overrides: Partial<OpenRouterModel> = {}): OpenRouterModel => ({
       id: 'openai/gpt-4',
       name: 'GPT-4',
       context_length: 8192,
       pricing: { prompt: '0.00003', completion: '0.00006' },
       supported_parameters: ['tools', 'temperature'],
       ...overrides
     });

     it('should filter by disabled providers', () => {
       const service = new ModelFilterService();
       const models = [
         createModel({ id: 'openai/gpt-4' }),
         createModel({ id: 'anthropic/claude' }),
         createModel({ id: 'google/gemini' })
       ];
       
       const config: ModelConfig = {
         enableNewModels: true,
         disabledProviders: ['google'],
         disabledModels: [],
       };

       const filtered = service.filterModels(models, config);
       expect(filtered).toHaveLength(2);
       expect(filtered.map(m => m.id)).not.toContain('google/gemini');
     });

     it('should filter by disabled models', () => {
       const service = new ModelFilterService();
       const models = [
         createModel({ id: 'openai/gpt-4' }),
         createModel({ id: 'openai/gpt-3.5' })
       ];
       
       const config: ModelConfig = {
         enableNewModels: true,
         disabledModels: ['openai/gpt-3.5'],
         disabledProviders: [],
       };

       const filtered = service.filterModels(models, config);
       expect(filtered).toHaveLength(1);
       expect(filtered[0].id).toBe('openai/gpt-4');
     });

     it('should filter by required parameters', () => {
       const service = new ModelFilterService();
       const models = [
         createModel({ supported_parameters: ['tools', 'temperature'] }),
         createModel({ supported_parameters: ['temperature'] }),
       ];
       
       const config: ModelConfig = {
         enableNewModels: true,
         disabledModels: [],
         disabledProviders: [],
         filters: {
           requiredParameters: ['tools']
         }
       };

       const filtered = service.filterModels(models, config);
       expect(filtered).toHaveLength(1);
     });

     it('should filter by max prompt cost', () => {
       const service = new ModelFilterService();
       const models = [
         createModel({ pricing: { prompt: '0.000003', completion: '0.000006' } }), // $3/M
         createModel({ pricing: { prompt: '0.00001', completion: '0.00002' } })   // $10/M
       ];
       
       const config: ModelConfig = {
         enableNewModels: true,
         disabledModels: [],
         disabledProviders: [],
         filters: {
           maxPromptCostPerMillion: 5.0
         }
       };

       const filtered = service.filterModels(models, config);
       expect(filtered).toHaveLength(1);
     });

     it('should filter by context length', () => {
       const service = new ModelFilterService();
       const models = [
         createModel({ context_length: 4096 }),
         createModel({ context_length: 128000 })
       ];
       
       const config: ModelConfig = {
         enableNewModels: true,
         disabledModels: [],
         disabledProviders: [],
         filters: {
           minContextLength: 32000
         }
       };

       const filtered = service.filterModels(models, config);
       expect(filtered).toHaveLength(1);
       expect(filtered[0].context_length).toBe(128000);
     });
   });
   ```

2. Implementation:
   ```typescript
   import type { OpenRouterModel } from './types';
   import type { ModelConfig } from '../catalog/types';
   import { extractProvider, convertPricing } from './utils';
   import { logger } from '~/utils/logger';

   export class ModelFilterService {
     filterModels(models: OpenRouterModel[], config: ModelConfig): OpenRouterModel[] {
       const startCount = models.length;
       
       const filtered = models.filter(model => {
         // Check disabled providers
         const provider = extractProvider(model.id);
         if (config.disabledProviders?.includes(provider)) {
           return false;
         }

         // Check disabled models
         if (config.disabledModels?.includes(model.id)) {
           return false;
         }

         // Apply filters if present
         if (config.filters) {
           const filters = config.filters;

           // Required parameters check
           if (filters.requiredParameters?.length) {
             const hasAll = filters.requiredParameters.every(param =>
               model.supported_parameters?.includes(param)
             );
             if (!hasAll) return false;
           }

           // Cost filters
           if (filters.maxPromptCostPerMillion !== undefined) {
             const cost = convertPricing(model.pricing.prompt);
             if (cost > filters.maxPromptCostPerMillion) return false;
           }

           if (filters.maxCompletionCostPerMillion !== undefined) {
             const cost = convertPricing(model.pricing.completion);
             if (cost > filters.maxCompletionCostPerMillion) return false;
           }

           // Context length filter
           if (filters.minContextLength !== undefined) {
             if (model.context_length < filters.minContextLength) return false;
           }
         }

         return true;
       });

       logger.debug('models.filtered', {
         original: startCount,
         filtered: filtered.length,
         removed: startCount - filtered.length
       });

       return filtered;
     }

     // Group models by provider
     groupByProvider(models: OpenRouterModel[]): Map<string, OpenRouterModel[]> {
       const groups = new Map<string, OpenRouterModel[]>();
       
       for (const model of models) {
         const provider = extractProvider(model.id);
         const group = groups.get(provider) ?? [];
         group.push(model);
         groups.set(provider, group);
       }

       return groups;
     }
   }
   ```

3. Run tests and commit

### Phase 4: Integration with Existing System (3-4 hours)

#### Task 4.1: Create Dynamic Catalog Provider
**Files to create:**
- `packages/core/src/providers/openrouter/dynamic-provider.ts`
- `packages/core/src/providers/openrouter/dynamic-provider.test.ts`

**What to do:**
1. Test file (with mocks):
   ```typescript
   import { describe, it, expect, vi, beforeEach } from 'vitest';
   import { OpenRouterDynamicProvider } from './dynamic-provider';
   import { getLaceDir } from '~/config/lace-dir';

   vi.mock('~/config/lace-dir');

   describe('OpenRouterDynamicProvider', () => {
     beforeEach(() => {
       (getLaceDir as any).mockReturnValue('/tmp/lace');
       global.fetch = vi.fn();
     });

     it('should fetch and cache catalog on first call', async () => {
       const mockResponse = {
         data: [
           {
             id: 'openai/gpt-4',
             name: 'GPT-4',
             context_length: 8192,
             pricing: { prompt: '0.00003', completion: '0.00006' },
             supported_parameters: ['tools']
           }
         ]
       };

       (global.fetch as any).mockResolvedValueOnce({
         ok: true,
         json: async () => mockResponse
       });

       const provider = new OpenRouterDynamicProvider('test-instance');
       const catalog = await provider.getCatalog('test-api-key');
       
       expect(catalog.models).toHaveLength(1);
       expect(fetch).toHaveBeenCalled();
     });

     it('should use cache when fresh', async () => {
       const provider = new OpenRouterDynamicProvider('test-instance');
       
       // First call - fetches from API
       (global.fetch as any).mockResolvedValueOnce({
         ok: true,
         json: async () => ({ data: [] })
       });
       await provider.getCatalog('test-api-key');
       
       // Second call - should use cache
       vi.clearAllMocks();
       await provider.getCatalog('test-api-key');
       
       expect(fetch).not.toHaveBeenCalled();
     });

     it('should apply model filters', async () => {
       const mockResponse = {
         data: [
           {
             id: 'openai/gpt-4',
             name: 'GPT-4',
             context_length: 8192,
             pricing: { prompt: '0.00003', completion: '0.00006' },
             supported_parameters: ['tools']
           },
           {
             id: 'google/gemini',
             name: 'Gemini',
             context_length: 32000,
             pricing: { prompt: '0.000001', completion: '0.000002' },
             supported_parameters: []
           }
         ]
       };

       (global.fetch as any).mockResolvedValueOnce({
         ok: true,
         json: async () => mockResponse
       });

       const config = {
         enableNewModels: true,
         disabledProviders: ['google'],
         disabledModels: [],
         filters: {}
       };

       const provider = new OpenRouterDynamicProvider('test-instance');
       const catalog = await provider.getCatalogWithConfig('test-api-key', config);
       
       expect(catalog.models).toHaveLength(1);
       expect(catalog.models[0].id).toBe('openai/gpt-4');
     });
   });
   ```

2. Implementation:
   ```typescript
   import { OpenRouterClient } from './client';
   import { CatalogCacheManager } from './cache-manager';
   import { ModelFilterService } from './filter-service';
   import type { ModelConfig } from '../catalog/types';
   import type { CatalogProvider } from '../catalog/types';
   import { getLaceDir } from '~/config/lace-dir';
   import { logger } from '~/utils/logger';

   export class OpenRouterDynamicProvider {
     private client: OpenRouterClient;
     private cacheManager: CatalogCacheManager;
     private filterService: ModelFilterService;
     private instanceId: string;

     constructor(instanceId: string) {
       this.instanceId = instanceId;
       this.client = new OpenRouterClient();
       this.cacheManager = new CatalogCacheManager(getLaceDir());
       this.filterService = new ModelFilterService();
     }

     async getCatalog(apiKey?: string): Promise<CatalogProvider> {
       // Check cache first
       const cached = await this.cacheManager.load(this.instanceId);
       const isStale = await this.cacheManager.isStale(this.instanceId);

       if (cached && !isStale) {
         logger.debug('catalog.using_cache', { instanceId: this.instanceId });
         return this.transformToCatalogProvider(cached.provider);
       }

       // Fetch fresh data
       try {
         const response = await this.client.fetchModels(apiKey);
         const catalog = {
           _meta: {
             fetchedAt: new Date().toISOString(),
             version: '1.0',
             modelCount: response.data.length,
             source: 'https://openrouter.ai/api/v1/models'
           },
           provider: {
             name: 'OpenRouter',
             id: 'openrouter',
             models: response.data
           }
         };

         await this.cacheManager.save(this.instanceId, catalog);
         logger.info('catalog.refreshed', { 
           instanceId: this.instanceId,
           modelCount: response.data.length 
         });

         return this.transformToCatalogProvider(catalog.provider);
       } catch (error) {
         logger.error('catalog.fetch_failed', { instanceId: this.instanceId, error });
         
         // Fall back to cache if available
         if (cached) {
           logger.warn('catalog.using_stale_cache', { instanceId: this.instanceId });
           return this.transformToCatalogProvider(cached.provider);
         }

         throw error;
       }
     }

     async getCatalogWithConfig(
       apiKey: string | undefined,
       config: ModelConfig
     ): Promise<CatalogProvider> {
       const catalog = await this.getCatalog(apiKey);
       
       // Apply filters
       const filtered = this.filterService.filterModels(
         catalog.models as any,
         config
       );

       return {
         ...catalog,
         models: this.transformModels(filtered)
       };
     }

     private transformToCatalogProvider(provider: any): CatalogProvider {
       return {
         name: provider.name,
         id: provider.id,
         type: 'openai', // OpenRouter uses OpenAI-compatible API
         api_endpoint: 'https://openrouter.ai/api/v1',
         default_large_model_id: 'anthropic/claude-3.5-sonnet',
         default_small_model_id: 'anthropic/claude-3.5-haiku',
         models: this.transformModels(provider.models)
       };
     }

     private transformModels(openRouterModels: any[]): any[] {
       return openRouterModels.map(model => ({
         id: model.id,
         name: model.name || model.id,
         cost_per_1m_in: parseFloat(model.pricing.prompt) * 1000000,
         cost_per_1m_out: parseFloat(model.pricing.completion) * 1000000,
         context_window: model.context_length,
         default_max_tokens: Math.min(4096, Math.floor(model.context_length / 4)),
         supports_attachments: model.supported_parameters?.includes('vision') ?? false,
         can_reason: model.supported_parameters?.includes('reasoning') ?? false,
       }));
     }
   }
   ```

3. Run tests and commit

#### Task 4.2: Update Provider Registry
**Files to modify:**
- `packages/core/src/providers/registry.ts`

**What to do:**
1. Add test to existing registry test file:
   ```typescript
   it('should support dynamic catalog for openrouter', async () => {
     const registry = ProviderRegistry.getInstance();
     const provider = await registry.getCatalogProvider('openrouter');
     
     expect(provider).toBeDefined();
     expect(provider.id).toBe('openrouter');
   });
   ```

2. Modify registry (find the getCatalogProviders method):
   ```typescript
   import { OpenRouterDynamicProvider } from './openrouter/dynamic-provider';

   async getCatalogProvider(providerId: string): Promise<CatalogProvider | null> {
     // Special handling for OpenRouter
     if (providerId === 'openrouter') {
       // Check if we have an instance with API key
       const instances = this.instanceManager.loadInstancesSync();
       const openRouterInstance = Object.entries(instances.instances)
         .find(([_, inst]) => inst.catalogProviderId === 'openrouter');
       
       if (openRouterInstance) {
         const [instanceId, instance] = openRouterInstance;
         const credential = this.instanceManager.loadCredential(instanceId);
         
         if (credential?.apiKey) {
           const provider = new OpenRouterDynamicProvider(instanceId);
           const config = instance.modelConfig ?? {
             enableNewModels: true,
             disabledModels: [],
             disabledProviders: []
           };
           
           try {
             return await provider.getCatalogWithConfig(credential.apiKey, config);
           } catch (error) {
             logger.warn('Failed to fetch dynamic catalog, using static', { error });
           }
         }
       }
     }

     // Fall back to static catalog
     return this.catalogManager.getProvider(providerId);
   }
   ```

3. Run existing tests to ensure nothing breaks
4. Commit

### Phase 5: Web UI Components (4-5 hours)

#### Task 5.1: Create Model Filter Bar Component
**Files to create:**
- `packages/web/components/providers/ModelFilterBar.tsx`
- `packages/web/components/providers/ModelFilterBar.test.tsx`

**What to do:**
1. Test file (using React Testing Library):
   ```typescript
   import { describe, it, expect, vi } from 'vitest';
   import { render, screen, fireEvent } from '@testing-library/react';
   import { ModelFilterBar } from './ModelFilterBar';

   describe('ModelFilterBar', () => {
     const defaultProps = {
       filters: {
         requiredParameters: [],
         minContextLength: undefined,
         maxPromptCostPerMillion: undefined,
       },
       onChange: vi.fn(),
     };

     it('should render capability checkboxes', () => {
       render(<ModelFilterBar {...defaultProps} />);
       
       expect(screen.getByLabelText('Tools')).toBeInTheDocument();
       expect(screen.getByLabelText('Vision')).toBeInTheDocument();
       expect(screen.getByLabelText('Reasoning')).toBeInTheDocument();
     });

     it('should call onChange when capability is toggled', () => {
       const onChange = vi.fn();
       render(<ModelFilterBar {...defaultProps} onChange={onChange} />);
       
       fireEvent.click(screen.getByLabelText('Tools'));
       
       expect(onChange).toHaveBeenCalledWith({
         requiredParameters: ['tools'],
         minContextLength: undefined,
         maxPromptCostPerMillion: undefined,
       });
     });

     it('should update context filter', () => {
       const onChange = vi.fn();
       render(<ModelFilterBar {...defaultProps} onChange={onChange} />);
       
       const select = screen.getByLabelText('Context Size');
       fireEvent.change(select, { target: { value: '32000' } });
       
       expect(onChange).toHaveBeenCalledWith({
         requiredParameters: [],
         minContextLength: 32000,
         maxPromptCostPerMillion: undefined,
       });
     });
   });
   ```

2. Component implementation:
   ```tsx
   'use client';

   import type { ChangeEvent } from 'react';

   interface ModelFilters {
     requiredParameters?: string[];
     minContextLength?: number;
     maxPromptCostPerMillion?: number;
   }

   interface ModelFilterBarProps {
     filters: ModelFilters;
     onChange: (filters: ModelFilters) => void;
   }

   const CAPABILITIES = [
     { id: 'tools', label: 'Tools' },
     { id: 'vision', label: 'Vision' },
     { id: 'reasoning', label: 'Reasoning' },
     { id: 'structured_outputs', label: 'Structured' },
     { id: 'function_calling', label: 'Functions' },
   ];

   export function ModelFilterBar({ filters, onChange }: ModelFilterBarProps) {
     const handleCapabilityChange = (capability: string, checked: boolean) => {
       const current = filters.requiredParameters ?? [];
       const updated = checked
         ? [...current, capability]
         : current.filter(c => c !== capability);
       
       onChange({ ...filters, requiredParameters: updated });
     };

     const handleContextChange = (e: ChangeEvent<HTMLSelectElement>) => {
       const value = e.target.value;
       onChange({
         ...filters,
         minContextLength: value ? parseInt(value, 10) : undefined,
       });
     };

     const handlePriceChange = (e: ChangeEvent<HTMLSelectElement>) => {
       const value = e.target.value;
       onChange({
         ...filters,
         maxPromptCostPerMillion: value ? parseFloat(value) : undefined,
       });
     };

     return (
       <div className="navbar bg-base-200 rounded-lg p-2">
         <div className="navbar-start">
           <div className="flex items-center gap-2">
             {CAPABILITIES.map((cap, index) => (
               <>
                 <label key={cap.id} className="flex items-center gap-1 px-2">
                   <input
                     type="checkbox"
                     className="checkbox checkbox-xs"
                     checked={filters.requiredParameters?.includes(cap.id) ?? false}
                     onChange={(e) => handleCapabilityChange(cap.id, e.target.checked)}
                     aria-label={cap.label}
                   />
                   <span className="text-xs">{cap.label}</span>
                 </label>
                 {index < CAPABILITIES.length - 1 && (
                   <div className="divider divider-horizontal m-0"></div>
                 )}
               </>
             ))}
           </div>
         </div>
         <div className="navbar-end gap-3">
           <select
             className="select select-xs select-bordered"
             value={filters.minContextLength ?? ''}
             onChange={handleContextChange}
             aria-label="Context Size"
           >
             <option value="">Any context</option>
             <option value="32000">&gt; 32k</option>
             <option value="100000">&gt; 100k</option>
             <option value="500000">&gt; 500k</option>
           </select>
           <select
             className="select select-xs select-bordered"
             value={filters.maxPromptCostPerMillion ?? ''}
             onChange={handlePriceChange}
             aria-label="Max Price"
           >
             <option value="">Any price</option>
             <option value="0">Free only</option>
             <option value="1">&lt; $1/M</option>
             <option value="5">&lt; $5/M</option>
             <option value="10">&lt; $10/M</option>
           </select>
         </div>
       </div>
     );
   }
   ```

3. Run tests and commit

#### Task 5.2: Create Provider Model Group Component
**Files to create:**
- `packages/web/components/providers/ProviderModelGroup.tsx`
- `packages/web/components/providers/ProviderModelGroup.test.tsx`

**What to do:**
1. Test file:
   ```typescript
   import { describe, it, expect, vi } from 'vitest';
   import { render, screen, fireEvent } from '@testing-library/react';
   import { ProviderModelGroup } from './ProviderModelGroup';

   describe('ProviderModelGroup', () => {
     const mockModels = [
       {
         id: 'openai/gpt-4',
         name: 'GPT-4',
         context_window: 8192,
         cost_per_1m_in: 30,
         cost_per_1m_out: 60,
         supports_attachments: false,
       },
       {
         id: 'openai/gpt-3.5',
         name: 'GPT-3.5',
         context_window: 4096,
         cost_per_1m_in: 0.5,
         cost_per_1m_out: 1.5,
         supports_attachments: false,
       },
     ];

     const defaultProps = {
       providerName: 'OpenAI',
       models: mockModels,
       enabledModels: ['openai/gpt-4'],
       onToggleProvider: vi.fn(),
       onToggleModel: vi.fn(),
     };

     it('should show enabled count', () => {
       render(<ProviderModelGroup {...defaultProps} />);
       expect(screen.getByText('1/2 enabled')).toBeInTheDocument();
     });

     it('should call onToggleProvider when provider checkbox clicked', () => {
       const onToggleProvider = vi.fn();
       render(<ProviderModelGroup {...defaultProps} onToggleProvider={onToggleProvider} />);
       
       const checkbox = screen.getByRole('checkbox', { name: /OpenAI provider toggle/i });
       fireEvent.click(checkbox);
       
       expect(onToggleProvider).toHaveBeenCalledWith('OpenAI', expect.any(Boolean));
     });

     it('should expand/collapse on click', () => {
       render(<ProviderModelGroup {...defaultProps} />);
       
       const header = screen.getByText('OpenAI');
       expect(screen.queryByText('GPT-4')).not.toBeInTheDocument();
       
       fireEvent.click(header.closest('.collapse-title')!);
       expect(screen.getByText('GPT-4')).toBeInTheDocument();
     });

     it('should format context size correctly', () => {
       render(<ProviderModelGroup {...defaultProps} />);
       
       const header = screen.getByText('OpenAI');
       fireEvent.click(header.closest('.collapse-title')!);
       
       expect(screen.getByText(/8k context/)).toBeInTheDocument();
       expect(screen.getByText(/4k context/)).toBeInTheDocument();
     });
   });
   ```

2. Component:
   ```tsx
   'use client';

   import { useState } from 'react';

   interface Model {
     id: string;
     name: string;
     context_window: number;
     cost_per_1m_in: number;
     cost_per_1m_out: number;
     supports_attachments?: boolean;
     can_reason?: boolean;
   }

   interface ProviderModelGroupProps {
     providerName: string;
     models: Model[];
     enabledModels: string[];
     onToggleProvider: (provider: string, enabled: boolean) => void;
     onToggleModel: (modelId: string, enabled: boolean) => void;
   }

   export function ProviderModelGroup({
     providerName,
     models,
     enabledModels,
     onToggleProvider,
     onToggleModel,
   }: ProviderModelGroupProps) {
     const [isExpanded, setIsExpanded] = useState(false);
     
     const enabledCount = models.filter(m => enabledModels.includes(m.id)).length;
     const isProviderEnabled = enabledCount > 0;

     const formatContext = (tokens: number): string => {
       if (tokens >= 1000000) return `${Math.floor(tokens / 1000000)}M`;
       if (tokens >= 1000) return `${Math.floor(tokens / 1000)}k`;
       return tokens.toString();
     };

     const formatPrice = (price: number): string => {
       return price === 0 ? 'FREE' : `$${price.toFixed(2)}`;
     };

     const getCapabilityBadges = (model: Model) => {
       const badges = [];
       if (model.supports_attachments) badges.push('vision');
       if (model.can_reason) badges.push('reasoning');
       // Check for 'tools' in supported_parameters if available
       if ((model as any).supported_parameters?.includes('tools')) {
         badges.push('tools');
       }
       return badges;
     };

     return (
       <div className="collapse collapse-arrow bg-base-200">
         <input 
           type="checkbox" 
           checked={isExpanded}
           onChange={(e) => setIsExpanded(e.target.checked)}
         />
         <div className="collapse-title py-3 min-h-0">
           <div className="flex justify-between items-center">
             <div className="flex items-center gap-3">
               <input
                 type="checkbox"
                 className="checkbox checkbox-sm"
                 checked={isProviderEnabled}
                 onChange={(e) => {
                   e.stopPropagation();
                   onToggleProvider(providerName, e.target.checked);
                 }}
                 onClick={(e) => e.stopPropagation()}
                 aria-label={`${providerName} provider toggle`}
               />
               <span className="font-semibold">{providerName}</span>
             </div>
             <span className="text-sm">{enabledCount}/{models.length} enabled</span>
           </div>
         </div>
         <div className="collapse-content">
           <div className="space-y-2 pt-2">
             {models.map(model => {
               const isEnabled = enabledModels.includes(model.id);
               const badges = getCapabilityBadges(model);
               
               return (
                 <label
                   key={model.id}
                   className={`flex items-center p-3 bg-base-100 rounded cursor-pointer hover:bg-base-300 transition-colors ${
                     !isEnabled ? 'opacity-60' : ''
                   }`}
                 >
                   <input
                     type="checkbox"
                     className="checkbox checkbox-sm mr-3"
                     checked={isEnabled}
                     onChange={(e) => onToggleModel(model.id, e.target.checked)}
                   />
                   <div className="flex-1">
                     <div className="flex justify-between items-start">
                       <div>
                         <span className="font-medium">{model.name}</span>
                         {model.cost_per_1m_in === 0 && (
                           <span className="badge badge-xs badge-success ml-2">FREE</span>
                         )}
                         <div className="text-xs opacity-70 mt-1">
                           {formatContext(model.context_window)} context • 
                           {formatPrice(model.cost_per_1m_in)} input / 
                           {formatPrice(model.cost_per_1m_out)} output per 1M
                         </div>
                       </div>
                       {badges.length > 0 && (
                         <div className="flex gap-1">
                           {badges.map(badge => (
                             <span key={badge} className="badge badge-xs badge-primary">
                               {badge}
                             </span>
                           ))}
                         </div>
                       )}
                     </div>
                   </div>
                 </label>
               );
             })}
           </div>
         </div>
       </div>
     );
   }
   ```

3. Run tests and commit

#### Task 5.3: Add Model Management State to Provider Card
**Files to modify:**
- `packages/web/components/providers/ProviderCatalogCard.tsx`

**What to do:**
1. First, examine the existing ProviderCatalogCard to understand its structure:
   ```bash
   cat packages/web/components/providers/ProviderCatalogCard.tsx
   ```

2. Add imports at the top:
   ```typescript
   import { ModelFilterBar } from './ModelFilterBar';
   import { ProviderModelGroup } from './ProviderModelGroup';
   import { useState, useEffect } from 'react';
   ```

3. Add state management inside the component:
   ```typescript
   export function ProviderCatalogCard({ provider, instance }: Props) {
     // Add these new state variables
     const [modelConfig, setModelConfig] = useState({
       enableNewModels: instance.modelConfig?.enableNewModels ?? true,
       disabledModels: instance.modelConfig?.disabledModels ?? [],
       disabledProviders: instance.modelConfig?.disabledProviders ?? [],
       filters: instance.modelConfig?.filters ?? {},
     });
     
     const [filteredModels, setFilteredModels] = useState(provider.models);
     const [searchQuery, setSearchQuery] = useState('');
     const [isRefreshing, setIsRefreshing] = useState(false);

     // Group models by provider
     const modelsByProvider = useMemo(() => {
       const groups = new Map<string, typeof provider.models>();
       filteredModels.forEach(model => {
         const providerName = model.id.split('/')[0] || 'unknown';
         const group = groups.get(providerName) || [];
         group.push(model);
         groups.set(providerName, group);
       });
       return groups;
     }, [filteredModels]);

     // Existing card content...
   }
   ```

4. Write test for the state management:
   ```typescript
   it('should initialize model config from instance', () => {
     const instance = {
       modelConfig: {
         enableNewModels: false,
         disabledModels: ['model-1'],
         disabledProviders: ['google'],
         filters: { requiredParameters: ['tools'] }
       }
     };
     
     render(<ProviderCatalogCard provider={mockProvider} instance={instance} />);
     // Verify initial state is set correctly
   });
   ```

5. Commit: `git commit -m "feat: add model management state to ProviderCatalogCard"`

#### Task 5.4: Add Search and Filter UI to Provider Card
**Files to modify:**
- `packages/web/components/providers/ProviderCatalogCard.tsx`

**What to do:**
1. Add the search bar and filter bar JSX (inside the card body, after the header):
   ```tsx
   {/* Only show for OpenRouter instances */}
   {provider.id === 'openrouter' && (
     <>
       {/* Search Bar */}
       <div className="mb-3">
         <input
           type="text"
           placeholder="Search models..."
           className="input input-bordered w-full"
           value={searchQuery}
           onChange={(e) => setSearchQuery(e.target.value)}
         />
       </div>

       {/* Filter Bar */}
       <ModelFilterBar
         filters={modelConfig.filters}
         onChange={(filters) => {
           setModelConfig(prev => ({ ...prev, filters }));
         }}
       />

       {/* Refresh Status */}
       <div className="flex justify-between items-center my-3">
         <span className="text-sm opacity-70">
           {provider.models.length} models available
         </span>
         <button
           className="btn btn-circle btn-sm btn-primary"
           onClick={handleRefresh}
           disabled={isRefreshing}
         >
           {isRefreshing ? (
             <span className="loading loading-spinner loading-xs"></span>
           ) : (
             <svg>...</svg> // Refresh icon
           )}
         </button>
       </div>
     </>
   )}
   ```

2. Add search filtering logic:
   ```typescript
   useEffect(() => {
     let filtered = provider.models;
     
     // Apply search
     if (searchQuery) {
       filtered = filtered.filter(model => 
         model.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
         model.name.toLowerCase().includes(searchQuery.toLowerCase())
       );
     }
     
     // Apply config filters (you'll implement this)
     filtered = applyModelFilters(filtered, modelConfig);
     
     setFilteredModels(filtered);
   }, [provider.models, searchQuery, modelConfig]);
   ```

3. Test the search functionality:
   ```typescript
   it('should filter models by search query', async () => {
     render(<ProviderCatalogCard provider={mockProvider} instance={instance} />);
     
     const searchInput = screen.getByPlaceholderText('Search models...');
     fireEvent.change(searchInput, { target: { value: 'gpt-4' } });
     
     await waitFor(() => {
       expect(screen.queryByText('claude-3')).not.toBeInTheDocument();
       expect(screen.getByText('gpt-4')).toBeInTheDocument();
     });
   });
   ```

4. Commit: `git commit -m "feat: add search and filter UI to provider card"`

#### Task 5.5: Add Model Groups Display
**Files to modify:**
- `packages/web/components/providers/ProviderCatalogCard.tsx`

**What to do:**
1. Add the model groups display (after the filter bar):
   ```tsx
   {/* Model Groups */}
   {provider.id === 'openrouter' && (
     <div className="space-y-2 mt-4">
       {Array.from(modelsByProvider.entries()).map(([providerName, models]) => (
         <ProviderModelGroup
           key={providerName}
           providerName={providerName}
           models={models}
           enabledModels={
             models
               .filter(m => !modelConfig.disabledModels.includes(m.id))
               .map(m => m.id)
           }
           onToggleProvider={(provider, enabled) => {
             handleToggleProvider(provider, enabled);
           }}
           onToggleModel={(modelId, enabled) => {
             handleToggleModel(modelId, enabled);
           }}
         />
       ))}
     </div>
   )}
   ```

2. Implement toggle handlers:
   ```typescript
   const handleToggleProvider = (providerName: string, enabled: boolean) => {
     setModelConfig(prev => {
       const updated = { ...prev };
       if (enabled) {
         // Remove provider from disabled list
         updated.disabledProviders = prev.disabledProviders.filter(
           p => p !== providerName
         );
         // Remove all models from this provider from disabled list
         const providerModels = Array.from(modelsByProvider.get(providerName) || []);
         updated.disabledModels = prev.disabledModels.filter(
           m => !providerModels.some(pm => pm.id === m)
         );
       } else {
         // Add provider to disabled list
         updated.disabledProviders = [...prev.disabledProviders, providerName];
       }
       return updated;
     });
   };

   const handleToggleModel = (modelId: string, enabled: boolean) => {
     setModelConfig(prev => ({
       ...prev,
       disabledModels: enabled
         ? prev.disabledModels.filter(m => m !== modelId)
         : [...prev.disabledModels, modelId]
     }));
   };
   ```

3. Test the toggle functionality:
   ```typescript
   it('should disable all models when provider is toggled off', async () => {
     render(<ProviderCatalogCard provider={mockOpenRouterProvider} instance={instance} />);
     
     const providerCheckbox = screen.getByLabelText('OpenAI provider toggle');
     fireEvent.click(providerCheckbox);
     
     await waitFor(() => {
       const config = getLastSavedConfig(); // Helper to get saved config
       expect(config.disabledProviders).toContain('openai');
     });
   });
   ```

4. Commit: `git commit -m "feat: add model groups display with toggle functionality"`

#### Task 5.6: Implement Refresh and Save Functionality
**Files to modify:**
- `packages/web/components/providers/ProviderCatalogCard.tsx`

**What to do:**
1. Add refresh handler:
   ```typescript
   const handleRefresh = async () => {
     setIsRefreshing(true);
     try {
       const response = await fetch(`/api/providers/${instance.id}/refresh`, {
         method: 'POST',
       });
       
       if (response.ok) {
         const updated = await response.json();
         // Update the provider data (you'll need to handle this via props/context)
         onProviderUpdated?.(updated);
       } else {
         console.error('Failed to refresh catalog');
       }
     } catch (error) {
       console.error('Error refreshing catalog:', error);
     } finally {
       setIsRefreshing(false);
     }
   };
   ```

2. Add save configuration handler:
   ```typescript
   const handleSaveConfig = async () => {
     try {
       const response = await fetch(`/api/instances/${instance.id}/config`, {
         method: 'PATCH',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ modelConfig }),
       });
       
       if (response.ok) {
         // Show success message
         toast?.success('Configuration saved');
       }
     } catch (error) {
       console.error('Error saving configuration:', error);
       toast?.error('Failed to save configuration');
     }
   };

   // Auto-save on config changes (debounced)
   useEffect(() => {
     const timer = setTimeout(() => {
       if (instance.id) {
         handleSaveConfig();
       }
     }, 1000); // 1 second debounce

     return () => clearTimeout(timer);
   }, [modelConfig]);
   ```

3. Test save functionality:
   ```typescript
   it('should auto-save configuration changes', async () => {
     const saveSpy = vi.fn();
     global.fetch = saveSpy;
     
     render(<ProviderCatalogCard provider={mockProvider} instance={instance} />);
     
     // Toggle a model
     const modelCheckbox = screen.getByLabelText('GPT-4 model toggle');
     fireEvent.click(modelCheckbox);
     
     // Wait for debounce
     await waitFor(() => {
       expect(saveSpy).toHaveBeenCalledWith(
         expect.stringContaining('/api/instances/'),
         expect.objectContaining({
           method: 'PATCH',
           body: expect.stringContaining('modelConfig')
         })
       );
     }, { timeout: 2000 });
   });
   ```

4. Commit: `git commit -m "feat: add refresh and auto-save functionality"`

### Phase 6: Testing & Documentation (2-3 hours)

#### Task 6.1: Integration Tests
**Files to create:**
- `packages/core/src/providers/openrouter/integration.test.ts`

**What to do:**
1. Create comprehensive integration test:
   ```typescript
   import { describe, it, expect, beforeEach, afterEach } from 'vitest';
   import { OpenRouterDynamicProvider } from './dynamic-provider';
   import * as fs from 'fs';
   import * as path from 'path';
   import { tmpdir } from 'os';

   describe('OpenRouter Integration', () => {
     let tempDir: string;

     beforeEach(() => {
       tempDir = fs.mkdtempSync(path.join(tmpdir(), 'lace-test-'));
       process.env.LACE_DIR = tempDir;
     });

     afterEach(() => {
       fs.rmSync(tempDir, { recursive: true });
       delete process.env.LACE_DIR;
     });

     it('should handle full refresh cycle', async () => {
       // This test would use real API if OPENROUTER_TEST_KEY is set
       const apiKey = process.env.OPENROUTER_TEST_KEY;
       if (!apiKey) {
         console.log('Skipping integration test - set OPENROUTER_TEST_KEY');
         return;
       }

       const provider = new OpenRouterDynamicProvider('test');
       
       // First fetch
       const catalog1 = await provider.getCatalog(apiKey);
       expect(catalog1.models.length).toBeGreaterThan(100);
       
       // Should use cache
       const catalog2 = await provider.getCatalog(apiKey);
       expect(catalog2).toEqual(catalog1);
       
       // Apply filters
       const filtered = await provider.getCatalogWithConfig(apiKey, {
         enableNewModels: true,
         disabledProviders: ['google'],
         disabledModels: [],
         filters: {
           requiredParameters: ['tools'],
           maxPromptCostPerMillion: 10
         }
       });
       
       expect(filtered.models.length).toBeLessThan(catalog1.models.length);
     });
   });
   ```

2. Run with: `OPENROUTER_TEST_KEY=your-key npm run test:integration`
3. Commit

#### Task 6.2: Update Documentation
**Files to create/modify:**
- `docs/providers/openrouter.md`
- `packages/core/src/providers/openrouter/README.md`

**What to do:**
1. Create user documentation:
   ```markdown
   # OpenRouter Dynamic Catalogs

   ## Overview
   OpenRouter provides access to 500+ AI models that change daily. Lace fetches
   the latest model catalog directly from OpenRouter's API.

   ## Setup
   1. Get an API key from https://openrouter.ai
   2. Configure your OpenRouter instance in Settings
   3. Models will refresh automatically daily

   ## Filtering Models
   Use the filter bar to:
   - Filter by capabilities (Tools, Vision, Reasoning)
   - Set minimum context window size
   - Set maximum price per million tokens

   ## Provider Management
   - Click provider checkbox to enable/disable all models
   - Individual models can be toggled on/off
   - Settings are saved per instance

   ## Troubleshooting
   - If models don't load, check your API key
   - Use Refresh button to manually update
   - Cache is stored in LACE_DIR/catalogs/
   ```

2. Create developer README:
   ```markdown
   # OpenRouter Dynamic Provider

   ## Architecture
   - `client.ts` - API communication
   - `cache-manager.ts` - Local caching
   - `filter-service.ts` - Model filtering
   - `dynamic-provider.ts` - Main integration

   ## Testing
   ```bash
   # Unit tests
   npm run test:unit src/providers/openrouter

   # Integration (needs API key)
   OPENROUTER_TEST_KEY=xxx npm run test:integration
   ```

   ## Adding New Filters
   1. Add to ModelConfigSchema in types.ts
   2. Implement in filter-service.ts
   3. Add UI in ModelFilterBar.tsx
   ```

3. Commit

### Phase 7: Final Integration & Testing (2 hours)

#### Task 7.1: Manual Testing Checklist
Create `test-checklist.md`:
```markdown
# OpenRouter Testing Checklist

## Setup
- [ ] Fresh install
- [ ] Add OpenRouter instance
- [ ] Enter API key
- [ ] Verify initial fetch works

## Filtering
- [ ] Toggle each capability filter
- [ ] Test context size filters
- [ ] Test price filters
- [ ] Verify counts update

## Provider Management
- [ ] Toggle provider on/off
- [ ] Toggle individual models
- [ ] Verify settings persist

## Refresh
- [ ] Manual refresh works
- [ ] Stale cache warning appears
- [ ] Fallback to cache on API error

## Edge Cases
- [ ] Invalid API key handling
- [ ] Network timeout
- [ ] Empty results
- [ ] 500+ models performance
```

#### Task 7.2: Performance Testing
```typescript
// Performance test
it('should handle 500+ models efficiently', () => {
  const models = Array.from({ length: 500 }, (_, i) => ({
    id: `provider-${i % 50}/model-${i}`,
    name: `Model ${i}`,
    context_length: 4096 * (i % 10 + 1),
    pricing: { prompt: '0.001', completion: '0.002' }
  }));

  const start = performance.now();
  const filtered = filterService.filterModels(models, config);
  const duration = performance.now() - start;
  
  expect(duration).toBeLessThan(100); // Should filter in <100ms
});
```

## Commit Message Format

Use conventional commits:
- `feat:` New feature
- `fix:` Bug fix
- `test:` Test additions
- `docs:` Documentation
- `refactor:` Code refactoring
- `chore:` Maintenance

Examples:
```
feat: add OpenRouter dynamic catalog support
test: add ModelFilterBar component tests
docs: document OpenRouter setup process
fix: handle API rate limiting correctly
```

## Common Issues & Solutions

1. **TypeScript Errors**: Run `npm run lint` to check
2. **Test Failures**: Check mocks match actual API
3. **Import Errors**: Use `~/` prefix for internal imports
4. **React Errors**: Ensure client components have 'use client'
5. **Async Issues**: Always await promises or use void

## Final Checklist

Before considering complete:
- [ ] All tests passing
- [ ] Linting passes
- [ ] Documentation updated
- [ ] Manual testing completed
- [ ] Code reviewed
- [ ] Performance acceptable with 500+ models