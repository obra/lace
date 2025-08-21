// ABOUTME: Provider-specific setup utilities for E2E tests
// ABOUTME: Convenience functions for common provider configurations

import { Page } from '@playwright/test';
import { setupProvider } from './ui-interactions';

/** Setup Anthropic provider with default test configuration */
export async function setupAnthropicProvider(
  page: Page,
  apiKey: string = 'sk-fake-key'
): Promise<void> {
  await setupProvider(page, 'anthropic', { apiKey });
}

/** Setup OpenAI provider with default test configuration */
export async function setupOpenAIProvider(
  page: Page,
  apiKey: string = 'sk-fake-openai-key'
): Promise<void> {
  await setupProvider(page, 'openai', { apiKey });
}

/** Setup local provider with custom endpoint */
export async function setupLocalProvider(
  page: Page,
  endpoint: string = 'http://localhost:11434',
  displayName: string = 'Local Ollama'
): Promise<void> {
  await setupProvider(page, 'ollama', {
    apiKey: 'not-needed',
    endpoint,
    displayName,
  });
}
