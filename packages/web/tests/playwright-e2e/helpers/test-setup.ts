// ABOUTME: Shared test setup utilities for Playwright E2E tests
// ABOUTME: Eliminates boilerplate by providing standardized beforeAll/afterAll/beforeEach/afterEach functions

import { test, Page } from '@playwright/test';
import { startTestServer, type TestServer } from './test-server';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  createProject,
  type TestEnvironment,
} from './test-utils';

export interface E2ETestConfig {
  customEnvSetup?: boolean;
  skipProjectCreation?: boolean;
  customAnthropicKey?: string;
  enableDebugLogging?: boolean;
}

export interface E2ETestContext {
  testServer: TestServer;
  testEnv?: TestEnvironment;
}

/**
 * Sets up standardized E2E test environment with server-per-file and sequential execution
 *
 * @param config Configuration options for test setup
 * @returns Object with beforeAll, afterAll, beforeEach, afterEach functions and context
 */
export function setupE2ETestSuite(config: E2ETestConfig = {}) {
  const context: E2ETestContext = {} as E2ETestContext;

  const beforeAll = async () => {
    // Start one server for the entire test file
    context.testServer = await startTestServer();
  };

  const afterAll = async () => {
    // Clean up server after all tests in this file complete
    await context.testServer.cleanup();
  };

  const beforeEach = async (page: Page) => {
    if (config.enableDebugLogging) {
      // Add console and error listeners for debugging
      page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
      page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message));
      page.on('requestfailed', (request) =>
        console.log('REQUEST FAILED:', request.url(), request.failure()?.errorText)
      );
    }

    if (!config.customEnvSetup) {
      // Standard environment setup used by most test files
      context.testEnv = await setupTestEnvironment();

      // Set up environment with test key
      process.env.ANTHROPIC_KEY = config.customAnthropicKey || 'test-anthropic-key-for-e2e';

      await page.addInitScript((tempDir) => {
        window.testEnv = {
          ANTHROPIC_KEY: 'test-key',
          LACE_DB_PATH: `${tempDir}/lace.db`,
        };
      }, context.testEnv.tempDir);
    }

    // Navigate to test server
    await page.goto(context.testServer.baseURL);

    if (!config.skipProjectCreation && context.testEnv) {
      // Create project using reusable utility - this auto-creates session and agent
      await createProject(page, context.testEnv.projectName, context.testEnv.tempDir);
    }
  };

  const afterEach = async () => {
    if (!config.customEnvSetup && context.testEnv) {
      // Clean up test environment after each test
      await cleanupTestEnvironment(context.testEnv);
    }
  };

  const configureSequential = () => {
    // Run tests sequentially to avoid resource conflicts
    test.describe.configure({ mode: 'serial' });
  };

  return {
    context,
    beforeAll,
    afterAll,
    beforeEach,
    afterEach,
    configureSequential,
  };
}

/**
 * Standard E2E test setup for most test files
 * Includes server management, environment setup, and project creation
 */
export function useStandardE2ESetup(customAnthropicKey?: string) {
  const setup = setupE2ETestSuite({ customAnthropicKey });

  setup.configureSequential();

  test.beforeAll(setup.beforeAll);
  test.afterAll(setup.afterAll);
  test.beforeEach(async ({ page }) => {
    await setup.beforeEach(page);
  });
  test.afterEach(setup.afterEach);

  return setup.context;
}

/**
 * Custom E2E test setup for files that need special environment handling
 * Provides server management and sequential configuration, but skips standard env setup
 */
export function useCustomE2ESetup() {
  const setup = setupE2ETestSuite({
    customEnvSetup: true,
    skipProjectCreation: true,
  });

  setup.configureSequential();

  test.beforeAll(setup.beforeAll);
  test.afterAll(setup.afterAll);

  return {
    context: setup.context,
    beforeEach: setup.beforeEach,
    afterEach: setup.afterEach,
  };
}
