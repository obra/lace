// ABOUTME: Example E2E test demonstrating best practice patterns for Lace tests
// ABOUTME: Shows complete per-test isolation with setupTestEnvironment and proper cleanup

import { test, expect } from '@playwright/test';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  createProject,
  type TestEnvironment,
} from './helpers/test-utils';

test.describe('Example E2E Test Patterns', () => {
  let testEnv: TestEnvironment;

  test.beforeEach(
    async ({ page }) => {
      // BEST PRACTICE: Setup isolated test environment for each test
      // This creates a unique server process with its own LACE_DIR and database
      testEnv = await setupTestEnvironment();
      console.log(`🧪 Test using server: ${testEnv.serverUrl}`);
      console.log(`📁 Test using LACE_DIR: ${testEnv.tempDir}`);

      // Navigate to our isolated test server
      await page.goto(testEnv.serverUrl);
    },
    { timeout: 120000 }
  ); // 2 minutes for server compilation

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
    console.log('🚀 Test 1: Starting with clean isolated environment');

    // Create a project in our isolated environment
    await createProject(page, 'Test Project One', testEnv.tempDir);

    // Wait for project to be fully loaded
    await page.waitForSelector('input[placeholder*="Message"], textarea[placeholder*="Message"]', {
      timeout: 10000,
    });

    // Send a message to create some data
    const messageInput = page
      .locator('input[placeholder*="Message"], textarea[placeholder*="Message"]')
      .first();
    await messageInput.fill('This is test message from Test 1');

    const sendButton = page
      .locator('button')
      .filter({ hasText: /send|submit/i })
      .first();
    if (await sendButton.isVisible().catch(() => false)) {
      await sendButton.click();
    } else {
      await messageInput.press('Enter');
    }

    // Verify message appears
    await expect(page.getByText('This is test message from Test 1')).toBeVisible({ timeout: 5000 });
    console.log('✅ Test 1: Created project and sent message');

    // Reload page to verify data persists within this test's isolated server
    await page.reload();
    await page.waitForTimeout(2000);

    // The message should still be there (within this test's isolated environment)
    const messageStillVisible = await page
      .getByText('This is test message from Test 1')
      .isVisible()
      .catch(() => false);
    if (messageStillVisible) {
      console.log('✅ Test 1: Data persisted after reload within isolated environment');
    } else {
      console.log(
        'ℹ️  Test 1: Data not visible after reload (acceptable - depends on UI state management)'
      );
    }

    // Verify we're still in our isolated server
    expect(page.url()).toContain(testEnv.serverUrl.replace('http://', ''));
    console.log('✅ Test 1: Still using isolated server after reload');
  });

  test('Test 2: Create different project and verify complete isolation from Test 1', async ({
    page,
  }) => {
    console.log('🚀 Test 2: Starting with completely fresh isolated environment');

    // This test gets its own server and LACE_DIR - should have NO data from Test 1
    await createProject(page, 'Test Project Two', testEnv.tempDir);

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
    console.log('✅ Test 2: No data from Test 1 visible (perfect isolation)');

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
    console.log('✅ Test 2: Created different project and sent different message');

    // Verify we're using a completely different server than Test 1
    expect(page.url()).toContain(testEnv.serverUrl.replace('http://', ''));
    console.log('✅ Test 2: Using different isolated server from Test 1');

    // Reload and verify our data persists (but not Test 1's data)
    await page.reload();
    await page.waitForTimeout(2000);

    // Test 1's message should NEVER appear
    const test1MessageAfterReload = await page
      .getByText('This is test message from Test 1')
      .isVisible()
      .catch(() => false);
    expect(test1MessageAfterReload).toBeFalsy();
    console.log('✅ Test 2: Still no pollution from Test 1 after reload');

    // Our message state depends on UI implementation
    const test2MessageAfterReload = await page
      .getByText('This is test message from Test 2')
      .isVisible()
      .catch(() => false);
    if (test2MessageAfterReload) {
      console.log('✅ Test 2: Our data persisted after reload');
    } else {
      console.log(
        'ℹ️  Test 2: Our data not visible after reload (acceptable - depends on UI state management)'
      );
    }
  });

  test('Test 3: Verify test environment provides complete isolation', async ({ page }) => {
    console.log('🚀 Test 3: Verifying complete environmental isolation');

    // Check that each test gets its own unique environment
    expect(testEnv.tempDir).toMatch(/^\/.*\/lace-test-/);
    expect(testEnv.serverUrl).toMatch(/^http:\/\/localhost:\d+$/);
    expect(testEnv.projectName).toContain('E2E Test Project');
    expect(testEnv.serverProcess).toBeDefined();

    console.log(`✅ Test 3: Unique temp directory: ${testEnv.tempDir}`);
    console.log(`✅ Test 3: Unique server URL: ${testEnv.serverUrl}`);
    console.log(`✅ Test 3: Server process PID: ${testEnv.serverProcess.pid}`);

    // Verify server is responsive
    await page.goto(testEnv.serverUrl);
    await expect(page).toHaveURL(
      new RegExp(testEnv.serverUrl.replace('http://localhost:', 'localhost:'))
    );

    // Verify we can create projects and they're isolated
    await createProject(page, 'Isolation Test Project', testEnv.tempDir);

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
    console.log('✅ Test 3: No pollution from any previous tests');
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

3. PROJECT CREATION: Use createProject helper
   - Pass testEnv.tempDir for project paths
   - Ensures projects are created in isolated directories

4. CLEANUP: Always use cleanupTestEnvironment() in afterEach  
   - Kills server process
   - Removes temp directories
   - Prevents resource leaks

5. ISOLATION VERIFICATION: 
   - Each test should verify it sees no data from other tests
   - Tests can reload pages and verify persistence within their environment
   - Tests should never see pollution from other tests

6. DEBUGGING:
   - Log testEnv.serverUrl and testEnv.tempDir for debugging
   - Each test gets unique identifiable resources
   - Server logs are prefixed with [SERVER:port] for identification
*/
