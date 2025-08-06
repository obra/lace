# Provider Configuration System Specification

## Overview

This specification describes a new provider configuration system for lace that supports multiple provider instances, web-based configuration, and secure credential management. The system uses Catwalk's provider metadata as a static catalog while maintaining separate user configuration for instances.

## Background

The current provider system was designed for CLI usage with a limited set of providers (Anthropic, OpenAI) configured via environment variables. With the introduction of web-based interfaces and the proliferation of OpenAI-compatible APIs (OpenRouter, Qwen, DeepSeek, etc.), a more flexible configuration system is needed.

## Architectural Approach

The system uses a **three-tier architecture**:

1. **Provider Catalogs**: Available models and metadata (shipped Catwalk data + user extensions)
2. **Provider Instances**: Connection configurations (credentials, endpoints, timeouts)
3. **Agent/Session Model Selection**: Users pick specific models from available catalogs when creating agents

## Design Principles

1. **Separation of Concerns**: Catalogs provide available options, instances handle connections, sessions choose models
2. **Extensible Catalogs**: Ship with Catwalk data, allow user extensions for custom/local providers
3. **Rich Metadata**: Leverage battle-tested provider and model information for informed choices
4. **Security**: API credentials are write-only in the UI and stored separately from configuration
5. **Flexibility**: Users can configure any model from any provider instance at session creation time

## Architecture

### Provider Catalogs

**Shipped Catalog (Catwalk Data)**:
- Available providers and their API types
- Model metadata (costs, capabilities, context windows)
- Default configurations and recommended models
- Provider-specific features and limitations

**User Catalog Extensions**:
- Custom provider definitions for local/self-hosted models
- Company-internal providers not in public catalogs
- Experimental or beta provider configurations
- Override/extend shipped catalog entries

### Provider Instances (Connection Configuration Only)

Lightweight connection configurations:
- **Instance Identity**: User-friendly name and catalog reference
- **Credentials**: Securely stored API keys and authentication data
- **Connection Settings**: Custom endpoints, timeouts, retry policies
- **No Model Selection**: Model choice happens at agent/session creation time

### File Structure

```
# Shipped catalog (bundled with codebase)
src/providers/catalog/
├── anthropic.json         # Catwalk's Anthropic provider config
├── openai.json           # Catwalk's OpenAI provider config  
├── openrouter.json       # Catwalk's OpenRouter provider config
└── ...                   # Other Catwalk provider configs

# User configuration (in LACE_DIR)
$LACE_DIR/
├── provider-instances.json # User's connection configurations
├── user-catalog/          # User's custom provider catalogs
│   ├── my-ollama.json     # Custom local provider definitions
│   ├── company-llm.json   # Internal company models
│   └── experimental.json  # Beta/testing providers
├── credentials/           # Secure credential storage
│   ├── openai-prod.json   # Individual credential files
│   ├── local-ollama.json
│   └── anthropic-main.json
```

## Configuration Schema

### Static Catalog Schema (Catwalk Format)

```json
{
  "name": "OpenAI",
  "id": "openai", 
  "type": "openai",
  "api_key": "$OPENAI_API_KEY",
  "api_endpoint": "$OPENAI_API_ENDPOINT",
  "default_large_model_id": "gpt-4o",
  "default_small_model_id": "gpt-4o-mini",
  "models": [
    {
      "id": "gpt-4o",
      "name": "GPT-4o",
      "cost_per_1m_in": 2.5,
      "cost_per_1m_out": 10.0,
      "context_window": 128000,
      "default_max_tokens": 4096,
      "can_reason": true,
      "supports_attachments": true
    }
  ]
}
```

### Provider Instance Schema (provider-instances.json)

```json
{
  "version": "1.0",
  "instances": {
    "openai-prod": {
      "displayName": "OpenAI Production", 
      "catalogProviderId": "openai",
      "endpoint": null,
      "timeout": 30000,
      "retryPolicy": "default"
    },
    "openrouter-main": {
      "displayName": "OpenRouter",
      "catalogProviderId": "openrouter",
      "endpoint": "https://openrouter.ai/api/v1", 
      "timeout": 60000
    },
    "local-ollama": {
      "displayName": "Local Ollama",
      "catalogProviderId": "my-ollama",
      "endpoint": "http://localhost:11434",
      "timeout": 120000
    }
  }
}
```

### User Catalog Extension Example (user-catalog/my-ollama.json)

```json
{
  "name": "Local Ollama",
  "id": "my-ollama",
  "type": "ollama",
  "api_endpoint": "http://localhost:11434",
  "models": [
    {
      "id": "llama3.2:3b",
      "name": "Llama 3.2 3B",
      "cost_per_1m_in": 0,
      "cost_per_1m_out": 0,
      "context_window": 32768,
      "default_max_tokens": 4096,
      "can_reason": false,
      "supports_attachments": false
    }
  ]
}
```

