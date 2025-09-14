# OpenRouter Dynamic Catalogs

## Overview

OpenRouter provides access to 300+ AI models from various providers that change daily. Lace fetches the latest model catalog directly from OpenRouter's API, giving you access to the newest models with real-time pricing and capabilities.

## Why Use OpenRouter?

- **Huge model selection**: 300+ models from OpenAI, Anthropic, Google, Meta, and many more
- **Always up-to-date**: New models appear automatically as providers release them
- **Competitive pricing**: Often cheaper than going direct to providers
- **Single API**: One interface for all major AI providers
- **Tool support**: 177+ models support function calling and tools

## Setup

### 1. Get an OpenRouter API Key

1. Visit [openrouter.ai](https://openrouter.ai) and sign up for an account
2. Navigate to the API Keys section in your dashboard
3. Create a new API key (free tier available)
4. Copy your API key (starts with `sk-or-v1-...`)

### 2. Configure Your OpenRouter Instance

1. Open Lace and go to **Settings** → **Provider Instances**
2. Click **Add New Instance**
3. Select **OpenRouter** as the catalog provider
4. Enter a display name (e.g., "OpenRouter Main")
5. Paste your API key in the credentials section
6. Click **Save**

### 3. Model Management

Once configured, your OpenRouter instance will show a **Model Management** section with powerful filtering tools.

## Using the Model Manager

### Search Models

Use the search bar to quickly find specific models:
- Search by model name: `gpt-4`, `claude`, `llama`
- Search by provider: `openai`, `anthropic`, `google`
- Search by capability: `vision`, `tools`, `reasoning`

### Filter by Capabilities

Use the capability checkboxes to filter models that support:

- **Tools**: Function/tool calling support
- **Vision**: Image analysis and processing
- **Reasoning**: Enhanced reasoning capabilities
- **Structured**: Structured output formats
- **Functions**: Legacy function calling

### Filter by Specifications

Use the dropdown filters to find models that meet your requirements:

#### Context Size
- **Any context**: No minimum requirement
- **> 32k**: Models with 32,000+ token context windows
- **> 100k**: Models with 100,000+ token context windows  
- **> 500k**: Models with 500,000+ token context windows

#### Price Range
- **Any price**: No cost limit
- **Free only**: Zero-cost models only
- **< $1/M**: Under $1 per million input tokens
- **< $5/M**: Under $5 per million input tokens
- **< $10/M**: Under $10 per million input tokens

### Managing Model Access

#### Provider-Level Control
- Click the **provider checkbox** to enable/disable all models from that provider
- Useful for quickly excluding entire provider families (e.g., all Google models)

#### Individual Model Control  
- Expand provider groups to see individual models
- Toggle specific models on/off
- See model details: context size, pricing, capabilities

#### Bulk Operations
- **Enable Provider**: Enables all models from that provider
- **Disable Provider**: Disables all models from that provider
- Individual model settings override provider settings

### Automatic Updates

- **Daily refresh**: Model catalog automatically updates every 24 hours
- **Manual refresh**: Click the refresh button to update immediately
- **Cache fallback**: If API is unavailable, uses last known model list
- **Auto-save**: Your model selections are automatically saved

## Model Information

Each model shows:

### Basic Info
- **Name**: Human-readable model name
- **ID**: Technical model identifier used in API calls
- **Provider**: Company/organization that created the model

### Specifications  
- **Context Window**: Maximum tokens the model can process
- **Input Cost**: Price per million input tokens
- **Output Cost**: Price per million output tokens
- **FREE Badge**: Shown for zero-cost models

### Capabilities
- **vision**: Can analyze images and visual content
- **reasoning**: Enhanced reasoning and problem-solving
- **tools**: Supports function/tool calling

## Best Practices

### Choosing Models

1. **Start with capabilities**: Filter by required features (tools, vision, etc.)
2. **Set budget limits**: Use price filters to stay within cost targets
3. **Consider context needs**: Larger contexts for complex tasks
4. **Try free models first**: Many excellent zero-cost options available

### Managing Large Catalogs

1. **Use search actively**: With 300+ models, search is essential
2. **Filter by provider**: Focus on trusted providers first
3. **Disable unused providers**: Reduce clutter by disabling entire provider families
4. **Bookmark favorites**: Note model IDs for frequently used models

### Cost Management

1. **Monitor pricing**: Model costs change frequently
2. **Use free models**: Great for testing and development
3. **Set budget filters**: Prevent accidentally selecting expensive models
4. **Compare alternatives**: Multiple models often have similar capabilities

## Troubleshooting

### Models Don't Load

1. **Check API key**: Ensure it's valid and has permissions
2. **Verify network**: OpenRouter API must be accessible
3. **Manual refresh**: Click refresh button to retry
4. **Check logs**: Console will show specific error details

### Search Not Working

1. **Clear filters**: Remove capability and price filters
2. **Check spelling**: Model names are case-sensitive
3. **Try partial matches**: Search for `gpt` instead of `gpt-4-turbo`

### Slow Performance

1. **Use filters**: Narrow down the model list with filters
2. **Collapse groups**: Keep unused provider groups collapsed
3. **Clear search**: Empty search box to see all models

### Configuration Not Saving

1. **Wait for auto-save**: Changes save automatically after 1 second
2. **Check network**: Save requires API connectivity
3. **Refresh page**: Reload to see if changes persisted

## Advanced Usage

### Custom Filtering Strategies

Combine multiple filters for precise model selection:

```
Tools + Vision + < $5/M + > 32k context = 
Perfect for multimodal AI assistant tasks
```

```
Free only + Tools + > 100k context = 
Great for development and testing
```

### API Integration

Your selected models automatically appear in:
- **Model selector**: When creating new conversations
- **Provider instances**: For programmatic access
- **API calls**: Via OpenRouter's OpenAI-compatible API

## Support

- **OpenRouter Support**: [openrouter.ai/docs](https://openrouter.ai/docs)
- **Lace Issues**: [github.com/anthropics/lace/issues](https://github.com/anthropics/lace/issues)
- **Model Problems**: Check OpenRouter's status page and model documentation

---

*Last updated: {{ current_date }} | Models available: {{ model_count }}*