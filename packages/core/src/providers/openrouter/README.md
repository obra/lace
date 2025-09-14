# OpenRouter Dynamic Provider

## Architecture Overview

The OpenRouter Dynamic Provider replaces static JSON catalogs with real-time API-fetched model data, providing access to 300+ constantly-changing AI models with sophisticated filtering and caching.

### Core Components

```
OpenRouterDynamicProvider (Main orchestrator)
├── OpenRouterClient (API communication)  
├── CatalogCacheManager (Local caching with staleness)
├── ModelFilterService (Configuration-based filtering)
└── Utility functions (Provider extraction, pricing conversion)
```

### Data Flow

```
OpenRouter API (/api/v1/models)
    ↓ [Fetch with optional API key]
OpenRouterClient
    ↓ [Validate with Zod schemas]
CachedCatalog (LACE_DIR/catalogs/openrouter-{instanceId}.json)
    ↓ [Apply ModelConfig filters]
FilteredModelList
    ↓ [Transform to Lace catalog format]
ProviderRegistry.getCatalogProvider('openrouter')
    ↓ [Used by UI components]
Enhanced ProviderInstanceCard (Web UI)
```

## File Structure

```
src/providers/openrouter/
├── types.ts                    # OpenRouter API response schemas
├── types.test.ts              # Type validation tests (5 tests)
├── client.ts                  # API communication layer
├── client.test.ts             # API client tests (6 tests)
├── cache-manager.ts           # Local caching with staleness detection
├── cache-manager.test.ts      # Cache tests (7 tests)
├── utils.ts                   # Provider extraction, pricing conversion
├── utils.test.ts              # Utility function tests (13 tests)
├── filter-service.ts          # Model filtering engine
├── filter-service.test.ts     # Filter tests + performance (15 tests)
├── dynamic-provider.ts        # Main orchestrator class
├── dynamic-provider.test.ts   # Integration tests (8 tests)
├── integration.test.ts        # End-to-end tests (5 tests)
├── capture-fixtures.ts        # Script to update test fixtures
└── fixtures/
    ├── models-response.json       # Full API response (331 models)
    └── models-response-test.json  # Test subset (10 models)
```

## API Integration

### OpenRouter API Client

```typescript
const client = new OpenRouterClient();

// Fetch all models (no auth required)
const response = await client.fetchModels();

// Fetch with API key (may show additional models)
const response = await client.fetchModels('sk-or-v1-...');
```

**Response Structure**: Validated with `OpenRouterResponseSchema`
- `data[]`: Array of model objects
- Each model has: `id`, `name`, `context_length`, `pricing`, `supported_parameters`

### Cache Management

```typescript
const cache = new CatalogCacheManager('/path/to/lace/dir');

// Save with metadata
await cache.save('instance-id', {
  _meta: {
    fetchedAt: new Date().toISOString(),
    version: '1.0',
    modelCount: 331,
    source: 'https://openrouter.ai/api/v1/models'
  },
  provider: { name: 'OpenRouter', id: 'openrouter', models: [...] }
});

// Load and check staleness
const cached = await cache.load('instance-id');
const isStale = await cache.isStale('instance-id'); // 24h default
```

**Cache Location**: `LACE_DIR/catalogs/openrouter-{instanceId}.json`

### Model Filtering

```typescript
const filter = new ModelFilterService();

const filtered = filter.filterModels(models, {
  enableNewModels: true,
  disabledProviders: ['google', 'bytedance'],
  disabledModels: ['openai/gpt-3.5-turbo'],
  filters: {
    requiredParameters: ['tools'],
    maxPromptCostPerMillion: 10.0,
    minContextLength: 32000
  }
});

const grouped = filter.groupByProvider(filtered);
```

**Filter Priority**: Provider → Model → Capabilities → Cost → Context

## Testing

### Running Tests

```bash
# All OpenRouter tests (57 tests)
npm run test:unit src/providers/openrouter

# Specific component tests
npx vitest --run src/providers/openrouter/client.test.ts
npx vitest --run src/providers/openrouter/filter-service.test.ts

# Integration tests with real API (optional)
OPENROUTER_TEST_KEY=sk-or-v1-... npm run test:integration

# Performance tests only
npx vitest --run src/providers/openrouter/filter-service.test.ts -t "performance"
```

### Test Categories

1. **Unit Tests** (52 tests): Individual component behavior
2. **Integration Tests** (5 tests): End-to-end workflows, cache persistence
3. **Performance Tests** (3 tests): 500+ model filtering efficiency
4. **Real API Tests** (2 tests): Optional live API integration

### Performance Benchmarks

- **500 model filtering**: <100ms (typical: ~0.16ms)
- **500 model grouping**: <50ms (typical: ~1ms)
- **API request + caching**: <2000ms
- **Schema validation**: <10ms

## Configuration Schema

### ModelConfig Interface

```typescript
interface ModelConfig {
  enableNewModels: boolean;        // Default: true
  disabledModels: string[];        // Model IDs to exclude
  disabledProviders: string[];     // Provider names to exclude
  filters?: {
    requiredParameters?: string[];           // ['tools', 'vision', etc.]
    maxPromptCostPerMillion?: number;        // Cost limit for input
    maxCompletionCostPerMillion?: number;    // Cost limit for output  
    minContextLength?: number;               // Minimum context window
  };
}
```

### Example Configuration

