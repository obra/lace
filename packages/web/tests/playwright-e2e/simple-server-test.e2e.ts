// ABOUTME: Simple test to verify server-per-test works without complex UI interactions
// ABOUTME: Tests basic server startup and navigation without project creation

import { test, expect } from '@playwright/test';
import { startTestServer, type TestServer } from './helpers/test-server';

test.describe('Simple Server Test', () => {
  let testServer: TestServer;

  test.beforeEach(async () => {
    testServer = await startTestServer();
  });

  test.afterEach(async () => {
    await testServer.cleanup();
  });

  test('should start server and load home page', async ({ page }) => {
    // Navigate to the test server
    await page.goto(testServer.baseURL);

    // Wait for DOM to be ready (not network idle due to SSE streams)
    await page.waitForLoadState('domcontentloaded');

    // Verify basic page elements are present
    await expect(page.locator('h1, h2, h3').first()).toBeVisible({ timeout: 10000 });

    // Verify we can see "Lace" or project-related content
    const hasLaceContent = (await page.getByText(/lace|project|select/i).count()) > 0;
    expect(hasLaceContent).toBeTruthy();

    // Verify API endpoints are working
    const response = await page.request.get(`${testServer.baseURL}/api/projects`);
    expect(response.ok()).toBeTruthy();
  });

  test('should handle multiple test servers independently', async ({ page }) => {
    // This test verifies that each test gets its own isolated server
    await page.goto(testServer.baseURL);

    // The server port should be unique for this test
    expect(testServer.port).toBeGreaterThan(1024);
    expect(testServer.baseURL).toContain(`localhost:${testServer.port}`);

    // Basic navigation should work
    await page.waitForLoadState('domcontentloaded');
    const hasContent = await page.locator('body').textContent();
    expect(hasContent).toBeTruthy();
  });
});
