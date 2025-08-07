# Critical Bug: Anthropic Provider Missing baseURL Support

## Problem

The AnthropicProvider ignores the `baseURL` config parameter from provider instances, just like OpenAI did.

## Current Code (lines 36-39):

```typescript
this._anthropic = new Anthropic({
  apiKey: config.apiKey,
  dangerouslyAllowBrowser: true,
});
```

## Required Fix:

```typescript
const anthropicConfig: Anthropic.ClientOptions = {
  apiKey: config.apiKey,
  dangerouslyAllowBrowser: true,
};

// Support custom base URL for Anthropic-compatible APIs
const configBaseURL = config.baseURL as string | undefined;
if (configBaseURL) {
  anthropicConfig.baseURL = configBaseURL;
  logger.info('Using custom Anthropic base URL', { baseURL: configBaseURL });
}

this._anthropic = new Anthropic(anthropicConfig);
```

## Impact

Without this fix, Anthropic provider instances will:

- Appear to work in the UI
- Fail silently by calling the wrong endpoint
- Use wrong credentials
- This is exactly the bug Jesse was worried about!
