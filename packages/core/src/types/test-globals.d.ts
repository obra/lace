// ABOUTME: Test environment type declarations for Vitest compatibility
// ABOUTME: Fixes conflicts between Bun's enhanced fetch and standard fetch mocking

declare global {
  namespace globalThis {
    // Override Bun's enhanced fetch in test environment to allow Vitest mocking
    var fetch: typeof import('undici').fetch;
  }
}

export {};