```json
{
  "displayName": "OpenRouter Main",
  "catalogProviderId": "openrouter",
  "modelConfig": {
    "enableNewModels": true,
    "disabledProviders": ["bytedance", "meituan"],
    "disabledModels": ["openai/gpt-3.5-turbo"],
    "filters": {
      "requiredParameters": ["tools"],
      "maxPromptCostPerMillion": 5.0,
      "minContextLength": 32000
    }
  }
}
```

## Adding New Filters

### 1. Extend the Schema

Add new filter options to `ModelConfigSchema` in `types.ts`:

```typescript
export const ModelConfigSchema = z.object({
  // existing fields...
  filters: z.object({
    // existing filters...
    newFilter: z.string().optional(),
  }).optional(),
});
```

### 2. Implement Filter Logic

Add filtering logic in `filter-service.ts`:

```typescript
// In filterModels method
if (filters.newFilter !== undefined) {
  if (!modelMeetsNewFilterCriteria(model, filters.newFilter)) {
    return false;
  }
}
```

### 3. Add UI Component

Add filter control to `ModelFilterBar.tsx`:

```tsx
<select
  className="select select-xs select-bordered"
  value={filters.newFilter ?? ''}
  onChange={handleNewFilterChange}
>
  <option value="">Any value</option>
  <option value="option1">Option 1</option>
</select>
```

### 4. Write Tests

Add test cases to `filter-service.test.ts`:

```typescript
it('should filter by new criteria', () => {
  const filtered = service.filterModels(models, {
    filters: { newFilter: 'value' }
  });
  expect(filtered).toHaveLength(expectedCount);
});
```

## Error Handling

### API Failures

```typescript
try {
  const catalog = await provider.getCatalog(apiKey);
} catch (error) {
  // Falls back to cached data if available
  // Throws error only if no cache exists
}
```

### Common Error Types

- **Network errors**: Internet connectivity issues
- **API errors**: OpenRouter service unavailable (500, 503)
- **Auth errors**: Invalid API key (401, 403)
- **Rate limiting**: Too many requests (429)
- **Schema errors**: API response format changed

### Recovery Strategies

1. **Cache fallback**: Use stale data when API fails
2. **Retry logic**: Exponential backoff for transient errors
3. **Graceful degradation**: Show static catalog as last resort
4. **User feedback**: Clear error messages in UI

## Performance Optimization

### Caching Strategy

- **Cache duration**: 24 hours (configurable)
- **Cache location**: `LACE_DIR/catalogs/openrouter-{instanceId}.json`
- **Cache metadata**: Includes fetch time, model count, API source
- **Staleness detection**: Age-based with fallback support

### UI Optimization

- **Conditional rendering**: Model management only for OpenRouter instances
- **Debounced search**: 300ms delay to prevent excessive filtering
- **Lazy expansion**: Provider groups collapsed by default
- **Virtual scrolling**: Considered for 500+ model lists

### Memory Management

- **Immutable filtering**: No mutation of original model arrays
- **Efficient grouping**: Single-pass provider extraction
- **Minimal re-renders**: Memoized provider grouping
- **Cache cleanup**: Automatic garbage collection of old cache files

## Integration Points

### With Provider Registry

```typescript
// Registry automatically detects OpenRouter instances
const catalog = await registry.getCatalogProvider('openrouter');
// Returns dynamic data if instance configured, static data otherwise
```

### With Provider Instances

```typescript
// Instance configuration includes model filtering
const instance = {
  catalogProviderId: 'openrouter',
  modelConfig: { /* filtering config */ }
};
```

### With Web UI

```typescript
// ProviderInstanceCard conditionally shows model management
{provider && instance.catalogProviderId === 'openrouter' && (
  <ModelManagementSection />
)}
```

## Debugging

### Enable Debug Logging

```bash
LACE_LOG_LEVEL=debug npm run dev
```

**Debug Events**:
- `catalog.cache.saved` - Cache write operations
- `catalog.cache.miss` - Cache lookup failures  
- `catalog.using_cache` - Cache hit confirmations
- `catalog.refreshed` - Fresh API data fetched
- `models.filtered` - Filter operation results

### Common Debug Scenarios

```bash
# Check cache contents
cat $LACE_DIR/catalogs/openrouter-*.json | jq '._meta'

# Test API connectivity
curl https://openrouter.ai/api/v1/models

# Validate model filtering
npx vitest --run src/providers/openrouter/filter-service.test.ts -t "filter"

# Performance profiling
npx vitest --run src/providers/openrouter/filter-service.test.ts -t "performance"
```

## Contributing

### Before Making Changes

1. **Read the architecture docs**: Understand the event-sourcing foundation
2. **Follow TDD**: Write failing tests first, then implement
3. **Run all tests**: `npm run test:unit src/providers/openrouter`
4. **Check performance**: Ensure 500+ model handling stays fast
5. **Update docs**: Keep this README current

### Code Style

- **Strict TypeScript**: No `any` types, prefer `unknown` with type guards
- **Immutable patterns**: Never mutate input arrays or objects
- **Error handling**: Graceful degradation, not crashes
- **Logging**: Use structured logging with context
- **Testing**: Comprehensive coverage with real-world scenarios

---

*This implementation provides a robust, performant, and user-friendly interface to OpenRouter's dynamic model catalog while maintaining backward compatibility with Lace's existing provider system.*