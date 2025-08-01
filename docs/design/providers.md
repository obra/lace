# Provider Configuration System Design

## Overview

This document describes the configurable provider system that allows users to configure multiple instances of different AI providers with distinct endpoints, credentials, and configurations.

## Architecture

### Three-Tier System

1. **Provider Catalogs**: Metadata about available providers and models (from Catwalk data + user extensions)
2. **Provider Instances**: User connection configurations (credentials, endpoints, timeouts) 
3. **Agent Model Selection**: Runtime selection of specific models from configured instances

### Key Components

```
src/providers/
├── catalog/
│   ├── types.ts              # Catalog and instance type definitions
│   ├── manager.ts            # Loads and manages provider catalogs
│   └── data/                 # Catwalk JSON files
├── instance/
│   └── manager.ts            # Manages user provider instances
├── migration.ts              # Migrates env vars to new system
└── registry.ts               # Updated to use catalog + instances
```

## Data Models

### Provider Catalog (from Catwalk)
```typescript
interface CatalogProvider {
  id: string;                    // "openai"
  name: string;                  // "OpenAI"  
  type: string;                  // "openai"
  api_endpoint?: string;         // Default endpoint
  default_large_model_id: string;
  default_small_model_id: string;
  models: CatalogModel[];
}

interface CatalogModel {
  id: string;                    // "gpt-4o"
  name: string;                  // "GPT-4o"
  cost_per_1m_in: number;        // 2.5
  cost_per_1m_out: number;       // 10.0
  context_window: number;        // 128000
  default_max_tokens: number;    // 4096
  can_reason?: boolean;
  supports_attachments?: boolean;
}
```

### Provider Instance (user configuration)
```typescript
interface ProviderInstance {
  displayName: string;           // "OpenAI Production"
  catalogProviderId: string;     // References catalog provider
  endpoint?: string;             // Custom endpoint override
  timeout?: number;              // Connection timeout
  retryPolicy?: string;          // Retry configuration
}
```

### Credentials (separate storage)
```typescript
interface Credential {
  apiKey: string;
  additionalAuth?: Record<string, unknown>;
}
```

## File Structure

### Configuration Files (in LACE_DIR)
- `provider-instances.json` - User provider instances
- `credentials/` - Individual credential files (0600 permissions)
  - `{instanceId}.json` - Credentials for each instance
- `user-catalog/` - User-defined provider extensions
  - `{providerId}.json` - Custom provider definitions

### Built-in Data
- `src/providers/catalog/data/` - Catwalk provider JSON files

## Security Model

- **Credentials** stored separately from configuration
- **File permissions** set to 0600 for credential files  
- **API responses** never include credentials
- **Logging** never includes API keys or tokens

## Migration Strategy

1. **First startup** after upgrade checks for existing env vars
2. **Auto-migrates** ANTHROPIC_API_KEY, OPENAI_API_KEY to instances
3. **Preserves** existing provider functionality
4. **Creates** default instances named "Provider (Migrated)"

## Integration Points

### Provider Registry
- **Loads** catalog on startup
- **Creates** provider instances from user configuration
- **Maintains** backward compatibility with env-based providers

### Session/Agent Creation
- **Receives** `providerInstanceId` and `modelId` instead of provider type
- **Resolves** instance configuration and credentials
- **Initializes** appropriate provider with resolved config

## API Design

Backend endpoints (updated path prefix):
- `GET /api/provider/catalog` - List available providers and models
- `GET /api/provider/instances` - List configured instances  
- `POST /api/provider/instances` - Create new instance
- `DELETE /api/provider/instances/{id}` - Remove instance
- `POST /api/provider/instances/{id}/test` - Test connection

## Design Principles

1. **Separation of Concerns**: Catalog metadata separate from user configuration
2. **Security First**: Credentials isolated with proper permissions
3. **Backward Compatibility**: Existing env var setup continues working
4. **Extensibility**: Users can define custom providers via user catalog
5. **Type Safety**: Full TypeScript support with Zod validation