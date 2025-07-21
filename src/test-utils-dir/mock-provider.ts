// ABOUTME: Helper function to create mock provider for CLI testing
// ABOUTME: Returns a test provider with realistic responses for conversation flow testing

import { TestProvider } from '~/test-utils-dir/test-provider';

export function createMockProvider() {
  return new TestProvider({
    mockResponse: 'Hello! How can I help you today?',
    shouldError: false,
    delay: 50, // Small delay to simulate real processing
  });
}
