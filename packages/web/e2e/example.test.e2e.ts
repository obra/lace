// ABOUTME: Example E2E test demonstrating best practice patterns for Lace tests
// ABOUTME: Shows complete per-test isolation with setupTestEnvironment and proper cleanup

import { test, expect, Page } from '@playwright/test';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  type TestEnvironment,
} from './helpers/test-utils';
import {
  createProject,
  setupAnthropicProvider,
  getMessageInput,
  sendMessage,
  verifyMessageVisible,
} from './helpers/ui-interactions';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Example E2E Test Patterns', () => {
  let testEnv: TestEnvironment;

  test.beforeEach(async ({ page }) => {
    // BEST PRACTICE: Setup isolated test environment for each test
    // This creates a unique server process with its own LACE_DIR and database
    testEnv = await setupTestEnvironment();

    // Navigate to our isolated test server
    await page.goto(testEnv.serverUrl);
  });

  test.afterEach(async () => {
    // BEST PRACTICE: Always cleanup test environment
    // This kills the server process and removes temp directories
    if (testEnv) {
      await cleanupTestEnvironment(testEnv);
    }
  });

  test('Test 1: Create project and verify isolation - should have clean state', async ({
    page,
  }) => {
    // Setup default provider first
    await setupAnthropicProvider(page);

    // Create a project in our isolated environment
    const projectPath = path.join(testEnv.tempDir, 'test-project-one');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Test Project One', projectPath);

    // Wait for project to be fully loaded
    await getMessageInput(page);

    // Send a message to create some data
    await sendMessage(page, 'This is test message from Test 1');

    // Verify message appears
    await verifyMessageVisible(page, 'This is test message from Test 1');

    // Verify we're using our isolated server
    expect(page.url()).toContain(testEnv.serverUrl.replace('http://', ''));
  });

  test('Test 2: Create different project and verify complete isolation from Test 1', async ({
    page,
  }) => {
    // Setup default provider first
    await setupAnthropicProvider(page);

    // This test gets its own server and LACE_DIR - should have NO data from Test 1
    const projectPath = path.join(testEnv.tempDir, 'test-project-two');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Test Project Two', projectPath);

    // Wait for project to be loaded
    await page.waitForSelector('input[placeholder*="Message"], textarea[placeholder*="Message"]', {
      timeout: 10000,
    });

    // Verify Test 1's message is NOT visible (complete isolation)
    const test1MessageVisible = await page
      .getByText('This is test message from Test 1')
      .isVisible()
      .catch(() => false);
    expect(test1MessageVisible).toBeFalsy();

    // Send a different message
    const messageInput = page
      .locator('input[placeholder*="Message"], textarea[placeholder*="Message"]')
      .first();
    await messageInput.fill('This is test message from Test 2');

    const sendButton = page
      .locator('button')
      .filter({ hasText: /send|submit/i })
      .first();
    if (await sendButton.isVisible().catch(() => false)) {
      await sendButton.click();
    } else {
      await messageInput.press('Enter');
    }

    // Verify our message appears
    await expect(page.getByText('This is test message from Test 2')).toBeVisible({ timeout: 5000 });

    // Verify we're using a completely different server than Test 1
    expect(page.url()).toContain(testEnv.serverUrl.replace('http://', ''));

    // Verify Test 1's message is still not visible (complete isolation)
    const test1MessageStillNotVisible = await page
      .getByText('This is test message from Test 1')
      .isVisible()
      .catch(() => false);
    expect(test1MessageStillNotVisible).toBeFalsy();
  });

  test('Test 3: Verify test environment provides complete isolation', async ({ page }) => {
    // Check that each test gets its own unique environment
    expect(testEnv.tempDir).toMatch(/^\/.*\/lace-test-/);
    expect(testEnv.serverUrl).toMatch(/^http:\/\/localhost:\d+$/);
    expect(testEnv.projectName).toContain('E2E Test Project');
    expect(testEnv.serverProcess).toBeDefined();

    // Verify server is responsive
    await page.goto(testEnv.serverUrl);
    await expect(page).toHaveURL(
      new RegExp(testEnv.serverUrl.replace('http://localhost:', 'localhost:'))
    );

    // Setup default provider first
    await setupAnthropicProvider(page);

    // Verify we can create projects and they're isolated
    const projectPath = path.join(testEnv.tempDir, 'isolation-test-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Isolation Test Project', projectPath);

    // Should not see any data from previous tests
    const anyPreviousMessages = await Promise.all([
      page
        .getByText('This is test message from Test 1')
        .isVisible()
        .catch(() => false),
      page
        .getByText('This is test message from Test 2')
        .isVisible()
        .catch(() => false),
    ]);

    expect(anyPreviousMessages.every((visible) => !visible)).toBeTruthy();
  });
});

/*
BEST PRACTICE SUMMARY:

1. SETUP: Always use setupTestEnvironment() in beforeEach
   - Creates isolated server process per test
   - Unique LACE_DIR and database per test  
   - Random port to avoid conflicts

2. NAVIGATION: Always use testEnv.serverUrl
   - Don't hardcode localhost:23457
   - Each test gets its own server URL

3. PROVIDER SETUP: Use setupAnthropicProvider() before creating projects
   - Sets up test provider configuration automatically
   - Skips if provider already configured

4. PROJECT CREATION: Use createProject helper
   - Pass testEnv.tempDir for project paths
   - Ensures projects are created in isolated directories

5. CLEANUP: Always use cleanupTestEnvironment() in afterEach  
   - Kills server process
   - Removes temp directories
   - Prevents resource leaks

6. ISOLATION VERIFICATION: 
   - Each test should verify it sees no data from other tests
   - Tests can reload pages and verify persistence within their environment
   - Tests should never see pollution from other tests

7. DEBUGGING:
   - Log testEnv.serverUrl and testEnv.tempDir for debugging
   - Each test gets unique identifiable resources
   - Server logs are prefixed with [SERVER:port] for identification
*/
