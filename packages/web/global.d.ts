// ABOUTME: Global type declarations for E2E test environment variables
// ABOUTME: Keeps TypeScript happy with global test flags

declare global {
  var __E2E_TOOL_APPROVAL_MOCK: boolean | undefined;

  interface Window {
    testEnv?: {
      ANTHROPIC_KEY: string;
      LACE_DB_PATH: string;
    };
  }
}

export {};
