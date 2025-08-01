# Provider Configuration System Specification

## Overview

This specification describes a new provider configuration system for lace that supports multiple provider instances, web-based configuration, and secure credential management. The system is designed to accommodate the shift from a CLI-only tool to a multi-interface platform supporting numerous AI providers.

## Background

The current provider system was designed for CLI usage with a limited set of providers (Anthropic, OpenAI) configured via environment variables. With the introduction of web-based interfaces and the proliferation of OpenAI-compatible APIs (OpenRouter, Qwen, DeepSeek, etc.), a more flexible configuration system is needed.

## Design Principles

1. **Simplicity First**: V1 implements global providers only (no per-project providers)
2. **Security**: API credentials are write-only in the UI and stored separately from configuration
3. **Extensibility**: Use JSONB storage to allow future additions without schema changes
4. **Compatibility**: Maintain support for existing provider type implementations

## Architecture

### Provider Types vs Provider Instances

- **Provider Type**: The actual API implementation code (e.g., `anthropic-api`, `openai-api`)
- **Provider Instance**: A configured instance of a provider type with specific endpoint and credentials

### File Structure

```
$LACE_DIR/
├── providers.json          # Provider instance configurations
├── credentials/           # Credential storage directory
│   ├── openai-prod.json   # Individual credential files
│   ├── openai-dev.json
│   └── anthropic-main.json
```

## Configuration Schema

### providers.json

```json
{
  "version": "1.0",
  "providers": {
    "openai-prod": {
      "name": "OpenAI Production",
      "type": "openai-api",
      "config": {
        "baseUrl": "https://api.openai.com/v1",
        "timeout": 30000,
        "defaultModel": "gpt-4"
      }
    },
    "openrouter-main": {
      "name": "OpenRouter",
      "type": "openai-api",
      "config": {
        "baseUrl": "https://openrouter.ai/api/v1",
        "timeout": 60000
      }
    },
    "anthropic-main": {
      "name": "Anthropic",
      "type": "anthropic-api",
      "config": {
        "baseUrl": "https://api.anthropic.com/v1",
        "timeout": 30000,
        "defaultModel": "claude-3-opus-20240229"
      }
    }
  }
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

### Provider Type Registry

Provider types are hard-coded in the system:
- `anthropic-api`: Anthropic's API implementation
- `openai-api`: OpenAI-compatible API implementation (used by OpenAI, OpenRouter, DeepSeek, Qwen, etc.)

### Configuration Management

1. **Loading**: Read providers.json on startup
2. **Validation**: Validate against provider type requirements
3. **Defaults**: Ship with default provider configurations in source
4. **Updates**: Web UI updates providers.json directly; CLI changes require restart

### Credential Management

1. **Storage**: Individual JSON files in `$LACE_DIR/credentials/`
2. **Naming**: Credential filename matches provider instance ID
3. **Security**: Files should have restricted permissions (0600)
4. **Web UI**: Credentials are write-only - can be entered but never displayed

### Web UI Operations

The web interface must support:
- **List** all configured providers
- **Add** new provider instance (select type, configure settings, enter credentials)
- **Edit** existing provider configuration (not credentials)
- **Delete** provider instance (with confirmation)
- **Test** provider connection

### Provider Selection

1. Projects maintain default provider setting (existing functionality)
2. Sessions inherit project default (existing functionality)
3. Users can switch providers mid-conversation (existing functionality)
4. System falls back to first available provider if default unavailable

## Migration Path

1. On first run with new system:
   - Check for existing environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY)
   - Create provider instances for found credentials
   - Save to new configuration format
   - Warn user about migration

2. Default providers.json template ships with codebase
3. Empty credentials directory created on first run

## Security Considerations

1. **Credential Files**: Must be created with 0600 permissions
2. **Web Interface**: API keys are write-only (no read endpoint)
3. **Logging**: Never log credential contents
4. **Git**: Both providers.json and credentials/ should be in .gitignore

## Future Extensibility

The JSONB config field allows for future additions such as:
- Rate limiting configuration
- Custom headers
- Model-specific parameters
- Retry policies
- Usage tracking settings

## Testing Requirements

1. **Unit Tests**: Configuration loading, validation, credential management
2. **Integration Tests**: Provider instance creation and API calls
3. **E2E Tests**: Web UI flow for adding/configuring providers
4. **Security Tests**: Verify credentials cannot be read via API

## Success Criteria

1. Users can configure multiple instances of the same provider type
2. Credentials are securely stored and never exposed in UI
3. Configuration changes via web UI take effect immediately
4. System gracefully handles missing/invalid configurations
5. Migration from environment variables is seamless

## Out of Scope for V1

- Per-project provider configurations
- Provider import/export functionality
- Credential rotation/expiry management
- Usage analytics per provider
- Provider "marketplace" or registry