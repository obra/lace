// ABOUTME: Example E2E test demonstrating best practice patterns for Lace tests
// ABOUTME: Shows complete per-test isolation with mock AI providers and full conversation flows

import { test, expect } from '@playwright/test';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  type TestEnvironment,
  TIMEOUTS,
} from './helpers/test-utils';
import {
  createProject,
  setupAnthropicProvider,
  getMessageInput,
  sendMessage,
  verifyMessageVisible,
  waitForStopButton,
  clickStopButton,
  waitForSendButton,
} from './helpers/ui-interactions';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Example E2E Test Patterns', () => {
  let testEnv: TestEnvironment;

  test.beforeEach(async ({ page }) => {
    // BEST PRACTICE: Setup isolated test environment for each test
    // This creates a unique server process with its own LACE_DIR and database
    // The E2E test server automatically mocks the Anthropic SDK for predictable responses
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

  test('Test 1: Create project with complete conversation flow', async ({ page }) => {
    // Setup default provider first
    await setupAnthropicProvider(page);

    // Create a project in our isolated environment
    const projectPath = path.join(testEnv.tempDir, 'test-project-one');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Test Project One', projectPath);

    // Wait for project to be fully loaded
    await getMessageInput(page);

    // Send a message to trigger AI response
    await sendMessage(page, 'This is test message from Test 1');

    // Verify user message appears
    await verifyMessageVisible(page, 'This is test message from Test 1');

    // Wait for AI response to appear (mocked by E2E test server)
    await expect(
      page.getByText('I see you sent a test message from Test 1. This is my response as Claude!')
    ).toBeVisible({
      timeout: TIMEOUTS.EXTENDED,
    });

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

    // Wait for project to be fully loaded
    await getMessageInput(page);

    // Verify Test 1's message is NOT visible (complete isolation)
    const test1MessageVisible = await page
      .getByText('This is test message from Test 1')
      .isVisible()
      .catch(() => false);
    expect(test1MessageVisible).toBeFalsy();

    // Send a different message using helper
    await sendMessage(page, 'This is test message from Test 2');

    // Verify our message appears
    await verifyMessageVisible(page, 'This is test message from Test 2');

    // Wait for AI response (mocked by E2E test server)
    await expect(
      page.getByText("Hello from Test 2! I'm responding to your different message.")
    ).toBeVisible({
      timeout: TIMEOUTS.EXTENDED,
    });

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

    // Wait for project to be fully loaded
    await getMessageInput(page);

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

  test('Test 4: Complete conversation flow with streaming and message exchange', async ({
    page,
  }) => {
    // Setup provider and project
    await setupAnthropicProvider(page);
    const projectPath = path.join(testEnv.tempDir, 'conversation-test-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Conversation Test Project', projectPath);

    // Wait for project to be fully loaded
    await getMessageInput(page);

    // First message exchange
    await sendMessage(page, 'Hello there!');

    // Verify user message appears
    await verifyMessageVisible(page, 'Hello there!');

    // Wait for and verify streaming AI response (mocked by E2E test server)
    await expect(
      page.getByText(
        "Hello! I'm Claude, streaming my response token by token. You can see each word appear as I generate it."
      )
    ).toBeVisible({
      timeout: TIMEOUTS.EXTENDED,
    });

    // Send a follow-up message to test continued conversation
    await sendMessage(page, 'This is a follow-up message to test conversation flow');

    // Verify the follow-up message appears
    await verifyMessageVisible(page, 'This is a follow-up message to test conversation flow');

    // Wait for the follow-up AI response
    await expect(page.getByText('This is my follow-up response')).toBeVisible({
      timeout: TIMEOUTS.EXTENDED,
    });

    // Verify conversation history is preserved (both messages should be visible)
    await verifyMessageVisible(page, 'Hello there!');
    await verifyMessageVisible(page, 'This is a follow-up message to test conversation flow');

    // Verify both AI responses are present
    expect(
      await page
        .getByText(
          "Hello! I'm Claude, streaming my response token by token. You can see each word appear as I generate it."
        )
        .isVisible()
    ).toBeTruthy();
    expect(await page.getByText('This is my follow-up response').isVisible()).toBeTruthy();
  });

  test('Test 5: Message streaming with stop functionality', async ({ page }) => {
    // Setup provider and project
    await setupAnthropicProvider(page);
    const projectPath = path.join(testEnv.tempDir, 'stop-test-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Stop Test Project', projectPath);

    // Wait for project to be loaded
    await getMessageInput(page);

    // Send message to start streaming (E2E server will mock slow response)
    await sendMessage(page, 'Start a slow response that I can stop');

    // Wait for streaming to start (stop button should appear)
    await waitForStopButton(page, TIMEOUTS.STANDARD);

    // Click stop to interrupt streaming
    await clickStopButton(page);

    // Wait for send button to return (streaming stopped)
    await waitForSendButton(page, TIMEOUTS.QUICK);

    // The response should be partial (stopped before completion)
    // We should see at least the beginning of the response
    await expect(page.getByText('This is a very long response')).toBeVisible({
      timeout: TIMEOUTS.QUICK,
    });

    // But we should NOT see the full response since we stopped it
    const fullResponseVisible = await page
      .getByText('interrupting the generation process')
      .isVisible()
      .catch(() => false);
    expect(fullResponseVisible).toBeFalsy();
  });
});

/*
BEST PRACTICE SUMMARY:

1. TEST IMPORTS: Use standard Playwright with E2E test server
   - import { test, expect } from '@playwright/test' for standard Playwright
   - E2E test server automatically mocks Anthropic SDK for predictable responses
   - No need for MSW or HTTP interception - mocks at the SDK level

2. SETUP: Always use setupTestEnvironment() in beforeEach
   - Creates isolated server process per test using e2e-test-server.ts
   - Unique LACE_DIR and database per test  
   - Random port to avoid conflicts

3. E2E TEST SERVER: Automatic mock AI responses
   - Uses e2e-test-server.ts which mocks Anthropic SDK directly
   - Provides predictable AI responses based on user message content
   - Supports streaming simulation with realistic token-by-token generation
   - Cleaner than HTTP interception - works at the library level

4. NAVIGATION: Always use testEnv.serverUrl
   - Don't hardcode localhost:23457
   - Each test gets its own server URL

5. PROVIDER SETUP: Use setupAnthropicProvider() before creating projects
   - Sets up test provider configuration automatically
   - Skips if provider already configured

6. PROJECT CREATION: Use createProject helper
   - Pass testEnv.tempDir for project paths
   - Ensures projects are created in isolated directories

7. CONVERSATION TESTING: Test complete user/AI flows
   - Send user messages with sendMessage()
   - Verify user messages appear with verifyMessageVisible()
   - Wait for AI responses with appropriate timeouts (10-15 seconds)
   - Test conversation history preservation across multiple exchanges
   - Verify streaming behavior with mocked token-by-token generation

8. STOP FUNCTIONALITY: Test streaming interruption
   - Use messages that trigger slow responses in the mock
   - Wait for stop button with waitForStopButton()
   - Click stop with clickStopButton()
   - Wait for send button return with waitForSendButton()
   - Verify partial responses (incomplete due to stopping)

9. CLEANUP: Always use cleanupTestEnvironment() in afterEach  
   - Kills server process
   - Removes temp directories
   - Prevents resource leaks

10. ISOLATION VERIFICATION: 
    - Each test should verify it sees no data from other tests
    - Tests can reload pages and verify persistence within their environment
    - Tests should never see pollution from other tests

11. DEBUGGING:
    - Log testEnv.serverUrl and testEnv.tempDir for debugging
    - Each test gets unique identifiable resources
    - Server logs are prefixed with [SERVER:port] for identification
    - SDK mocking allows for predictable, debuggable AI responses
*/
