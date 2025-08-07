// ABOUTME: Test helper for setting up provider instance defaults in test environment
// ABOUTME: Ensures tests have fallback provider credentials for Session.create() to work

/**
 * Sets up test environment variables to enable default provider instance creation
 * Call this in beforeEach() for tests that create sessions without explicit provider configuration
 */
export function setupTestProviderDefaults(): void {
  // Set dummy API keys so ProviderInstanceManager.getDefaultConfig() will create default instances
  process.env.ANTHROPIC_KEY = 'test-anthropic-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';
}

/**
 * Cleans up test environment variables
 * Call this in afterEach() to avoid polluting other tests
 */
export function cleanupTestProviderDefaults(): void {
  delete process.env.ANTHROPIC_KEY;
  delete process.env.OPENAI_API_KEY;
}
