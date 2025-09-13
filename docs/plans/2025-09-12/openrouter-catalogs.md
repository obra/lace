# OpenRouter Dynamic Catalog System

## Overview

OpenRouter provides access to 500+ AI models (177 with tool support) from various providers, with models changing daily. This system replaces static JSON catalogs with dynamic API-based fetching for OpenRouter instances, while maintaining backward compatibility with other providers.

## Problem Statement

- OpenRouter's model catalog changes daily (new models, pricing updates, capability changes)
- Static JSON files from Catwalk become stale quickly for OpenRouter
- Users need ability to filter 500+ models to find relevant ones
- Different OpenRouter instances may need different model subsets

## Solution

Dynamic catalog fetching system that:
1. Fetches fresh model data from OpenRouter's API
2. Caches locally with daily refresh
3. Provides per-instance model filtering and configuration
4. Falls back gracefully to cached data on API failures

## Architecture

### Data Flow

```
OpenRouter API (/api/v1/models)
    ↓ [Fetch with API key]
DynamicCatalogFetcher
    ↓ [Cache with metadata]
LACE_DIR/catalogs/openrouter-{instanceId}.json
    ↓ [Apply filters]
FilteredModelList
    ↓ [Display]
UI Components (ModelSelector, ProviderCard)
```

### Cache Structure

Location: `LACE_DIR/catalogs/openrouter-{instanceId}.json`

```json
{
  "_meta": {
    "fetchedAt": "2024-01-15T10:30:00Z",
    "version": "1.0",
    "modelCount": 523,
    "source": "https://openrouter.ai/api/v1/models"
  },
  "provider": {
    "name": "OpenRouter",
    "id": "openrouter",
    "type": "openai",
    "models": [
      {
        "id": "openai/gpt-4o",
        "name": "GPT-4o",
        "context_length": 128000,
        "pricing": {
          "prompt": "0.0000025",
          "completion": "0.00001"
        },
        "supported_parameters": ["tools", "temperature", "top_p"],
        "architecture": {
          "modality": "text->text",
          "tokenizer": "cl100k_base"
        }
      }
    ]
  }
}
```

### Configuration Schema

Extended `ProviderInstance` in `provider-instances.json`:

```json
{
  "openrouter-main": {
    "displayName": "OpenRouter Main",
    "catalogProviderId": "openrouter",
    "endpoint": "https://openrouter.ai/api/v1",
    "modelConfig": {
      "enableNewModels": true,
      "disabledModels": ["model-id-1", "model-id-2"],
      "disabledProviders": ["bytedance", "meituan"],
      "filters": {
        "requiredParameters": ["tools"],
        "maxPromptCostPerMillion": 5.0,
        "maxCompletionCostPerMillion": 10.0,
        "minContextLength": 32000
      }
    }
  }
}
```

### Model Filtering Rules

Applied in order:
1. **Provider Filter**: Skip if model's provider (extracted from ID) is in `disabledProviders`
2. **Model Filter**: Skip if model ID is in `disabledModels`
3. **New Model Policy**: New models (not in disabled lists) follow `enableNewModels` setting
4. **Capability Filter**: Must have all parameters in `requiredParameters`
5. **Cost Filter**: Must be within `maxPromptCostPerMillion` and `maxCompletionCostPerMillion`
6. **Context Filter**: Must meet `minContextLength` requirement

### Refresh Strategy

1. **On Application Startup**: Check cache age, refresh if >24 hours old
2. **Daily Auto-refresh**: Background task at 3 AM local time
3. **Manual Refresh**: User-triggered via UI button
4. **On Instance Creation**: Fetch immediately for new instances

### Error Handling

- **API Failure**: Use most recent cached catalog, display warning
- **No Cache**: Fall back to static JSON from Catwalk
- **Invalid API Key**: Show configuration error in UI
- **Rate Limiting**: Exponential backoff with max 3 retries

## UI Design

### Provider Instance Card

```
┌─────────────────────────────────────────┐
│ OpenRouter Main               [Refresh] │
│ Last sync: 2 hours ago                  │
├─────────────────────────────────────────┤
│ [Search models...]                      │
├─────────────────────────────────────────┤
│ ☑ Tools  ☐ Vision  ☐ Reasoning         │
│ Context: [Any ▼]  Price: [< $5/M ▼]    │
├─────────────────────────────────────────┤
│ ▼ ☑ OpenAI                   8/12       │
│   ☑ GPT-4o                             │
│     128k • $2.50/$10.00 • tools,vision │
│   ☑ GPT-4 Turbo                        │
│     128k • $10/$30 • tools             │
│ ▶ ☑ Anthropic                6/8       │
│ ▶ ☐ Google                   0/6       │
└─────────────────────────────────────────┘
```

### Key UI Features

- **Filter Bar**: Capability checkboxes, context/price dropdowns
- **Provider Groups**: Collapsible with enable count (X/Y format)
- **Model Details**: Name, context window, pricing, capabilities
- **Search**: Real-time filtering by model/provider name
- **Bulk Actions**: Provider-level enable/disable toggle

## API Endpoints

### OpenRouter API

**GET /api/v1/models**
- Returns all available models
- No authentication required for basic info
- Response includes pricing, capabilities, context windows

**GET /api/v1/models/user** (with auth)
- Returns user-filtered models based on preferences
- Requires API key authentication

## Implementation Components

### Core Classes

1. **DynamicCatalogProvider**: Extends base provider for dynamic catalogs
2. **OpenRouterCatalogFetcher**: Handles API communication and caching
3. **ModelFilterService**: Applies configuration filters to model lists
4. **CatalogCacheManager**: Manages cache lifecycle and invalidation

### File Modifications

- `packages/core/src/providers/catalog/types.ts` - Add modelConfig to schema
- `packages/core/src/providers/instance/manager.ts` - Support modelConfig persistence
- `packages/core/src/providers/registry.ts` - Integrate dynamic catalog support
- `packages/web/components/providers/ProviderCatalogCard.tsx` - Add model management UI
- `packages/web/components/ui/ModelSelector.tsx` - Use filtered model lists

## Testing Strategy

1. **Unit Tests**: Filter logic, cache management, API client
2. **Integration Tests**: Full refresh cycle, fallback behavior
3. **E2E Tests**: UI interactions, configuration persistence
4. **Manual Testing**: Rate limiting, error states, performance with 500+ models

## Performance Considerations

- Cache processed/filtered results to avoid recomputation
- Virtualize long model lists in UI (>100 items)
- Debounce search input (300ms)
- Lazy load provider groups (expand on demand)

## Security Considerations

- API keys stored in secure credential storage (existing system)
- Cache files respect LACE_DIR permissions
- No sensitive data in provider-instances.json
- Rate limit API calls to prevent abuse

## Migration Path

1. Existing OpenRouter instances continue using static catalog initially
2. On first access after update, prompt for API key if not present
3. Fetch dynamic catalog, cache locally
4. Static catalog remains as fallback

## Future Enhancements

- Model search by capability combinations
- Cost calculator/estimator
- Usage analytics per model
- Favorite models list
- Model comparison view
- Export/import model configurations