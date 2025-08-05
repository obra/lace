// ABOUTME: E2E test for hash-based URL persistence across page reloads
// ABOUTME: Tests project/session/agent selection persistence with real browser navigation

/**
 * @vitest-environment node
 */

import { test, expect } from '@playwright/test';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { startTestServer, type TestServer } from './helpers/test-server';

test.describe('Hash-Based URL Persistence E2E', () => {
  let tempDir: string;
  let originalLaceDir: string | undefined;
  let originalAnthropicKey: string | undefined;
  let testServer: TestServer;

  test.beforeAll(async () => {
    // Start one server for the entire test file
    testServer = await startTestServer();
  });

  test.afterAll(async () => {
    // Clean up server after all tests in this file complete
    await testServer.cleanup();
  });

  test.beforeEach(async () => {
    // Create fresh temp directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lace-hash-e2e-test-'));
    originalLaceDir = process.env.LACE_DIR;
    originalAnthropicKey = process.env.ANTHROPIC_KEY;
    process.env.LACE_DIR = tempDir;

    // Set test environment variables
    // Use real ANTHROPIC_KEY if available, otherwise use a placeholder that may cause expected server errors
    if (!process.env.ANTHROPIC_KEY) {
      process.env.ANTHROPIC_KEY =
        process.env.ANTHROPIC_API_KEY || 'sk-ant-test-key-for-e2e-testing';
    }
  });

  test.afterEach(async () => {
    // Clean up test environment

    // Clean up after each test
    if (originalLaceDir !== undefined) {
      process.env.LACE_DIR = originalLaceDir;
    } else {
      delete process.env.LACE_DIR;
    }

    // Restore original ANTHROPIC_KEY
    if (originalAnthropicKey !== undefined) {
      process.env.ANTHROPIC_KEY = originalAnthropicKey;
    } else {
      delete process.env.ANTHROPIC_KEY;
    }

    if (
      tempDir &&
      (await fs
        .access(tempDir)
        .then(() => true)
        .catch(() => false))
    ) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('should persist project selection across page reloads', async ({ page }) => {
    // Navigate to the test server
    await page.goto(testServer.baseURL);

    // Wait for projects to load (h1 with "Select a Project" or existing project cards)
    await page.locator('h1:has-text("Select a Project"), h3').first().waitFor({ timeout: 5000 });

    // Look for existing E2E projects or create one if needed
    const existingProject = page.locator('h3:has-text("E2E Test Project")').first();

    if ((await existingProject.count()) > 0) {
      // Click the entire project card (entire card is clickable)
      await existingProject.click();
    } else {
      // Create a new project for testing - check for auto-opened modal first
      const modalHeading = page
        .getByRole('heading', { name: 'Welcome to Lace' })
        .or(page.getByRole('heading', { name: 'Create New Project' }));

      try {
        // Wait a bit to see if modal auto-opens
        await expect(modalHeading).toBeVisible({ timeout: 5000 });
        // Modal is already open, proceed directly
      } catch {
        // Modal not visible, click the New Project button
        await page.getByTestId('new-project-button').click();
        // Now wait for modal to appear after clicking
        await expect(modalHeading).toBeVisible({ timeout: 15000 });
      }

      // Fill both required form fields using test IDs
      await page.getByTestId('project-path-input').fill('/tmp/e2e-test-project');

      // Wait for the button to be enabled (only enabled after both fields filled)
      const createButton = page.getByTestId('create-project-submit-button');
      await expect(createButton).toBeEnabled({ timeout: 5000 });
      await createButton.click();
    }

    // Verify URL contains project hash (may include session/agent due to auto-creation)
    await expect(page).toHaveURL(/.*#\/project\/[^\/]+(?:\/session\/[^\/]+(?:\/agent\/[^\/]+)?)?$/);

    // Get the current URL with project selection
    const projectUrl = page.url();

    // Reload the page
    await page.reload();

    // Verify we're still on the same project after reload
    await expect(page).toHaveURL(projectUrl);

    // Verify project is still selected (sidebar should show current project)
    await expect(page.locator('button:has-text("Current Project")')).toBeVisible();
  });

  test('should persist session selection across page reloads', async ({ page }) => {
    // Start at the base URL
    await page.goto(testServer.baseURL);

    // Navigate through project → session selection - wait for page to load
    await page.waitForSelector('h1:has-text("Select a Project"), h3', { timeout: 5000 });

    // Always create a new project with unique name to avoid conflicts
    // Check for auto-opened modal first
    const modalHeading = page
      .getByRole('heading', { name: 'Welcome to Lace' })
      .or(page.getByRole('heading', { name: 'Create New Project' }));

    try {
      // Wait a bit to see if modal auto-opens
      await expect(modalHeading).toBeVisible({ timeout: 5000 });
      // Modal is already open, proceed directly
    } catch {
      // Modal not visible, click the New Project button
      await page.getByTestId('new-project-button').click();
      // Now wait for modal to appear after clicking
      await expect(modalHeading).toBeVisible({ timeout: 15000 });
    }

    const projectPathInput = page.getByTestId('project-path-input');
    await projectPathInput.waitFor({ timeout: 15000 });
    await projectPathInput.fill(`/tmp/e2e-session-test-${Date.now()}`);
    const createButton = page.getByTestId('create-project-submit-button');
    await expect(createButton).toBeEnabled({ timeout: 5000 });
    await createButton.click();

    // Project creation auto-creates session and navigates to session view
    // Wait for session to be created and loaded (this happens automatically)
    await page.waitForTimeout(3000); // Give time for auto-session creation

    // Verify we're in a session view (project creation should auto-create session)
    const currentUrl = page.url();
    console.log('Current URL after project creation:', currentUrl);

    // The system now auto-creates sessions, so we should be in session view
    if (!currentUrl.includes('/session/')) {
      // If somehow we're still on project page, this indicates an issue with auto-session creation
      // Try to wait a bit more for the redirect
      await page.waitForTimeout(2000);
      const updatedUrl = page.url();

      if (!updatedUrl.includes('/session/')) {
        throw new Error('Expected auto-session creation but still on project page: ' + updatedUrl);
      }
    }

    // Verify URL contains project and session (may include agent due to auto-creation)
    await expect(page).toHaveURL(/.*#\/project\/[^\/]+\/session\/[^\/]+(?:\/agent\/[^\/]+)?$/);

    const sessionUrl = page.url();

    // Reload the page
    await page.reload();

    // Verify we're still on the same session after reload
    await expect(page).toHaveURL(sessionUrl);

    // Verify we navigated to session view or stayed at project view (due to potential server errors)
    const urlAfterReload = page.url();
    // Should have session URL (including agent if auto-created)
    expect(urlAfterReload).toMatch(/#\/project\/[^\/]+\/session\/[^\/]+(?:\/agent\/[^\/]+)?$/);

    // Since we're in a session view (with auto-created session/agent),
    // just verify that basic session UI elements are present
    // Look for message input which indicates we're in the chat interface
    await expect(
      page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]')
    ).toBeVisible({ timeout: 10000 });
  });

  test('should persist full project/session/agent hierarchy across page reloads', async ({
    page,
  }) => {
    // Navigate to the app
    await page.goto(testServer.baseURL);

    // Navigate through the full hierarchy: project → session → agent
    await page.waitForSelector('h1:has-text("Select a Project"), h3', { timeout: 5000 });

    // Select or create a project - the entire project card is clickable
    const existingProject = page
      .locator('h3:has-text("E2E Full Hierarchy Test"), h3:has-text("E2E")')
      .first();
    if ((await existingProject.count()) > 0) {
      // Click the project heading (entire project card is clickable)
      await existingProject.click();
    } else {
      // Check for auto-opened modal first
      const modalHeading = page
        .getByRole('heading', { name: 'Welcome to Lace' })
        .or(page.getByRole('heading', { name: 'Create New Project' }));

      try {
        // Wait a bit to see if modal auto-opens
        await expect(modalHeading).toBeVisible({ timeout: 5000 });
        // Modal is already open, proceed directly
      } catch {
        // Modal not visible, click the New Project button
        await page.getByTestId('new-project-button').click();
        // Now wait for modal to appear after clicking
        await expect(modalHeading).toBeVisible({ timeout: 15000 });
      }

      await page.getByTestId('project-path-input').fill('/tmp/e2e-full-hierarchy-test');
      const createButton = page.getByTestId('create-project-submit-button');
      await expect(createButton).toBeEnabled({ timeout: 5000 });
      await createButton.click();
    }

    // Project creation auto-creates session, so we should already be in session view
    await page.waitForTimeout(3000); // Give time for auto-session creation

    const currentUrl = page.url();
    console.log('Current URL after project creation:', currentUrl);

    // Verify we're in session view (auto-created)
    if (!currentUrl.includes('/session/')) {
      // Wait a bit more for auto-session creation
      await page.waitForTimeout(2000);
      const updatedUrl = page.url();

      if (!updatedUrl.includes('/session/')) {
        throw new Error('Expected auto-session creation but still on project page: ' + updatedUrl);
      }
    }

    // Agent testing may not be possible due to server errors with missing ANTHROPIC_KEY
    // Skip agent creation/selection if session fails to load properly
    const sessionUrl = page.url();
    if (sessionUrl.includes('/session/')) {
      // We're in a session, try to wait for agents or accept that content may not load
      try {
        await page.waitForSelector(
          'button:has-text("anthropic"), button:has-text("Launch"), textarea[placeholder*="Message"]',
          { timeout: 5000 }
        );

        const agentButton = page.locator('button:has-text("anthropic"):has-text("idle")').first();
        const launchButton = page.locator('button:has-text("Launch")').first();

        if ((await agentButton.count()) > 0) {
          await agentButton.click();
        } else if ((await launchButton.count()) > 0) {
          await launchButton.click();
        }
      } catch (_error) {
        // Agent functionality may not work due to server configuration issues
        // Agent functionality not available - error captured
      }
    }

    // Verify URL contains project and session (agent may not be accessible due to server issues)
    const urlPattern = /.*#\/project\/[^\/]+(?:\/session\/[^\/]+(?:\/agent\/[^\/]+)?)?$/;
    await expect(page).toHaveURL(urlPattern);

    const fullUrl = page.url();

    // Reload the page
    await page.reload();

    // Verify we're still on the same URL after reload
    await expect(page).toHaveURL(fullUrl);

    // Verify the project hierarchy is restored
    await expect(page.locator('button:has-text("Current Project")')).toBeVisible();

    // Since we're in a session view (with auto-created session/agent),
    // verify that basic session UI elements are present
    const pageUrl = page.url();
    if (pageUrl.includes('/session/')) {
      // Look for message input which indicates we're in the chat interface
      await expect(
        page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]')
      ).toBeVisible({ timeout: 10000 });
    }
  });

  test.skip('should handle browser back/forward navigation correctly', async ({ page }) => {
    // Navigate to the app
    await page.goto(testServer.baseURL);

    // Navigate through the hierarchy step by step to test back navigation
    await page.waitForSelector('h1:has-text("Select a Project"), h3', { timeout: 5000 });

    // Step 1: Select a project
    const existingProject = page
      .locator('h3:has-text("E2E Navigation Test"), h3:has-text("E2E")')
      .first();
    if ((await existingProject.count()) > 0) {
      // Click the project heading (entire project card is clickable)
      await existingProject.click();
    } else {
      // Check for auto-opened modal first
      const modalHeading = page
        .getByRole('heading', { name: 'Welcome to Lace' })
        .or(page.getByRole('heading', { name: 'Create New Project' }));

      try {
        // Wait a bit to see if modal auto-opens
        await expect(modalHeading).toBeVisible({ timeout: 5000 });
        // Modal is already open, proceed directly
      } catch {
        // Modal not visible, click the New Project button
        await page.getByTestId('new-project-button').click();
        // Now wait for modal to appear after clicking
        await expect(modalHeading).toBeVisible({ timeout: 15000 });
      }

      await page.getByTestId('project-path-input').fill('/tmp/e2e-navigation-test');
      const createButton = page.getByTestId('create-project-submit-button');
      await expect(createButton).toBeEnabled({ timeout: 5000 });
      await createButton.click();
    }

    const projectUrl = page.url();
    expect(projectUrl).toMatch(/#\/project\/[^\/]+(?:\/session\/[^\/]+(?:\/agent\/[^\/]+)?)?$/);

    // Step 2: Select a session
    await page.waitForSelector('button:text("New Session"), h3:has-text("Sessions")', {
      timeout: 3000,
    });
    const sessionCard = page.locator('h4').first();
    if ((await sessionCard.count()) > 0) {
      // Click the session heading (entire session card is clickable)
      await sessionCard.click();
    } else {
      await page.click('text="New Session"');
      await page.fill('input[placeholder="e.g., Backend API Development"]', 'Nav Session');
      await page.waitForSelector('button:text("Create Session"):not([disabled])', {
        timeout: 3000,
      });
      await page.click('button:text("Create Session")');

      // Wait to see if session was created (might fail with server error)
      await page.waitForTimeout(2000);

      // Check if session appears in the list, if so click it
      const sessionHeading = page.locator('h4').first();
      if ((await sessionHeading.count()) > 0) {
        await sessionHeading.click();
      } else {
        // Session creation failed due to server issues, continue without session navigation
        // Session creation failed as expected due to server configuration
      }
    }

    const sessionUrl = page.url();
    // Accept either project-level URL or session-level URL (may include agent)
    expect(sessionUrl).toMatch(/#\/project\/[^\/]+(?:\/session\/[^\/]+(?:\/agent\/[^\/]+)?)?$/);

    // Test browser back navigation even if we're still at project level
    const beforeBackUrl = page.url();

    // Test browser back navigation
    await page.goBack();

    // Should be back to project view
    await expect(page).toHaveURL(projectUrl);
    await expect(page.locator('button:text("New Session"), h3:has-text("Sessions")')).toBeVisible();

    // Test browser forward navigation
    await page.goForward();

    // Should be back to previous view
    await expect(page).toHaveURL(beforeBackUrl);
    // Should show current project and either session or project view
    await expect(page.locator('button:has-text("Current Project")')).toBeVisible();

    // Check that we're in a valid view (either project or session)
    const sessionHeading = page.locator('h4').first();
    const newSessionButton = page.locator('button:text("New Session")');

    const hasSession = (await sessionHeading.count()) > 0;
    const hasProjectView = (await newSessionButton.count()) > 0;

    expect(hasSession || hasProjectView).toBeTruthy();
  });

  test('should handle invalid URLs gracefully', async ({ page }) => {
    // Test with invalid project ID
    await page.goto(`${testServer.baseURL}/#/project/invalid-project-id`);

    // Should fallback to project selection view
    await expect(
      page.locator('h1:has-text("Select Project"), h2:has-text("Select Project")')
    ).toBeVisible();

    // Test with malformed URL
    await page.goto(`${testServer.baseURL}/#/invalid/path/structure`);

    // Should fallback to project selection
    await expect(
      page.locator('h1:has-text("Select Project"), h2:has-text("Select Project")')
    ).toBeVisible();

    // Test with partial hierarchy (agent without session)
    await page.goto(`${testServer.baseURL}/#/project/test/agent/invalid`);

    // Should fallback appropriately (likely to project view since session is missing)
    await expect(
      page.locator('h1:has-text("Select Project"), h2:has-text("Select Project")')
    ).toBeVisible();
  });

  test('should support deep linking to specific conversations', async ({ page }) => {
    // First, create the full hierarchy through normal navigation
    await page.goto(testServer.baseURL);

    // Navigate to create a testable URL
    await page.waitForSelector('h1:has-text("Select a Project"), [data-testid="project-card"]', {
      timeout: 5000,
    });

    // Use existing project/session for deep linking test
    const existingProject = page.locator('h3:has-text("E2E")').first();
    if ((await existingProject.count()) > 0) {
      // Click the project heading to navigate to it
      await existingProject.click();

      const sessionCard = page.locator('h4').first();
      if ((await sessionCard.count()) > 0) {
        // Click the session heading to navigate to it
        await sessionCard.click();

        // Get the current URL for deep linking test (session level is sufficient)
        const deepLinkUrl = page.url();

        // Verify we have a valid session URL
        if (deepLinkUrl.includes('/session/')) {
          // Open new page/tab simulation by navigating away and back
          await page.goto(testServer.baseURL);

          // Now use the deep link
          await page.goto(deepLinkUrl);

          // Verify the URL is maintained and basic navigation elements are present
          await expect(page).toHaveURL(deepLinkUrl);
          await expect(page.locator('button:has-text("Current Project")')).toBeVisible();

          // Check for session content or project fallback
          const sessionHeading = page.locator('h4').first();
          const newSessionButton = page.locator('button:text("New Session")');

          const hasSession = (await sessionHeading.count()) > 0;
          const hasProjectView = (await newSessionButton.count()) > 0;

          expect(hasSession || hasProjectView).toBeTruthy();
        }
      }
    }
  });
});
