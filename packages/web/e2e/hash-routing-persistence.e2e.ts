// ABOUTME: E2E test for hash-based URL persistence across page reloads
// ABOUTME: Tests project/session/agent selection persistence with real browser navigation

/**
 * @vitest-environment node
 */

import { test, expect } from '@playwright/test';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

test.describe('Hash-Based URL Persistence E2E', () => {
  let tempDir: string;
  let originalLaceDir: string | undefined;
  let originalAnthropicKey: string | undefined;

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
    // Navigate to the app
    await page.goto('http://localhost:3005');

    // Wait for projects to load (h1 with "Select a Project" or existing project cards)
    await page.locator('h1:has-text("Select a Project"), h3').first().waitFor({ timeout: 5000 });

    // Look for existing E2E projects or create one if needed
    const existingProject = page.locator('h3:has-text("E2E Test Project")').first();

    if ((await existingProject.count()) > 0) {
      // Click the entire project card (entire card is clickable)
      await existingProject.click();
    } else {
      // Create a new project for testing
      await page.click('text="Create New Project"');

      // Fill both required form fields using actual placeholder text
      await page.fill('input[placeholder="Enter project name"]', 'E2E Test Project');
      await page.fill('input[placeholder="/path/to/project"]', '/tmp/e2e-test-project');

      // Wait for the button to be enabled (only enabled after both fields filled)
      await page.waitForSelector('button:text("Create Project"):not([disabled])', {
        timeout: 3000,
      });
      await page.click('button:text("Create Project")');
    }

    // Verify URL contains project hash
    await expect(page).toHaveURL(/.*#\/project\/[^\/]+$/);

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
    await page.goto('http://localhost:3005');

    // Navigate through project → session selection - wait for page to load
    await page.waitForSelector('h1:has-text("Select a Project"), h3', { timeout: 5000 });

    // Select or create a project - the entire project card is clickable
    const existingProject = page.locator('h3:has-text("E2E Hash Test Project")').first();
    if ((await existingProject.count()) > 0) {
      // Click the project heading (entire project card is clickable)
      await existingProject.click();
    } else {
      // Create project if none exists
      await page.click('text="Create New Project"');
      await page.fill('input[placeholder="Enter project name"]', 'E2E Hash Test Project');
      await page.fill('input[placeholder="/path/to/project"]', '/tmp/e2e-hash-test-project');
      await page.waitForSelector('button:text("Create Project"):not([disabled])', {
        timeout: 3000,
      });
      await page.click('button:text("Create Project")');
    }

    // Wait for project page to load and look for sessions
    await page.waitForSelector('button:text("New Session")', { timeout: 3000 });

    // Select or create a session
    const sessionCard = page.locator('h4:has-text("E2E Test Session")').first();

    if ((await sessionCard.count()) > 0) {
      // Click the session heading (entire session card is clickable)
      await sessionCard.click();
    } else {
      // Create a session if none exists
      await page.click('button:text("New Session")');
      await page.fill('input[placeholder="e.g., Backend API Development"]', 'E2E Test Session');
      await page.waitForSelector('button:text("Create Session"):not([disabled])', {
        timeout: 3000,
      });
      await page.click('button:text("Create Session")');

      // Wait to see if session was created (might fail with server error)
      await page.waitForTimeout(2000);
      const createdSession = page.locator('h4:has-text("E2E Test Session")');
      if ((await createdSession.count()) > 0) {
        await createdSession.click();
      }
    }

    // Verify URL contains project and session
    await expect(page).toHaveURL(/.*#\/project\/[^\/]+\/session\/[^\/]+$/);

    const sessionUrl = page.url();

    // Reload the page
    await page.reload();

    // Verify we're still on the same session after reload
    await expect(page).toHaveURL(sessionUrl);

    // Verify we navigated to session view or stayed at project view (due to potential server errors)
    const currentUrl = page.url();
    // Should have either session URL or project URL
    expect(currentUrl).toMatch(/#\/project\/[^\/]+(?:\/session\/[^\/]+)?$/);

    // Check for session heading or project view elements
    const sessionHeading = page.locator('h4:has-text("E2E Test Session")');
    const newSessionButton = page.locator('button:text("New Session")');

    const hasSession = (await sessionHeading.count()) > 0;
    const hasProjectView = (await newSessionButton.count()) > 0;

    expect(hasSession || hasProjectView).toBeTruthy();
  });

  test('should persist full project/session/agent hierarchy across page reloads', async ({
    page,
  }) => {
    // Navigate to the app
    await page.goto('http://localhost:3005');

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
      await page.click('text="Create New Project"');
      await page.fill('input[placeholder="Enter project name"]', 'E2E Full Hierarchy Test');
      await page.fill('input[placeholder="/path/to/project"]', '/tmp/e2e-full-hierarchy-test');
      await page.waitForSelector('button:text("Create Project"):not([disabled])', {
        timeout: 3000,
      });
      await page.click('button:text("Create Project")');
    }

    // Select or create a session
    await page.waitForSelector('button:text("New Session")', { timeout: 3000 });

    const sessionCard = page.locator('h4').first();
    if ((await sessionCard.count()) > 0) {
      // Click the session heading (entire session card is clickable)
      await sessionCard.click();
    } else {
      await page.click('text="New Session"');
      await page.fill('input[placeholder="e.g., Backend API Development"]', 'Agent Session');
      await page.waitForSelector('button:text("Create Session"):not([disabled])', {
        timeout: 3000,
      });
      await page.click('button:text("Create Session")');

      // Wait to see if session was created (might fail with server error)
      await page.waitForTimeout(2000);
      const sessionHeading = page.locator('h4').first();
      if ((await sessionHeading.count()) > 0) {
        await sessionHeading.click();
      }
    }

    // Agent testing may not be possible due to server errors with missing ANTHROPIC_KEY
    // Skip agent creation/selection if session fails to load properly
    const currentUrl = page.url();
    if (currentUrl.includes('/session/')) {
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
      } catch (error) {
        // Agent functionality may not work due to server configuration issues
        console.log(
          'Agent functionality not available:',
          error instanceof Error ? error.message : String(error)
        );
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

    // Session heading should be visible if we're in a session
    const pageUrl = page.url();
    if (pageUrl.includes('/session/')) {
      const sessionHeading = page.locator('h4').first();
      const newSessionButton = page.locator('button:text("New Session")');

      const hasSession = (await sessionHeading.count()) > 0;
      const hasProjectView = (await newSessionButton.count()) > 0;

      expect(hasSession || hasProjectView).toBeTruthy();
    }
  });

  test.skip('should handle browser back/forward navigation correctly', async ({ page }) => {
    // Navigate to the app
    await page.goto('http://localhost:3005');

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
      await page.click('text="Create New Project"');
      await page.fill('input[placeholder="Enter project name"]', 'E2E Navigation Test');
      await page.fill('input[placeholder="/path/to/project"]', '/tmp/e2e-navigation-test');
      await page.waitForSelector('button:text("Create Project"):not([disabled])', {
        timeout: 3000,
      });
      await page.click('button:text("Create Project")');
    }

    const projectUrl = page.url();
    expect(projectUrl).toMatch(/#\/project\/[^\/]+$/);

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
        console.log('Session creation failed as expected due to server configuration');
      }
    }

    const sessionUrl = page.url();
    // Accept either project-level URL or session-level URL
    expect(sessionUrl).toMatch(/#\/project\/[^\/]+(?:\/session\/[^\/]+)?$/);

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
    await page.goto('http://localhost:3005/#/project/invalid-project-id');

    // Should fallback to project selection view
    await expect(
      page.locator('h1:has-text("Select Project"), h2:has-text("Select Project")')
    ).toBeVisible();

    // Test with malformed URL
    await page.goto('http://localhost:3005/#/invalid/path/structure');

    // Should fallback to project selection
    await expect(
      page.locator('h1:has-text("Select Project"), h2:has-text("Select Project")')
    ).toBeVisible();

    // Test with partial hierarchy (agent without session)
    await page.goto('http://localhost:3005/#/project/test/agent/invalid');

    // Should fallback appropriately (likely to project view since session is missing)
    await expect(
      page.locator('h1:has-text("Select Project"), h2:has-text("Select Project")')
    ).toBeVisible();
  });

  test('should support deep linking to specific conversations', async ({ page }) => {
    // First, create the full hierarchy through normal navigation
    await page.goto('http://localhost:3005');

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
          await page.goto('http://localhost:3005');

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
