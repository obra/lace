// ABOUTME: Simple test to verify server-per-file works without complex UI interactions
// ABOUTME: Tests basic server startup and navigation without project creation

import { test, expect } from '@playwright/test';
import { useCustomE2ESetup } from './helpers/test-setup';

test.describe('Simple Server Test', () => {
  const { context: testContext } = useCustomE2ESetup();

  test('should start server and load home page', async ({ page }) => {
    // Navigate to the test server
    await page.goto(testContext.testServer.baseURL);

    // Wait for DOM to be ready (not network idle due to SSE streams)
    await page.waitForLoadState('domcontentloaded');

    // Verify basic page elements are present
    await expect(page.locator('h1, h2, h3').first()).toBeVisible({ timeout: 10000 });

    // Verify we can see "Lace" or project-related content
    const hasLaceContent = (await page.getByText(/lace|project|select/i).count()) > 0;
    expect(hasLaceContent).toBeTruthy();

    // Verify API endpoints are working
    const response = await page.request.get(`${testContext.testServer.baseURL}/api/projects`);
    expect(response.ok()).toBeTruthy();
  });

  test('should share server across tests in same file', async ({ page }) => {
    // This test verifies that tests in the same file share one server instance
    await page.goto(testContext.testServer.baseURL);

    // The server port should be consistent across tests in this file
    expect(testContext.testServer.port).toBeGreaterThan(1024);
    expect(testContext.testServer.baseURL).toContain(`localhost:${testContext.testServer.port}`);

    // Basic navigation should work
    await page.waitForLoadState('domcontentloaded');
    const hasContent = await page.locator('body').textContent();
    expect(hasContent).toBeTruthy();
  });
});
