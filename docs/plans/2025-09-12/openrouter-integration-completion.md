# OpenRouter Integration - Final Steps

## Overview
This document covers the remaining integration work needed to complete the OpenRouter dynamic catalog feature after Phase 6 implementation.

## Completed Work
- ✅ Phase 1-3: Data models, API client, filtering logic
- ✅ Phase 4: Dynamic provider and registry integration  
- ✅ Phase 5: UI components (ModelFilterBar, ProviderModelGroup, etc.)
- ✅ Phase 6: Testing and documentation

## Remaining Integration Tasks

### 1. API Endpoints

#### 1.1 Refresh Catalog Endpoint
**File:** `packages/web/app/routes/api.provider.instances.$instanceId.refresh.ts`

**Purpose:** Manually trigger catalog refresh for an OpenRouter instance

**Implementation:**
```typescript
POST /api/provider/instances/:instanceId/refresh
Response: { success: boolean, modelCount: number, lastUpdated: string }
```

#### 1.2 Update Model Config Endpoint  
**File:** `packages/web/app/routes/api.provider.instances.$instanceId.config.ts`

**Purpose:** Save model filtering configuration

**Implementation:**
```typescript
PATCH /api/provider/instances/:instanceId/config
Body: { modelConfig: ModelConfig }
Response: { success: boolean }
```

### 2. Route Registration

**File:** `packages/web/app/routes.ts`

Add new routes:
```typescript
export const routes = {
  // ... existing routes
  
  provider: {
    instances: {
      refresh: (instanceId: string) => 
        `/api/provider/instances/${instanceId}/refresh`,
      config: (instanceId: string) => 
        `/api/provider/instances/${instanceId}/config`,
    }
  }
}
```

### 3. Parent Component Updates

#### 3.1 ProviderInstanceList Component
**File:** `packages/web/components/providers/ProviderInstanceList.tsx`

**Changes needed:**
1. Fetch catalog data from `/api/provider/catalog`
2. Match catalog providers with instances
3. Pass catalog data to ProviderInstanceCard components

```typescript
const ProviderInstanceList = () => {
  const [catalogs, setCatalogs] = useState<CatalogProvider[]>([]);
  
  useEffect(() => {
    fetch('/api/provider/catalog')
      .then(res => res.json())
      .then(data => setCatalogs(data.providers));
  }, []);
  
  // Match instances with catalog data
  const instancesWithCatalog = instances.map(instance => ({
    instance,
    catalog: catalogs.find(c => c.id === instance.catalogProviderId)
  }));
  
  return instancesWithCatalog.map(({ instance, catalog }) => (
    <ProviderInstanceCard 
      key={instance.id}
      instance={instance}
      provider={catalog}
    />
  ));
};
```

### 4. Missing Dynamic Provider Method

**File:** `packages/core/src/providers/openrouter/dynamic-provider.ts`

Add `refreshCatalog` method that forces a fresh fetch:
```typescript
async refreshCatalog(apiKey: string): Promise<CatalogProvider> {
  // Bypass cache, always fetch fresh
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
  return this.transformToCatalogProvider(catalog.provider);
}
```

### 5. Instance Manager Extension

**File:** `packages/core/src/providers/instance/manager.ts`

Add method to update model config:
```typescript
async updateModelConfig(
  instanceId: string,
  modelConfig: ModelConfig
): Promise<void> {
  const config = await this.loadInstances();
  const instance = config.instances[instanceId];
  
  if (!instance) {
    throw new Error(`Instance not found: ${instanceId}`);
  }
  
  config.instances[instanceId] = {
    ...instance,
    modelConfig
  };
  
  await this.saveInstances(config);
}
```

### 6. Error Handling & Loading States

#### 6.1 Add Loading State to ProviderInstanceCard
```typescript
const [isLoading, setIsLoading] = useState(false);
const [error, setError] = useState<string | null>(null);

// Show loading spinner during refresh
{isLoading && <div className="loading loading-spinner" />}

// Show error message if refresh fails  
{error && <Alert variant="error" message={error} />}
```

#### 6.2 Add Error Boundary
**File:** `packages/web/components/providers/ProviderErrorBoundary.tsx`
```typescript
export class ProviderErrorBoundary extends Component {
  state = { hasError: false, error: null };
  
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  
  render() {
    if (this.state.hasError) {
      return <Alert variant="error" message="Failed to load provider" />;
    }
    return this.props.children;
  }
}
```

### 7. Toast Notifications

Install and configure toast library:
```bash
npm install sonner
```

Add to root layout:
```typescript
import { Toaster } from 'sonner';

export default function RootLayout() {
  return (
    <>
      {children}
      <Toaster position="bottom-right" />
    </>
  );
}
```

Use in components:
```typescript
import { toast } from 'sonner';

const handleSave = async () => {
  try {
    await saveConfig();
    toast.success('Configuration saved');
  } catch (error) {
    toast.error('Failed to save configuration');
  }
};
```

## Testing Checklist

### Manual Testing
- [ ] Create new OpenRouter instance
- [ ] Enter API key
- [ ] Verify models load (should see 500+ models)
- [ ] Test search functionality
- [ ] Test capability filters (tools, vision, etc.)
- [ ] Test context size filters
- [ ] Test price filters
- [ ] Toggle provider on/off
- [ ] Toggle individual models
- [ ] Verify settings persist after refresh
- [ ] Test manual refresh button
- [ ] Verify error handling for bad API key
- [ ] Test performance with all models visible

### Integration Testing
```bash
# Test with real API
TEST_LIVE_API=true npm run test:integration

# Test specific flow
npm test -- --run providers/openrouter/integration
```

### End-to-End Testing
```typescript
// e2e/openrouter.spec.ts
test('OpenRouter full flow', async ({ page }) => {
  // Create instance
  await page.goto('/settings/providers');
  await page.click('text=Add Provider');
  await page.selectOption('select', 'openrouter');
  await page.fill('[name=apiKey]', process.env.OPENROUTER_TEST_KEY);
  await page.click('text=Save');
  
  // Wait for models to load
  await page.waitForSelector('text=/\\d+ models/');
  
  // Test filtering
  await page.fill('[placeholder="Search models..."]', 'gpt-4');
  await expect(page.locator('.model-item')).toHaveCount(5); // Assuming ~5 GPT-4 variants
  
  // Test toggle
  await page.click('text=OpenAI'); // Click provider
  await page.click('[aria-label="OpenAI provider toggle"]');
  
  // Verify saved
  await page.reload();
  await expect(page.locator('[aria-label="OpenAI provider toggle"]')).not.toBeChecked();
});
```

## Deployment Considerations

1. **Cache Directory**: Ensure LACE_DIR/catalogs/ exists and is writable
2. **API Rate Limits**: OpenRouter may rate limit - implement exponential backoff
3. **Large Payload**: 500+ models is ~500KB JSON - consider pagination
4. **Performance**: Use virtualization for model list if sluggish

## Future Enhancements

1. **Model Comparison View**: Side-by-side comparison of selected models
2. **Favorites**: Star frequently used models for quick access
3. **Usage Analytics**: Track which models are actually used
4. **Cost Calculator**: Estimate costs based on usage patterns
5. **Keyboard Shortcuts**: 
   - `/` to focus search
   - `r` to refresh
   - `s` to save
6. **Export/Import**: Share model configurations between instances
7. **Presets**: Save filter combinations as presets