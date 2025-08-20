// ABOUTME: Example E2E test demonstrating best practice patterns for Lace tests
// ABOUTME: Shows complete per-test isolation, MSW mocking, and full conversation flows

import { test, expect } from './mocks/setup';
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
  waitForStopButton,
  clickStopButton,
  waitForSendButton,
} from './helpers/ui-interactions';
import { http, HttpResponse } from 'msw';
import * as fs from 'fs';
import * as path from 'path';

// Helper function to create streaming Anthropic responses
function createStreamingAnthropicResponse(responseText: string, delayMs: number = 50) {
  const tokens = responseText.split(/(\s+)/).filter(Boolean);

  return new ReadableStream({
    async start(controller) {
      // Start with initial message structure
      const initialData = {
        id: 'msg_example_test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        model: 'claude-3-haiku-20240307',
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 15, output_tokens: 0 },
      };

      controller.enqueue(`data: ${JSON.stringify(initialData)}\n\n`);

      // Stream each token with delays to simulate real-time generation
      for (let i = 0; i < tokens.length; i++) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));

        const tokenData = {
          ...initialData,
          content: [{ type: 'text', text: tokens.slice(0, i + 1).join('') }],
          usage: { input_tokens: 15, output_tokens: i + 1 },
        };

        controller.enqueue(`data: ${JSON.stringify(tokenData)}\n\n`);
      }

      // Final completion message
      const finalData = {
        ...initialData,
        content: [{ type: 'text', text: responseText }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 15, output_tokens: tokens.length },
      };

      controller.enqueue(`data: ${JSON.stringify(finalData)}\n\n`);
      controller.enqueue('data: [DONE]\n\n');
      controller.close();
    },
  });
}

test.describe('Example E2E Test Patterns', () => {
  let testEnv: TestEnvironment;

  test.beforeEach(async ({ page, worker }) => {
    // BEST PRACTICE: Setup isolated test environment for each test
    // This creates a unique server process with its own LACE_DIR and database
    testEnv = await setupTestEnvironment();

    // Setup default MSW handler for Anthropic API
    await worker.use(
      http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
        const requestBody = await request.json();

        // Determine response based on user message
        let responseText = "I'm a helpful AI assistant. How can I help you today?";

        if (typeof requestBody === 'object' && requestBody && 'messages' in requestBody) {
          const messages = requestBody.messages as any[];
          const lastUserMessage = messages?.find((m) => m.role === 'user')?.content;

          if (typeof lastUserMessage === 'string') {
            if (lastUserMessage.includes('test message from Test 1')) {
              responseText =
                'I see you sent a test message from Test 1. This is my response as Claude!';
            } else if (lastUserMessage.includes('test message from Test 2')) {
              responseText = "Hello from Test 2! I'm responding to your different message.";
            } else if (lastUserMessage.includes('complete conversation')) {
              responseText =
                'This is a complete conversation test. I can help you with various tasks like coding, writing, analysis, and more!';
            } else if (lastUserMessage.includes('hello')) {
              responseText =
                "Hello! It's great to meet you. I'm Claude, an AI assistant created by Anthropic.";
            }
          }
        }

        // Return streaming response
        return new Response(createStreamingAnthropicResponse(responseText, 30), {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      })
    );

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

    // Wait for AI response to appear (may take time due to streaming)
    await expect(
      page.getByText('I see you sent a test message from Test 1. This is my response as Claude!')
    ).toBeVisible({
      timeout: 10000,
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

  test('Test 4: Complete conversation flow with streaming and message exchange', async ({
    page,
    worker,
  }) => {
    // Enhanced MSW handler for this specific test with slower streaming
    await worker.use(
      http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
        const requestBody = await request.json();

        // Determine response based on user message
        let responseText =
          'This is a streaming response that demonstrates real-time token generation in the UI.';

        if (typeof requestBody === 'object' && requestBody && 'messages' in requestBody) {
          const messages = requestBody.messages as any[];
          const lastUserMessage = messages?.find((m) => m.role === 'user')?.content;

          if (typeof lastUserMessage === 'string') {
            if (lastUserMessage.includes('hello')) {
              responseText =
                "Hello! I'm Claude, streaming my response token by token. You can see each word appear as I generate it.";
            } else if (lastUserMessage.includes('follow-up')) {
              responseText =
                'This is my follow-up response. Notice how each message gets its own streaming animation.';
            }
          }
        }

        // Return slower streaming response to make it visible
        return new Response(createStreamingAnthropicResponse(responseText, 100), {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      })
    );

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

    // Wait for and verify streaming AI response
    await expect(
      page.getByText("Hello! I'm Claude, streaming my response token by token")
    ).toBeVisible({
      timeout: 15000,
    });

    // Send a follow-up message to test continued conversation
    await sendMessage(page, 'This is a follow-up message to test conversation flow');

    // Verify the follow-up message appears
    await verifyMessageVisible(page, 'This is a follow-up message to test conversation flow');

    // Wait for the follow-up AI response
    await expect(page.getByText('This is my follow-up response')).toBeVisible({
      timeout: 15000,
    });

    // Verify conversation history is preserved (both messages should be visible)
    await verifyMessageVisible(page, 'Hello there!');
    await verifyMessageVisible(page, 'This is a follow-up message to test conversation flow');

    // Verify both AI responses are present
    expect(
      await page.getByText("Hello! I'm Claude, streaming my response token by token").isVisible()
    ).toBeTruthy();
    expect(await page.getByText('This is my follow-up response').isVisible()).toBeTruthy();
  });

  test('Test 5: Message streaming with stop functionality', async ({ page, worker }) => {
    // Setup very slow streaming for stop testing
    await worker.use(
      http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
        const responseText =
          'This is a very long response that streams slowly so we can test the stop functionality by interrupting the generation process.';

        // Very slow streaming (500ms per token) to allow time to click stop
        return new Response(createStreamingAnthropicResponse(responseText, 500), {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      })
    );

    // Setup provider and project
    await setupAnthropicProvider(page);
    const projectPath = path.join(testEnv.tempDir, 'stop-test-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Stop Test Project', projectPath);

    // Wait for project to be loaded
    await getMessageInput(page);

    // Send message to start streaming
    await sendMessage(page, 'Start a slow response that I can stop');

    // Wait for streaming to start (stop button should appear)
    await waitForStopButton(page, 10000);

    // Click stop to interrupt streaming
    await clickStopButton(page);

    // Wait for send button to return (streaming stopped)
    await waitForSendButton(page, 5000);

    // The response should be partial (stopped before completion)
    // We should see at least the beginning of the response
    await expect(page.getByText('This is a very long response')).toBeVisible({ timeout: 3000 });

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

1. TEST IMPORTS: Use MSW-enabled test setup
   - import { test, expect } from './mocks/setup' for MSW support
   - Access worker fixture for per-test API mocking
   - Import http, HttpResponse from 'msw' for custom handlers

2. SETUP: Always use setupTestEnvironment() in beforeEach
   - Creates isolated server process per test
   - Unique LACE_DIR and database per test  
   - Random port to avoid conflicts

3. MSW API MOCKING: Setup realistic streaming responses
   - Use worker.use() to override API handlers per test
   - Create streaming responses with createStreamingAnthropicResponse()
   - Match response content to user messages for realistic conversations
   - Use appropriate delays (30-100ms normal, 500ms+ for stop testing)

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
   - Verify streaming behavior with visible token-by-token generation

8. STOP FUNCTIONALITY: Test streaming interruption
   - Use slow streaming (500ms+ delays) for reliable stop testing
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
    - MSW handlers can log request/response data for debugging
*/