### Credential File Schema (e.g., credentials/openai-prod.json)

```json
{
  "apiKey": "sk-...",
  "additionalAuth": {
    // Future extensibility for OAuth tokens, etc.
  }
}
```

## Implementation Requirements

### Provider Catalog Manager

A service to load and query provider metadata from multiple sources:
- Load shipped Catwalk JSON files from bundled catalog
- Load user catalog extensions from user-catalog/ directory
- Provide merged view of available providers, models, and capabilities
- Validate user instances against catalog entries
- Support model filtering by capabilities (reasoning, attachments, etc.)
- Handle catalog conflicts (user extensions override shipped data)

### Instance Configuration Management

1. **Loading**: Read provider-instances.json on startup, merge with catalog data
2. **Validation**: Validate instance references against catalog entries
3. **Defaults**: Auto-populate instances for available catalog providers with environment variables
4. **Updates**: Web UI updates provider-instances.json directly; CLI changes require restart

### Credential Management

1. **Storage**: Individual JSON files in `$LACE_DIR/credentials/`
2. **Naming**: Credential filename matches provider instance ID
3. **Security**: Files should have restricted permissions (0600)
4. **Web UI**: Credentials are write-only - can be entered but never displayed

### Web UI Operations

**Catalog Management**:
- **Browse** available providers from merged catalogs with rich metadata
- **Compare** models by cost, capabilities, and context window
- **Add** custom provider catalogs for local/experimental models
- **Edit** user catalog extensions

**Instance Management**:
- **List** all configured instances with status indicators
- **Add** new provider instance (select from catalog, configure connection, enter credentials) 
- **Edit** existing instance connection settings (not credentials)
- **Delete** instance (with confirmation)
- **Test** instance connection

**Agent/Session Creation**:
- **Select** provider instance from configured instances
- **Choose** specific model from that instance's available models (from catalog)
- **Preview** model capabilities and costs before selection

### Provider and Model Selection Flow

1. **Project Defaults**: Projects maintain default provider instance + model combination
2. **Session Creation**: Users can override project defaults, selecting any instance + model
3. **Mid-Conversation Switching**: Users can switch to different instance + model combinations
4. **Fallback Logic**: System falls back to available instances if configured default unavailable
5. **Model Validation**: System validates selected model exists in chosen instance's catalog

## Migration Path

1. **Catalog Setup**: Ship Catwalk JSON files with codebase as baseline catalog
2. **Environment Variable Migration**:
   - Check for existing environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY)
   - Create provider instances referencing shipped catalog entries
   - Save credentials to new secure storage format
   - Warn user about migration and new capabilities
3. **Directory Initialization**: Create empty user-catalog/ and credentials/ directories
4. **Backward Compatibility**: Continue supporting environment variables for existing installations

## Security Considerations

1. **Credential Files**: Must be created with 0600 permissions
2. **Web Interface**: API keys are write-only (no read endpoint)
3. **Logging**: Never log credential contents
4. **Git**: Both provider-instances.json, user-catalog/, and credentials/ should be in .gitignore
5. **Catalog Validation**: Validate user catalog extensions to prevent code injection

## Future Extensibility

The catalog and instance system enables future enhancements:
- **Enhanced Catalogs**: Community-contributed provider catalogs, marketplace
- **Smart Model Selection**: Auto-select models based on task complexity and cost preferences
- **Usage Analytics**: Track costs and performance across models and instances
- **Advanced Routing**: Route requests based on model availability and load balancing
- **Custom Model Training**: Integration with fine-tuning services and custom model hosting

## Testing Requirements

1. **Unit Tests**: Catalog loading, instance validation, credential management
2. **Integration Tests**: Provider instance creation with catalog reference resolution
3. **E2E Tests**: Web UI flows for catalog browsing, instance configuration, model selection
4. **Security Tests**: Verify credentials cannot be read via API, catalog injection prevention
5. **Migration Tests**: Verify smooth transition from environment variables to new system

## Success Criteria

1. **Rich Model Discovery**: Users can browse available models with costs, capabilities, and metadata
2. **Flexible Instance Configuration**: Users can configure multiple instances of the same provider type
3. **Extensible Catalogs**: Users can add custom provider catalogs for local/experimental models
4. **Secure Credential Management**: Credentials are securely stored and never exposed in UI
5. **Seamless Model Selection**: Users can choose any model from any configured instance during agent creation
6. **Smooth Migration**: Transition from environment variables preserves existing functionality

## Out of Scope for V1

- Per-project provider configurations
- Provider catalog marketplace/sharing
- Credential rotation/expiry management  
- Automatic model selection based on task analysis
- Load balancing across multiple instances
- Real-time cost tracking and budgets