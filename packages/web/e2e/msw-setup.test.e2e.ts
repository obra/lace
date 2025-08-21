// ABOUTME: Tests MSW (Mock Service Worker) setup and API interception functionality
// ABOUTME: Verifies that external API calls are properly mocked in E2E test environment

import { test, expect } from '@playwright/test';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  type TestEnvironment,
} from './helpers/test-utils';

test.describe('MSW Setup', () => {
  let testEnv: TestEnvironment;

  test.beforeEach(async ({ page }) => {
    testEnv = await setupTestEnvironment();
    await page.goto(testEnv.serverUrl);
  });

  test.afterEach(async () => {
    if (testEnv) {
      await cleanupTestEnvironment(testEnv);
    }
  });

  test('MSW intercepts external API calls', async ({ page }) => {
    // Make a direct API call from the browser to verify interception
    const response = await page.evaluate(async () => {
      const result = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          messages: [{ role: 'user', content: 'test' }],
        }),
      });
      return result.json();
    });

    expect(response).toHaveProperty('id', 'msg_test123');
    expect(response.content[0].text).toContain('test response from the mocked Anthropic API');
  });
});
